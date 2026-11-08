// Métricas do harness sobre um pedido (Frente 3): desconto obtido por rodada e
// mensagens seguidas ao fornecedor sem resposta (U3). As contas são funções puras
// sobre linhas do banco; `metricasDoPedido` só carrega as linhas.

import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../nucleo/db/cliente.ts";
import { contato, fornecedor, itemPedido, mensagem, oferta } from "../nucleo/db/schema.ts";
import { marcaDe, produtoDe, type MarcaNegociacao } from "../agentes/negociador/index.ts";

const centavos = (v: number) => Math.round(v * 100) / 100;

// ---------- Desconto por rodada ----------

export type LinhaOferta = {
  itemPedidoId: number;
  fornecedorId: string;
  rodada: number;
  precoUnitario: number | null;
  totalProduto: number | null;
  quantidade: number;
  marca: MarcaNegociacao | null;
};

export type DescontoAutomatico = {
  pedidos: number;
  /** Por resultado: desconto, manteve, subiu, condicional, sem_resposta e "aberto" (sem resposta ainda). */
  resultados: Record<string, number>;
  /** Soma do que baixou no produto, em reais. */
  economia: number;
  /** Desconto médio, em %, entre quem deu desconto. */
  percentualMedio: number | null;
};

export type RodadaComprador = {
  /** Rodada que pediu preço melhor (≥ 2) contra a anterior, por fornecedor que respondeu às duas. */
  rodada: number;
  fornecedores: number;
  baixaram: number;
  economia: number;
};

export type MetricasDesconto = { automatico: Record<number, DescontoAutomatico>; botao: RodadaComprador[] };

/** Desconto do pedido automático (por rodada) e da rodada do botão do comprador (a proposta da rodada contra a da anterior). */
export function descontoPorRodada(ofertas: readonly LinhaOferta[]): MetricasDesconto {
  const automatico: Record<number, DescontoAutomatico> = {};
  for (const o of ofertas) {
    if (!o.marca) continue;
    const a = (automatico[o.rodada] ??= { pedidos: 0, resultados: {}, economia: 0, percentualMedio: null });
    a.pedidos++;
    const r = o.marca.resultado ?? "aberto";
    a.resultados[r] = (a.resultados[r] ?? 0) + 1;
    if (r === "desconto" && o.marca.descontoProduto) a.economia = centavos(a.economia + o.marca.descontoProduto);
  }
  for (const [rodada, a] of Object.entries(automatico)) {
    const pcts = ofertas
      .filter((o) => o.rodada === Number(rodada) && o.marca?.resultado === "desconto" && o.marca.produtoAntes && o.marca.produtoDepois !== undefined && o.marca.produtoDepois !== null)
      .map((o) => (1 - o.marca!.produtoDepois! / o.marca!.produtoAntes!) * 100);
    a.percentualMedio = pcts.length ? Math.round((pcts.reduce((s, x) => s + x, 0) / pcts.length) * 10) / 10 : null;
  }

  const porChave = new Map<string, LinhaOferta>();
  for (const o of ofertas) porChave.set(`${o.itemPedidoId}:${o.fornecedorId}:${o.rodada}`, o);
  const botao = new Map<string, RodadaComprador>();
  for (const o of ofertas) {
    if (o.rodada < 2) continue;
    const ant = porChave.get(`${o.itemPedidoId}:${o.fornecedorId}:${o.rodada - 1}`);
    if (!ant) continue;
    const antes = produtoDe(ant, ant.quantidade);
    const depois = produtoDe(o, o.quantidade);
    if (antes === null || depois === null) continue;
    const chave = `${o.itemPedidoId}:${o.rodada}`;
    const b = botao.get(chave) ?? { rodada: o.rodada, fornecedores: 0, baixaram: 0, economia: 0 };
    b.fornecedores++;
    if (depois < antes) {
      b.baixaram++;
      b.economia = centavos(b.economia + antes - depois);
    }
    botao.set(chave, b);
  }
  return { automatico, botao: [...botao.values()] };
}

// ---------- Mensagens seguidas sem resposta ----------

export type LinhaMensagem = { contatoId: string; direcao: "entrada" | "saida"; criadoEm: Date };

export type Cadencia = {
  /** Por contato: mensagens mandadas, a maior sequência sem resposta e quantas vezes saíram 2+ seguidas. */
  porContato: Record<string, { saidas: number; entradas: number; maiorSequencia: number; vezesDuasSeguidas: number }>;
  vezesDuasSeguidas: number;
  maiorSequencia: number;
};

/** U3: quantas vezes o sistema mandou duas (ou mais) mensagens seguidas ao mesmo fornecedor sem resposta entre elas. */
export function mensagensSemResposta(linhas: readonly LinhaMensagem[]): Cadencia {
  const porContato: Cadencia["porContato"] = {};
  const ordenadas = [...linhas].sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime());
  const seq = new Map<string, number>();
  for (const l of ordenadas) {
    const c = (porContato[l.contatoId] ??= { saidas: 0, entradas: 0, maiorSequencia: 0, vezesDuasSeguidas: 0 });
    if (l.direcao === "entrada") {
      c.entradas++;
      seq.set(l.contatoId, 0);
      continue;
    }
    c.saidas++;
    const n = (seq.get(l.contatoId) ?? 0) + 1;
    seq.set(l.contatoId, n);
    c.maiorSequencia = Math.max(c.maiorSequencia, n);
    if (n === 2) c.vezesDuasSeguidas++;
  }
  const valores = Object.values(porContato);
  return {
    porContato,
    vezesDuasSeguidas: valores.reduce((s, c) => s + c.vezesDuasSeguidas, 0),
    maiorSequencia: valores.reduce((s, c) => Math.max(s, c.maiorSequencia), 0),
  };
}

// ---------- Banco ----------

export type MetricasPedido = { pedidoId: number; desconto: MetricasDesconto; cadencia: Cadencia; nomes: Record<string, string> };

export async function metricasDoPedido(pedidoId: number): Promise<MetricasPedido> {
  const itens = await db.select({ id: itemPedido.id, quantidade: itemPedido.quantidade }).from(itemPedido).where(eq(itemPedido.pedidoId, pedidoId));
  const qtd = new Map(itens.map((i) => [i.id, Number(i.quantidade)]));
  const ofertas = itens.length
    ? await db
        .select({ itemPedidoId: oferta.itemPedidoId, fornecedorId: oferta.fornecedorId, rodada: oferta.rodada, precoUnitario: oferta.precoUnitario, totalProduto: oferta.totalProduto, extraido: oferta.extraido })
        .from(oferta)
        .where(inArray(oferta.itemPedidoId, [...qtd.keys()]))
    : [];
  const linhasOferta: LinhaOferta[] = ofertas.map((o) => ({
    itemPedidoId: o.itemPedidoId,
    fornecedorId: o.fornecedorId,
    rodada: o.rodada,
    precoUnitario: o.precoUnitario === null ? null : Number(o.precoUnitario),
    totalProduto: o.totalProduto === null ? null : Number(o.totalProduto),
    quantidade: qtd.get(o.itemPedidoId) ?? 0,
    marca: marcaDe(o.extraido),
  }));

  // Conversa com cada fornecedor do pedido, desde a primeira mensagem do pedido a ele.
  const saidas = await db
    .select({ contatoId: mensagem.contatoId, criadoEm: mensagem.criadoEm, nome: fornecedor.nome })
    .from(mensagem)
    .innerJoin(contato, eq(contato.id, mensagem.contatoId))
    .innerJoin(fornecedor, eq(fornecedor.id, contato.fornecedorId))
    .where(and(eq(mensagem.pedidoId, pedidoId), eq(mensagem.direcao, "saida"), eq(contato.papel, "fornecedor")))
    .orderBy(asc(mensagem.criadoEm));
  const inicio = new Map<string, Date>();
  const nomes: Record<string, string> = {};
  for (const s of saidas) {
    if (!inicio.has(s.contatoId)) inicio.set(s.contatoId, s.criadoEm);
    nomes[s.contatoId] = s.nome;
  }
  const linhasMsg: LinhaMensagem[] = [];
  for (const [contatoId, desde] of inicio) {
    const ms = await db
      .select({ contatoId: mensagem.contatoId, direcao: mensagem.direcao, criadoEm: mensagem.criadoEm, pedidoId: mensagem.pedidoId })
      .from(mensagem)
      .where(and(eq(mensagem.contatoId, contatoId), gte(mensagem.criadoEm, desde)));
    // Saídas de outros pedidos ficam de fora; entradas sem pedido contam como resposta.
    linhasMsg.push(...ms.filter((m) => m.direcao === "entrada" || m.pedidoId === pedidoId));
  }
  return { pedidoId, desconto: descontoPorRodada(linhasOferta), cadencia: mensagensSemResposta(linhasMsg), nomes };
}

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function textoMetricas(m: MetricasPedido): string {
  const linhas = [`Métricas do pedido ${m.pedidoId}`];
  const auto = Object.entries(m.desconto.automatico);
  if (!auto.length) linhas.push("  Desconto automático: nenhum pedido de desconto.");
  for (const [rodada, a] of auto) {
    const res = Object.entries(a.resultados).map(([k, n]) => `${k} ${n}`).join(", ");
    linhas.push(`  Desconto automático, rodada ${rodada}: ${a.pedidos} pedido(s) (${res}); economia ${brl(a.economia)}${a.percentualMedio !== null ? `, média ${String(a.percentualMedio).replace(".", ",")}%` : ""}.`);
  }
  for (const b of m.desconto.botao) linhas.push(`  Rodada ${b.rodada} (botão do comprador): ${b.baixaram} de ${b.fornecedores} baixaram; economia ${brl(b.economia)}.`);
  linhas.push(`  Mensagens seguidas sem resposta: ${m.cadencia.vezesDuasSeguidas} vez(es) com 2+; maior sequência ${m.cadencia.maiorSequencia}.`);
  for (const [id, c] of Object.entries(m.cadencia.porContato)) {
    if (c.vezesDuasSeguidas) linhas.push(`    ${m.nomes[id] ?? id}: ${c.saidas} mandadas, ${c.entradas} recebidas, maior sequência ${c.maiorSequencia}.`);
  }
  return linhas.join("\n");
}
