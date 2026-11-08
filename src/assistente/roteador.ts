// Liga o Assistente na entrada única (N4) sem mexer nos fluxos: registra o próprio roteador, que no
// canal web decide antes e chama aoMensagemDoComprador quando a mensagem é do fluxo de pedidos.
// Nos outros canais (Telegram, simulado), repassa direto, como era; lá o Assistente só responde as
// consultas que o Interpretador classifica (definirRespondedorDeConsulta).
//
// Fronteira com a Frente 4 (guardrails): a triagem em código roda antes do Assistente. Lista dura,
// injeção, insistência e fora do escopo repetido vão ao fluxo, que registra o caso, conta a
// insistência e avisa o gestor. Dado pessoal chega mascarado ao modelo.

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { triagem, TEXTO_DADO_PESSOAL } from "../agentes/guardrail/index.ts";
import { insistenciaDo } from "../agentes/guardrail/rastro.ts";
import { aoMensagemDoComprador, definirRespondedorDeConsulta, garantirAvisoPrivacidade, type RespostaConsulta } from "../fluxo/comprador.ts";
import { aoMensagemDoFornecedor } from "../fluxo/fornecedor.ts";
import { db } from "../nucleo/db/cliente.ts";
import { mensagem, pedido } from "../nucleo/db/schema.ts";
import { aoReceber, enviar, type MensagemRecebida } from "../nucleo/mensagens/index.ts";
import { registrar } from "../nucleo/registro.ts";
import { responder } from "./agente.ts";
import { PREFIXO_LINK, type MensagemHistorico } from "./tipos.ts";

/** Os mesmos "sim" que o fluxo do comprador aceita como confirmação (fluxo/comprador.ts). */
const CONFIRMACAO = /^(sim|ok|okay|confirm[oa]|confirmado|pode( seguir| cotar)?|isso|certo|fechado|beleza|blz|manda)[!.\s]*$/i;

/** Canais em que o Assistente atende. O Telegram fica para depois da junção com a Frente 4. */
const CANAIS_DO_ASSISTENTE = new Set(["web"]);

/** Vai direto ao fluxo, sem gastar IA: botão, anexo, comando, ou "sim" com pedido em "confirma?". */
async function vaiDiretoAoFluxo({ contato, entrada }: MensagemRecebida): Promise<boolean> {
  const texto = entrada.texto.trim();
  if (entrada.botao || entrada.anexos?.length || !texto || texto.startsWith("/")) return true;
  if (!CONFIRMACAO.test(texto)) return false;
  const [p] = await db
    .select({ id: pedido.id })
    .from(pedido)
    .where(and(eq(pedido.compradorId, contato.id), inArray(pedido.estado, ["interpretando", "aguardando_confirmacao"])))
    .limit(1);
  return !!p;
}

/** Últimas mensagens da conversa, só texto. O toque em botão não guarda o rótulo no banco, então vira "(tocou num botão)". */
async function historico(contatoId: string, atualId: string | null): Promise<MensagemHistorico[]> {
  const linhas = await db
    .select({ direcao: mensagem.direcao, texto: mensagem.texto, botoes: mensagem.botoes, anexos: mensagem.anexos })
    .from(mensagem)
    .where(atualId ? and(eq(mensagem.contatoId, contatoId), ne(mensagem.id, atualId)) : eq(mensagem.contatoId, contatoId))
    .orderBy(desc(mensagem.criadoEm))
    .limit(12);
  return linhas
    .reverse()
    .map((m): MensagemHistorico => {
      if (m.direcao === "entrada") return { papel: "comprador", texto: m.texto || (m.anexos?.length ? "(mandou um anexo)" : "(tocou num botão)") };
      const botoes = m.botoes?.length ? `\n[botões oferecidos: ${m.botoes.map((b) => b.rotulo).join(" | ")}]` : "";
      return { papel: "assistente", texto: `${m.texto}${botoes}` };
    })
    .filter((m) => m.texto.trim());
}

const PERGUNTA = /\?\s*$|^(o que|qual|quais|quanto|quantos|quando|onde|como|por ?que|quem|tem|existe|cad[eê]|me (mostra|diz|fala))\b/i;
const parecePergunta = (texto: string) => PERGUNTA.test(texto.trim());

/** Casos que os guardrails do fluxo tratam melhor que o Assistente (registro, insistência, aviso ao gestor). */
async function eDoGuardrail(contatoId: string, t: ReturnType<typeof triagem>): Promise<boolean> {
  if (t.bloqueio || t.injecao) return true;
  const ins = await insistenciaDo(contatoId);
  return ins.respostaFixa || Boolean(t.foraDoEscopo && ins.foraSeguidas >= 3);
}

/** Motivos do Assistente que garantem que a mensagem não é resposta à dúvida de um fornecedor. */
const NAO_RESPONDE_FORNECEDOR = new Set(["pedido_novo", "correcao", "confirmacao"]);

async function atender(m: MensagemRecebida) {
  if (await vaiDiretoAoFluxo(m)) return aoMensagemDoComprador(m);
  const t = triagem(m.entrada.texto.trim());
  if (await eDoGuardrail(m.contato.id, t)) return aoMensagemDoComprador(m);
  let r: Awaited<ReturnType<typeof responder>>;
  try {
    r = await responder({ ctx: { contatoId: m.contato.id, agora: new Date() }, texto: t.texto, historico: await historico(m.contato.id, m.mensagemId) });
  } catch (erro) {
    console.error("[assistente]", erro);
    // Pergunta não pode ir ao fluxo: viraria pedido novo ou correção do pedido aberto. O resto (provável
    // pedido) segue para o fluxo de hoje, que atende como antes do Assistente.
    if (parecePergunta(m.entrada.texto)) {
      await enviar(m.contato.id, "Tive um problema para consultar isso agora. Pode perguntar de novo em instantes?");
      return;
    }
    return aoMensagemDoComprador(m);
  }
  // O fluxo recebe a mensagem original: ele mesmo mascara e avisa do dado pessoal.
  if (r.tipo === "encaminhar") return aoMensagemDoComprador(m, { naoEhRespostaFornecedor: NAO_RESPONDE_FORNECEDOR.has(r.motivo) });
  await garantirAvisoPrivacidade(m.contato);
  if (t.dadoPessoal.length) await enviar(m.contato.id, TEXTO_DADO_PESSOAL);
  await enviar(m.contato.id, r.texto, { botoes: r.botoes.length ? r.botoes : undefined });
  await registrar(db, {
    agente: "Assistente",
    acao: `Respondeu no chat${r.ferramentas.length ? ` consultando ${[...new Set(r.ferramentas.map((f) => f.nome))].join(", ")}` : ""}.`,
    motivo: r.validacao.ok ? `Modelo ${r.modelo}${r.escalou ? " (escalou para o forte)" : ""}.` : `Resposta reprovada na conferência: ${r.validacao.problemas.join("; ")}.`,
    dados: { modelo: r.modelo, escalou: r.escalou, ferramentas: r.ferramentas, validacao: r.validacao, tokens: r.tokens, ms: r.ms },
  });
}

/**
 * Fora do chat web não há telas para abrir: link Markdown relativo vira só o texto, e botão de link
 * sai. Botões de ação (o mesmo `dado` do fluxo) continuam valendo no Telegram.
 */
export function paraCanalSemTelas(texto: string, botoes: { rotulo: string; dado: string }[]): RespostaConsulta {
  const limpo = texto.replace(/\[([^\]]+)\]\((\/[^)\s]*)\)/g, "$1");
  const acoes = botoes.filter((b) => !b.dado.startsWith(PREFIXO_LINK));
  return { texto: limpo, botoes: acoes.length ? acoes : undefined };
}

/** Consulta classificada pelo Interpretador (Telegram e outros canais): o Assistente responde, sem encaminhar de volta. */
async function responderConsulta(c: { contatoId: string; canal: string; texto: string }): Promise<RespostaConsulta | null> {
  // A pergunta já está gravada como a última mensagem do comprador (depois dela, só avisos do fluxo):
  // sai do histórico para não ir duas vezes.
  const anteriores = await historico(c.contatoId, null);
  const ultima = anteriores.findLastIndex((h) => h.papel === "comprador");
  if (ultima >= 0) anteriores.splice(ultima, 1);
  const r = await responder({ ctx: { contatoId: c.contatoId, agora: new Date() }, texto: c.texto, historico: anteriores });
  // Pediu para encaminhar: o fluxo já leu como consulta, então não há para onde ir; fica a resposta curta.
  if (r.tipo !== "resposta") return null;
  await registrar(db, {
    agente: "Assistente",
    acao: `Respondeu uma consulta no ${c.canal === "web" ? "chat" : c.canal}.`,
    motivo: r.validacao.ok ? `Modelo ${r.modelo}${r.escalou ? " (escalou para o forte)" : ""}.` : `Resposta reprovada na conferência: ${r.validacao.problemas.join("; ")}.`,
    dados: { modelo: r.modelo, escalou: r.escalou, ferramentas: r.ferramentas, validacao: r.validacao, tokens: r.tokens, ms: r.ms },
  });
  return c.canal === "web" ? { texto: r.texto, botoes: r.botoes.length ? r.botoes : undefined } : paraCanalSemTelas(r.texto, r.botoes);
}

let ligado = false;

/** Chamar depois de ligarFluxos(): troca o roteador da entrada única pelo que passa pelo Assistente. */
export function ligarAssistente() {
  if (ligado) return;
  ligado = true;
  definirRespondedorDeConsulta(responderConsulta);
  aoReceber((m) => {
    if (m.contato.papel !== "comprador") return aoMensagemDoFornecedor(m);
    if (!CANAIS_DO_ASSISTENTE.has(m.entrada.canal)) return aoMensagemDoComprador(m);
    return atender(m);
  });
}
