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

/** Últimas mensagens da conversa, só texto; toque em botão vira "(tocou em: ...)" quando dá para saber. */
async function historico(contatoId: string, atualId: string): Promise<MensagemHistorico[]> {
  const linhas = await db
    .select({ direcao: mensagem.direcao, texto: mensagem.texto, botoes: mensagem.botoes })
    .from(mensagem)
    .where(and(eq(mensagem.contatoId, contatoId), ne(mensagem.id, atualId)))
    .orderBy(desc(mensagem.criadoEm))
    .limit(12);
  return linhas
    .reverse()
    .map((m): MensagemHistorico => {
      if (m.direcao === "entrada") return { papel: "comprador", texto: m.texto || "(tocou num botão)" };
      const botoes = m.botoes?.length ? `\n[botões oferecidos: ${m.botoes.map((b) => b.rotulo).join(" | ")}]` : "";
      return { papel: "assistente", texto: `${m.texto}${botoes}` };
    })
    .filter((m) => m.texto.trim());
}

async function atender(m: MensagemRecebida) {
  if (await vaiDiretoAoFluxo(m)) return aoMensagemDoComprador(m);
  let r: Awaited<ReturnType<typeof responder>>;
  try {
    r = await responder({ ctx: { contatoId: m.contato.id, agora: new Date() }, texto: m.entrada.texto.trim(), historico: await historico(m.contato.id, m.mensagemId) });
  } catch (erro) {
    // IA fora do ar ou erro do Assistente: o fluxo de hoje continua atendendo como antes.
    console.error("[assistente]", erro);
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
