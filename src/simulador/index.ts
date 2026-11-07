// Canal "simulado": recebe o que o sistema manda aos fornecedores simulados e
// responde sozinho, depois de um atraso, entrando pela mesma receber() que um
// fornecedor real usaria. O que ele responde depende da persona.

import { eq, inArray } from "drizzle-orm";
import { SIM_ATRASO_FATOR } from "../config.ts";
import { db } from "../nucleo/db/cliente.ts";
import { contato, fornecedor, itemPedido, pedido } from "../nucleo/db/schema.ts";
import { receber, type AdaptadorCanal, type OpcoesEnvio } from "../nucleo/mensagens/index.ts";
import { referenciasDoItem } from "../agentes/busca/internet.ts";
import { PERGUNTA_ANTES, TODAS_PERSONAS, textoProposta, type Persona } from "./personas.ts";

const personaPorChave = new Map(TODAS_PERSONAS.map((p) => [p.chave, p]));
/** Quem já perguntou antes de cotar, por item. */
const perguntou = new Set<string>();
/** Quem "esqueceu" e espera o lembrete, por item. */
const esperandoLembrete = new Set<string>();
let seq = 0;

function depois(seg: number, fn: () => Promise<unknown>) {
  const ms = Math.max(500, seg * 1000 * SIM_ATRASO_FATOR());
  setTimeout(() => fn().catch((e) => console.error("[simulador]", e)), ms).unref?.();
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
        return depois(p.atrasoSeg, () => responder(p.chave, PERGUNTA_ANTES));
      }
      return depois(p.atrasoSeg, () => enviarProposta(p, opcoes));
    case "resposta":
      // Resposta à dúvida: agora cota.
      if (perguntou.has(chaveItem)) return depois(p.atrasoSeg / 2, () => enviarProposta(p, opcoes));
      return;
    case "negociacao":
      // Quem esquece não responde à contraproposta; os outros melhoram a proposta.
      if (p.comportamento === "esquece") return;
      return depois(p.atrasoSeg, () => enviarProposta(p, opcoes));
    case "confirmar_preco":
      return depois(p.atrasoSeg / 2, () => responder(p.chave, "Sim, confirmo o preço. É promoção de estoque."));
    case "lembrete":
      if (esperandoLembrete.delete(chaveItem)) return depois(p.atrasoSeg, () => enviarProposta(p, opcoes));
      return;
    case "pedido_compra": {
      const dado = opcoes.botoes?.[0]?.dado; // primeiro botão é "Confirmo"
      if (dado) return depois(p.atrasoSeg / 2, () => responder(p.chave, "", dado));
      return depois(p.atrasoSeg / 2, () => responder(p.chave, "Confirmo o pedido, vamos separar o material."));
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
      if (p) reagir(p, texto, opcoes);
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
