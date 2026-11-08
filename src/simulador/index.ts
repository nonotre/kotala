// Canal "simulado": recebe o que o sistema manda aos fornecedores simulados e
// responde sozinho, depois de um atraso, entrando pela mesma receber() que um
// fornecedor real usaria. O que ele responde depende da persona.

import { eq, inArray } from "drizzle-orm";
import { SIM_ATRASO_FATOR } from "../config.ts";
import { db } from "../nucleo/db/cliente.ts";
import { contato, fornecedor, itemPedido, pedido, type Anexo } from "../nucleo/db/schema.ts";
import { receber, type AdaptadorCanal, type OpcoesEnvio } from "../nucleo/mensagens/index.ts";
import { referenciasDoItem } from "../agentes/busca/internet.ts";
import { pdfDeTexto } from "./pdf.ts";
import {
  PERGUNTA_ANTES,
  PERSONAS_EXTRAS,
  TODAS_PERSONAS,
  linhasOrcamentoPdf,
  respostaAoDesconto,
  textoComplemento,
  textoEsclarecePreco,
  textoProposta,
  textoSegundaParte,
  unitarioDaRodada,
  type ItemPedido,
  type Persona,
} from "./personas.ts";

const personaPorChave = new Map(TODAS_PERSONAS.map((p) => [p.chave, p]));
/** Quem já perguntou antes de cotar, por item. */
const perguntou = new Set<string>();
/** Quem "esqueceu" e espera o lembrete, por item. */
const esperandoLembrete = new Set<string>();
/** Já completou a proposta depois do pedido do assistente. */
const completou = new Set<string>();
/** Última proposta mandada, por persona e item: a rodada e o unitário (para o desconto sair dele). */
const ultimaProposta = new Map<string, { rodada: number; unit: number }>();
/** Já respondeu ao pedido automático de desconto, por persona, item e rodada. */
const respondeuDesconto = new Set<string>();
/** PDFs mandados pela persona "pdf", pela referência do anexo. */
const pdfs = new Map<string, Uint8Array>();
let seq = 0;

function depois(seg: number, fn: () => Promise<unknown>) {
  const ms = Math.max(500, seg * 1000 * SIM_ATRASO_FATOR());
  setTimeout(() => fn().catch((e) => console.error("[simulador]", e)), ms).unref?.();
}

async function responder(endereco: string, texto: string, botao?: string, anexos?: Anexo[]) {
  await receber({ canal: "simulado", endereco, idExterno: `sim-${Date.now()}-${++seq}`, texto, botao, anexos });
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

/**
 * O pedido de desconto (tipo "negociacao") é o automático, dentro da mesma rodada da proposta, ou a
 * rodada nova do botão do comprador? A rodada do botão é sempre ≥ 2 e chega antes de qualquer proposta dela.
 */
export function ehDescontoAutomatico(ultima: { rodada: number } | undefined, rodadaDoItem: number): boolean {
  return ultima ? ultima.rodada === rodadaDoItem : rodadaDoItem === 1;
}

async function enviarProposta(p: Persona, opcoes: OpcoesEnvio) {
  const item = await itemDa(opcoes);
  if (!item) return;
  const { mediana } = await referenciasDoItem(opcoes.itemPedidoId!);
  const chaveItem = `${p.chave}:${opcoes.itemPedidoId}`;
  const unit = unitarioDaRodada(p, item, item.rodada, mediana);
  if (unit !== null) ultimaProposta.set(chaveItem, { rodada: item.rodada, unit });
  const texto = textoProposta(p, item, item.rodada, mediana);
  if (!texto) return;
  if (p.comportamento === "pdf" && unit !== null) {
    const ref = `sim-pdf-${Date.now()}-${++seq}`;
    const dados = pdfDeTexto(linhasOrcamentoPdf(p, item, unit));
    pdfs.set(ref, dados);
    await responder(p.chave, texto, undefined, [{ tipo: "pdf", mediaType: "application/pdf", ref, nome: `orcamento-${opcoes.itemPedidoId}.pdf`, tamanho: dados.length }]);
    return;
  }
  const emDuas = p.comportamento === "duas_mensagens" && unit !== null;
  // As condições chegam depois, numa mensagem separada; o pedido do que faltou não ganha outra resposta.
  // Marca antes de responder: a resposta do sistema chega dentro do receber().
  if (emDuas) completou.add(chaveItem);
  await responder(p.chave, texto);
  if (emDuas) depois(p.atrasoSeg / 2, () => responder(p.chave, textoSegundaParte(p, item)));
}

/** Pedido automático de desconto: a persona responde do jeito dela, a partir do preço que mandou. */
async function responderDesconto(p: Persona, opcoes: OpcoesEnvio, item: ItemPedido & { rodada: number }) {
  const chaveItem = `${p.chave}:${opcoes.itemPedidoId}`;
  const marca = `${chaveItem}:${item.rodada}`;
  if (respondeuDesconto.has(marca)) return;
  respondeuDesconto.add(marca);
  let unit = ultimaProposta.get(chaveItem)?.unit ?? null;
  if (unit === null) unit = unitarioDaRodada(p, item, item.rodada, (await referenciasDoItem(opcoes.itemPedidoId!)).mediana);
  if (unit === null) return;
  const falas = respostaAoDesconto(p, item, unit);
  if (p.desconto === "novo_preco" || p.desconto === "vou_ver") {
    ultimaProposta.set(chaveItem, { rodada: item.rodada, unit: Math.round(unit * (1 - (p.descontoPct ?? 5) / 100) * 100) / 100 });
  }
  for (const f of falas) depois(p.atrasoSeg * f.atraso, () => responder(p.chave, f.texto));
}

async function reagir(p: Persona, _texto: string, opcoes: OpcoesEnvio) {
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
      // Resposta à dúvida: agora cota (uma vez).
      if (perguntou.has(chaveItem) && !ultimaProposta.has(chaveItem)) return depois(p.atrasoSeg / 2, () => enviarProposta(p, opcoes));
      return;
    case "negociacao": {
      const item = await itemDa(opcoes);
      if (!item) return;
      // I1: pedido automático na mensagem "Recebi sua proposta", na mesma rodada.
      if (ehDescontoAutomatico(ultimaProposta.get(chaveItem), item.rodada)) return responderDesconto(p, opcoes, item);
      // Rodada do botão do comprador: quem esquece não responde; os outros melhoram a proposta.
      if (p.comportamento === "esquece") return;
      return depois(p.atrasoSeg, () => enviarProposta(p, opcoes));
    }
    case "completar_proposta": {
      // O assistente pediu o que faltou: o simulado completa, uma vez por item.
      if (completou.has(chaveItem)) return;
      completou.add(chaveItem);
      const item = await itemDa(opcoes);
      const unit = ultimaProposta.get(chaveItem)?.unit;
      // R5: a persona do preço ambíguo responde se era unitário ou total.
      if (p.comportamento === "ambiguo" && item && unit !== undefined) return depois(p.atrasoSeg / 2, () => responder(p.chave, textoEsclarecePreco(item, unit)));
      return depois(p.atrasoSeg / 2, () => responder(p.chave, textoComplemento(p, item ?? undefined)));
    }
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
      if (p) reagir(p, texto, opcoes).catch((e) => console.error("[simulador]", e));
      return { idExterno: `sim-out-${Date.now()}-${++seq}` };
    },
    async baixar(ref) {
      const dados = pdfs.get(ref);
      if (!dados) throw new Error(`Anexo simulado ${ref} não existe (o simulador foi reiniciado?).`);
      return { dados, mediaType: "application/pdf" };
    },
  };
}

/**
 * Cria ou atualiza os fornecedores simulados e seus contatos no canal "simulado".
 * As personas de situação difícil (`PERSONAS_EXTRAS`) só entram com `extras`, para a demo não mudar.
 */
export async function semearSimulados(opcoes: { extras?: boolean } = {}) {
  const extras = new Set(PERSONAS_EXTRAS.map((p) => p.chave));
  const lista = TODAS_PERSONAS.filter((p) => opcoes.extras || !extras.has(p.chave));
  for (const p of lista) {
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
  return db.select({ id: fornecedor.id }).from(fornecedor).where(inArray(fornecedor.chave, lista.map((p) => p.chave)));
}
