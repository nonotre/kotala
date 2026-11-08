// Leitura do banco para o dashboard de economia (especificação da Ester em
// docs/workspaces/ester-workspace/interface-dashboard.md). Uma linha por pedido;
// os filtros e os gráficos são montados na tela, a partir destas linhas.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desc, inArray, sql } from "drizzle-orm";
import { db } from "../../src/nucleo/db/cliente.ts";
import { cotacao, itemCatalogo, itemPedido, mapaCotacao, mensagem, pedido, usoIa } from "../../src/nucleo/db/schema.ts";
import type { EstadoItem, EstadoPedido } from "../../src/nucleo/orquestrador/estados.ts";
import type { Comparacao } from "../../src/agentes/comparador/calculo.ts";

export type StatusRequisicao = "concluida" | "andamento" | "iniciar" | "cancelada";

export type LinhaPedido = {
  id: number;
  /** ISO, para atravessar a fronteira servidor → cliente. */
  criadoEm: string;
  setor: string | null;
  categorias: string[];
  status: StatusRequisicao;
  /** Requisição aberta que passou do prazo que o comprador deu. */
  atrasado: boolean;
  /** Itens com pedido enviado ao fornecedor (enviado ou já confirmado). */
  emitidos: number;
  /** Itens com compra confirmada, os que entram nas contas de gasto. */
  comprados: number;
  /** Soma do custo das compras confirmadas (produto, frete e impostos). */
  gasto: number | null;
  /** O mesmo, com o preço do produto antes da negociação: o que teria custado sem ela. */
  inicial: number | null;
  /** Soma, por item comprado, da média do custo das propostas válidas do mapa. */
  mediaMapa: number | null;
  simulado: boolean;
};

export type Dashboard = {
  pedidos: LinhaPedido[];
  trabalho: { cotacoes: number; mensagensEntrada: number; mensagensSaida: number; chamadasIa: number };
};

const EMITIDOS: readonly EstadoItem[] = ["pedido_enviado", "confirmado"];
const DIA_MS = 86_400_000;

function statusDoPedido(estado: EstadoPedido): StatusRequisicao {
  if (estado === "concluido") return "concluida";
  if (estado === "cancelado") return "cancelada";
  if (estado === "em_andamento") return "andamento";
  return "iniciar"; // interpretando ou aguardando a confirmação do comprador
}

/** Categoria pelo código do item: base fixa da Ester (src/dados, fora do git) e itens que o agente cadastrou. */
let baseFixa: Map<string, string> | null = null;
function categoriasDaBase(): Map<string, string> {
  if (baseFixa) return baseFixa;
  try {
    // As telas rodam em web/ (dev e container); o núcleo fica ao lado, em ../src.
    const arquivo = resolve(process.cwd(), "../src/dados/itens.json");
    const { itens } = JSON.parse(readFileSync(arquivo, "utf8")) as { itens: { id: string; categoria: string }[] };
    baseFixa = new Map(itens.map((i) => [i.id, i.categoria]));
  } catch {
    baseFixa = new Map();
  }
  return baseFixa;
}

const centavos = (v: number) => Math.round(v * 100) / 100;
const somaOuNulo = (vs: (number | null)[]) => (vs.some((v) => v !== null) ? centavos(vs.reduce<number>((t, v) => t + (v ?? 0), 0)) : null);

export async function dashboard(): Promise<Dashboard> {
  const pedidos = await db.select().from(pedido).orderBy(desc(pedido.criadoEm));
  const itens = pedidos.length ? await db.select().from(itemPedido).where(inArray(itemPedido.pedidoId, pedidos.map((p) => p.id))) : [];

  // Último mapa de cada item comprado: é nele que estão a proposta escolhida e as demais.
  const comprados = itens.filter((i) => i.estado === "confirmado");
  const mapas = comprados.length
    ? await db
        .selectDistinctOn([mapaCotacao.itemPedidoId], { itemPedidoId: mapaCotacao.itemPedidoId, dados: mapaCotacao.dados })
        .from(mapaCotacao)
        .where(inArray(mapaCotacao.itemPedidoId, comprados.map((i) => i.id)))
        .orderBy(mapaCotacao.itemPedidoId, desc(mapaCotacao.criadoEm))
    : [];
  const mapaDoItem = new Map(mapas.map((m) => [m.itemPedidoId, m.dados as Comparacao]));

  const base = categoriasDaBase();
  const catalogo = new Map((await db.select({ codigo: itemCatalogo.codigo, categoria: itemCatalogo.categoria }).from(itemCatalogo)).map((c) => [c.codigo, c.categoria]));
  const categoria = (chave: string | null) => (chave ? (base.get(chave) ?? catalogo.get(chave) ?? null) : null);

  const agora = Date.now();
  const linhas: LinhaPedido[] = pedidos.map((p) => {
    const doPedido = itens.filter((i) => i.pedidoId === p.id);
    const status = statusDoPedido(p.estado);
    const contas = doPedido
      .filter((i) => i.estado === "confirmado")
      .map((i) => {
        const c = mapaDoItem.get(i.id);
        const escolhida = c?.validas.find((l) => l.oferta.id === i.ofertaEscolhidaId) ?? null;
        const custo = escolhida?.custo ?? null;
        const produto = escolhida?.produto ?? null;
        const anterior = escolhida?.oferta.produtoAnterior ?? null;
        // Só a negociação conta como economia: o produto baixou entre a primeira proposta e a final.
        const negociado = anterior !== null && produto !== null ? Math.max(0, anterior - produto) : 0;
        const custos = (c?.validas ?? []).map((l) => l.custo).filter((v): v is number => v !== null);
        return {
          custo,
          inicial: custo !== null ? custo + negociado : null,
          media: custos.length ? custos.reduce((a, b) => a + b, 0) / custos.length : null,
          simulado: escolhida?.oferta.simulado ?? false,
        };
      });
    return {
      id: p.id,
      criadoEm: p.criadoEm.toISOString(),
      setor: p.setor?.trim() || null,
      categorias: [...new Set(doPedido.map((i) => categoria(i.itemChave)).filter((c): c is string => !!c))].sort(),
      status,
      atrasado: (status === "andamento" || status === "iniciar") && p.prazoMaxDias !== null && agora > p.criadoEm.getTime() + p.prazoMaxDias * DIA_MS,
      emitidos: doPedido.filter((i) => EMITIDOS.includes(i.estado)).length,
      comprados: contas.length,
      gasto: somaOuNulo(contas.map((c) => c.custo)),
      inicial: somaOuNulo(contas.map((c) => c.inicial)),
      mediaMapa: somaOuNulo(contas.map((c) => c.media)),
      simulado: contas.some((c) => c.simulado),
    };
  });

  const [ia] = await db.select({ n: sql<number>`count(*)::int` }).from(usoIa);
  const [msgs] = await db.select({ entrada: sql<number>`count(*) filter (where ${mensagem.direcao} = 'entrada')::int`, saida: sql<number>`count(*) filter (where ${mensagem.direcao} = 'saida')::int` }).from(mensagem);
  const [cots] = await db.select({ n: sql<number>`count(*)::int` }).from(cotacao);

  return {
    pedidos: linhas,
    trabalho: { cotacoes: cots?.n ?? 0, mensagensEntrada: msgs?.entrada ?? 0, mensagensSaida: msgs?.saida ?? 0, chamadasIa: ia?.n ?? 0 },
  };
}
