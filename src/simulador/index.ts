// Canal "simulado": recebe o que o sistema manda aos fornecedores simulados e
// responde sozinho, depois de um atraso, entrando pela mesma receber() que um
// fornecedor real usaria. O que ele responde depende da persona.
//
// T6: o usuário pode assumir o chat de um fornecedor simulado pela tela do
// Telegram simulado e escrever no lugar da persona. Enquanto o chat estiver
// assumido, a persona não reage ao que chega nem dispara respostas já agendadas.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { SIM_ATRASO_FATOR } from "../config.ts";
import { db } from "../nucleo/db/cliente.ts";
import { contato, evento, fornecedor, itemPedido, pedido } from "../nucleo/db/schema.ts";
import { registrar } from "../nucleo/registro.ts";
import { receber, type AdaptadorCanal, type OpcoesEnvio } from "../nucleo/mensagens/index.ts";
import { referenciasDoItem } from "../agentes/busca/internet.ts";
import { PERGUNTA_ANTES, TODAS_PERSONAS, textoComplemento, textoProposta, type Persona } from "./personas.ts";

const personaPorChave = new Map(TODAS_PERSONAS.map((p) => [p.chave, p]));
/** Quem já perguntou antes de cotar, por item. */
const perguntou = new Set<string>();
/** Quem "esqueceu" e espera o lembrete, por item. */
const esperandoLembrete = new Set<string>();
/** Já completou a proposta depois do pedido do assistente. */
const completou = new Set<string>();
let seq = 0;
/** Respostas agendadas por endereço (chave da persona), para cancelar quando o usuário assume o chat. */
const agendadas = new Map<string, Set<ReturnType<typeof setTimeout>>>();

function depois(endereco: string, seg: number, fn: () => Promise<unknown>) {
  const ms = Math.max(500, seg * 1000 * SIM_ATRASO_FATOR());
  const timers = agendadas.get(endereco) ?? new Set();
  agendadas.set(endereco, timers);
  const t = setTimeout(() => {
    timers.delete(t);
    // Confere de novo na hora do disparo: o chat pode ter sido assumido enquanto a resposta esperava.
    assumidoPorEndereco(endereco)
      .then((assumido) => (assumido ? undefined : fn()))
      .catch((e) => console.error("[simulador]", e));
  }, ms);
  t.unref?.();
  timers.add(t);
}

function cancelarAgendadas(endereco: string) {
  const timers = agendadas.get(endereco);
  if (!timers) return;
  for (const t of timers) clearTimeout(t);
  agendadas.delete(endereco);
}

// ---------- Chat assumido pelo usuário (T6) ----------
// O estado fica na tabela evento, sem coluna nova: vale o evento mais recente com
// dados.tipo = "sim_assumido" para o contato. Sem evento, o chat é automático.

type DadosAssumido = { tipo: "sim_assumido"; contatoId: string; assumido: boolean };

/** O usuário assumiu este chat simulado? Lê sempre do banco. */
export async function chatAssumido(contatoId: string): Promise<boolean> {
  const [e] = await db
    .select({ dados: evento.dados })
    .from(evento)
    .where(and(sql`${evento.dados}->>'tipo' = 'sim_assumido'`, sql`${evento.dados}->>'contatoId' = ${contatoId}`))
    .orderBy(desc(evento.criadoEm))
    .limit(1);
  return (e?.dados as DadosAssumido | undefined)?.assumido === true;
}

async function assumidoPorEndereco(endereco: string) {
  const [c] = await db
    .select({ id: contato.id })
    .from(contato)
    .where(and(eq(contato.canal, "simulado"), eq(contato.endereco, endereco)));
  return c ? chatAssumido(c.id) : false;
}

/**
 * Assume (true) ou devolve ao automático (false) o chat de um fornecedor simulado.
 * Só grava evento quando o estado muda. Ao assumir, cancela as respostas já agendadas.
 */
export async function assumirChat(contatoId: string, assumido: boolean): Promise<{ mudou: boolean }> {
  const [c] = await db.select().from(contato).where(eq(contato.id, contatoId));
  if (!c || c.canal !== "simulado") throw new Error(`Contato ${contatoId} não é de fornecedor simulado.`);
  let mudou = false;
  if ((await chatAssumido(contatoId)) !== assumido) {
    const dados: DadosAssumido = { tipo: "sim_assumido", contatoId, assumido };
    await registrar(db, {
      agente: "Fornecedor",
      acao: assumido ? "Usuário assumiu o chat simulado." : "Chat simulado devolvido ao automático.",
      motivo: assumido
        ? "Alguém escreve como o fornecedor pela tela do Telegram simulado; a persona automática para de responder."
        : "A persona automática volta a responder às próximas mensagens.",
      fornecedorIds: c.fornecedorId ? [c.fornecedorId] : undefined,
      dados,
    });
    mudou = true;
  }
  // Depois do evento gravado: o que disparar daqui em diante já encontra o chat assumido.
  if (assumido) cancelarAgendadas(c.endereco);
  return { mudou };
}

async function responder(endereco: string, texto: string, botao?: string) {
  await receber({ canal: "simulado", endereco, idExterno: `sim-${Date.now()}-${++seq}`, texto, botao });
}

async function itemDa(opcoes: OpcoesEnvio) {
  if (!opcoes.itemPedidoId) return null;
  const [i] = await db
    .select({
      descricao: itemPedido.descricao,
      quantidade: itemPedido.quantidade,
      unidade: itemPedido.unidade,
      rodada: itemPedido.rodada,
      destino: pedido.destino,
    })
    .from(itemPedido)
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .where(eq(itemPedido.id, opcoes.itemPedidoId));
  return i ? { ...i, quantidade: Number(i.quantidade) } : null;
}

async function enviarProposta(p: Persona, opcoes: OpcoesEnvio) {
  const item = await itemDa(opcoes);
  if (!item) return;
  const { mediana } = await referenciasDoItem(opcoes.itemPedidoId!);
  const texto = textoProposta(p, item, item.rodada, mediana);
  if (texto) await responder(p.chave, texto);
}

function reagir(p: Persona, texto: string, opcoes: OpcoesEnvio) {
  const chaveItem = `${p.chave}:${opcoes.itemPedidoId}`;
  switch (opcoes.tipo) {
    case "cotacao":
      if (p.comportamento === "esquece") {
        esperandoLembrete.add(chaveItem);
        return;
      }
      if (p.comportamento === "pergunta" && !perguntou.has(chaveItem)) {
        perguntou.add(chaveItem);
        return depois(p.chave, p.atrasoSeg, () => responder(p.chave, PERGUNTA_ANTES));
      }
      return depois(p.chave, p.atrasoSeg, () => enviarProposta(p, opcoes));
    case "resposta":
      // Resposta à dúvida: agora cota.
      if (perguntou.has(chaveItem)) return depois(p.chave, p.atrasoSeg / 2, () => enviarProposta(p, opcoes));
      return;
    case "negociacao":
      // Quem esquece não responde à contraproposta; os outros melhoram a proposta.
      if (p.comportamento === "esquece") return;
      return depois(p.chave, p.atrasoSeg, () => enviarProposta(p, opcoes));
    case "completar_proposta":
      // O assistente pediu o que faltou: o simulado completa, uma vez por item.
      if (completou.has(chaveItem)) return;
      completou.add(chaveItem);
      return depois(p.chave, p.atrasoSeg / 2, () => responder(p.chave, textoComplemento(p)));
    case "confirmar_preco":
      return depois(p.chave, p.atrasoSeg / 2, () => responder(p.chave, "Sim, confirmo o preço. É promoção de estoque."));
    case "lembrete":
      if (esperandoLembrete.delete(chaveItem)) return depois(p.chave, p.atrasoSeg, () => enviarProposta(p, opcoes));
      return;
    case "pedido_compra": {
      const dado = opcoes.botoes?.[0]?.dado; // primeiro botão é "Confirmo"
      if (dado) return depois(p.chave, p.atrasoSeg / 2, () => responder(p.chave, "", dado));
      return depois(p.chave, p.atrasoSeg / 2, () => responder(p.chave, "Confirmo o pedido, vamos separar o material."));
    }
    default:
      return;
  }
}

export function adaptadorSimulado(): AdaptadorCanal {
  return {
    canal: "simulado",
    async enviar(endereco, texto, opcoes) {
      const p = personaPorChave.get(endereco);
      // Chat assumido: a persona não reage nem guarda estado. Devolvido ao automático,
      // volta a reagir só às mensagens seguintes. Se a consulta falhar, segue automático.
      const assumido = p ? await assumidoPorEndereco(endereco).catch((e) => (console.error("[simulador]", e), false)) : false;
      if (p && !assumido) reagir(p, texto, opcoes);
      return { idExterno: `sim-out-${Date.now()}-${++seq}` };
    },
  };
}

/** Cria ou atualiza os fornecedores simulados e seus contatos no canal "simulado". */
export async function semearSimulados() {
  for (const p of TODAS_PERSONAS) {
    const [f] = await db
      .insert(fornecedor)
      .values({ chave: p.chave, nome: p.nome, origem: "simulado", regiao: p.regiao, fonte: "Base fictícia do time" })
      .onConflictDoUpdate({ target: fornecedor.chave, set: { nome: p.nome, regiao: p.regiao } })
      .returning({ id: fornecedor.id });
    await db
      .insert(contato)
      .values({ canal: "simulado", endereco: p.chave, papel: "fornecedor", fornecedorId: f!.id, nome: p.nome, avisoPrivacidadeEm: new Date() })
      .onConflictDoUpdate({ target: [contato.canal, contato.endereco], set: { fornecedorId: f!.id, papel: "fornecedor" } });
  }
  return db.select({ id: fornecedor.id }).from(fornecedor).where(inArray(fornecedor.chave, TODAS_PERSONAS.map((p) => p.chave)));
}
