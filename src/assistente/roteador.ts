// Liga o Assistente na entrada única (N4) sem mexer nos fluxos: registra o próprio roteador, que no
// canal web decide antes e chama aoMensagemDoComprador sem mudança quando a mensagem é do fluxo de
// pedidos. Nos outros canais (Telegram, simulado), repassa direto, como era.

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { aoMensagemDoComprador } from "../fluxo/comprador.ts";
import { aoMensagemDoFornecedor } from "../fluxo/fornecedor.ts";
import { db } from "../nucleo/db/cliente.ts";
import { mensagem, pedido } from "../nucleo/db/schema.ts";
import { aoReceber, enviar, type MensagemRecebida } from "../nucleo/mensagens/index.ts";
import { registrar } from "../nucleo/registro.ts";
import { responder } from "./agente.ts";
import type { MensagemHistorico } from "./tipos.ts";

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
async function historico(contatoId: string, atualId: string): Promise<MensagemHistorico[]> {
  const linhas = await db
    .select({ direcao: mensagem.direcao, texto: mensagem.texto, botoes: mensagem.botoes, anexos: mensagem.anexos })
    .from(mensagem)
    .where(and(eq(mensagem.contatoId, contatoId), ne(mensagem.id, atualId)))
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

async function atender(m: MensagemRecebida) {
  if (await vaiDiretoAoFluxo(m)) return aoMensagemDoComprador(m);
  let r: Awaited<ReturnType<typeof responder>>;
  try {
    r = await responder({ ctx: { contatoId: m.contato.id, agora: new Date() }, texto: m.entrada.texto.trim(), historico: await historico(m.contato.id, m.mensagemId) });
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
  if (r.tipo === "encaminhar") return aoMensagemDoComprador(m);
  await enviar(m.contato.id, r.texto, { botoes: r.botoes.length ? r.botoes : undefined });
  await registrar(db, {
    agente: "Assistente",
    acao: `Respondeu no chat${r.ferramentas.length ? ` consultando ${[...new Set(r.ferramentas.map((f) => f.nome))].join(", ")}` : ""}.`,
    motivo: r.validacao.ok ? `Modelo ${r.modelo}${r.escalou ? " (escalou para o forte)" : ""}.` : `Resposta reprovada na conferência: ${r.validacao.problemas.join("; ")}.`,
    dados: { modelo: r.modelo, escalou: r.escalou, ferramentas: r.ferramentas, validacao: r.validacao, tokens: r.tokens, ms: r.ms },
  });
}

let ligado = false;

/** Chamar depois de ligarFluxos(): troca o roteador da entrada única pelo que passa pelo Assistente. */
export function ligarAssistente() {
  if (ligado) return;
  ligado = true;
  aoReceber((m) => {
    if (m.contato.papel !== "comprador") return aoMensagemDoFornecedor(m);
    if (!CANAIS_DO_ASSISTENTE.has(m.entrada.canal)) return aoMensagemDoComprador(m);
    return atender(m);
  });
}
