// Leitura do pedido para as abas de /pedidos/[id]. Só leitura, como lib/dados.ts:
// junta o detalhe do pedido com o que as abas mostram a mais (todas as rodadas de
// cotação, as propostas como chegaram e os mapas anteriores).
//
// `pedidoCompleto` usa o `cache` do React: o layout e a aba leem o mesmo pedido
// na mesma requisição sem ir ao banco duas vezes.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cache } from "react";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../src/nucleo/db/cliente.ts";
import { cotacao, evento, fornecedor, itemCatalogo, itemPedido, mapaCotacao, oferta } from "../../src/nucleo/db/schema.ts";
import { colunaDoItem, FINAIS_ITEM } from "../../src/nucleo/orquestrador/estados.ts";
import { detalhePedido, type Comparacao } from "./dados";
import { contatosSimulados } from "./dados-simulado";

export { colunaDoItem, FINAIS_ITEM };

export type FornecedorCurto = { id: string; nome: string; simulado: boolean };

/** Estados do pedido (não do item): separam as transições do pedido na linha do tempo. */
const ESTADOS_SO_DO_PEDIDO = ["interpretando", "aguardando_confirmacao", "em_andamento"];

let categoriasBase: Map<string, string> | null = null;

/**
 * Categoria por código na base fixa de itens (`src/dados/itens.json`, fora do git: pode faltar).
 * O `item_chave` do item é esse código quando o item casou com a base. Sem o arquivo, mapa vazio.
 */
function categoriasDaBase(): Map<string, string> {
  if (categoriasBase) return categoriasBase;
  try {
    const arquivo = join(/*turbopackIgnore: true*/ process.cwd(), "..", "src", "dados", "itens.json");
    const { itens } = JSON.parse(readFileSync(arquivo, "utf8")) as { itens: { id: string; categoria?: string | null }[] };
    categoriasBase = new Map(itens.filter((i) => i.categoria).map((i) => [i.id, i.categoria!]));
  } catch {
    categoriasBase = new Map();
  }
  return categoriasBase;
}

export const pedidoCompleto = cache(async (id: number) => {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const d = await detalhePedido(id);
  if (!d) return null;
  const ids = d.itens.map((i) => i.item.id);

  const chaves = [...new Set(d.itens.map((i) => i.item.itemChave).filter((c): c is string => !!c))];

  const [cotacoes, ofertas, mapas, catalogo] = ids.length
    ? await Promise.all([
        db
          .select({
            cotacao,
            nome: fornecedor.nome,
            origem: fornecedor.origem,
            verificado: fornecedor.verificado,
            homologado: fornecedor.homologado,
            regiao: fornecedor.regiao,
            fonte: fornecedor.fonte,
          })
          .from(cotacao)
          .innerJoin(fornecedor, eq(fornecedor.id, cotacao.fornecedorId))
          .where(inArray(cotacao.itemPedidoId, ids))
          .orderBy(asc(cotacao.rodada), asc(fornecedor.nome)),
        db
          .select({
            id: oferta.id,
            itemPedidoId: oferta.itemPedidoId,
            fornecedorId: oferta.fornecedorId,
            nome: fornecedor.nome,
            origem: fornecedor.origem,
            rodada: oferta.rodada,
            itemOferecido: oferta.itemOferecido,
            itemExato: oferta.itemExato,
            embalagem: oferta.embalagem,
            quantidadeOfertada: oferta.quantidadeOfertada,
            unidadeOfertada: oferta.unidadeOfertada,
            precoUnitario: oferta.precoUnitario,
            totalProduto: oferta.totalProduto,
            frete: oferta.frete,
            prazoDias: oferta.prazoDias,
            validadeDias: oferta.validadeDias,
            pagamento: oferta.pagamento,
            impostosNaoInclusos: oferta.impostosNaoInclusos,
            formato: oferta.formato,
            fonte: oferta.fonte,
            precoConfirmado: oferta.precoConfirmado,
            criadoEm: oferta.criadoEm,
          })
          .from(oferta)
          .innerJoin(fornecedor, eq(fornecedor.id, oferta.fornecedorId))
          .where(inArray(oferta.itemPedidoId, ids))
          .orderBy(asc(oferta.rodada), asc(oferta.criadoEm)),
        db
          .select({ id: mapaCotacao.id, itemPedidoId: mapaCotacao.itemPedidoId, rodada: mapaCotacao.rodada, dados: mapaCotacao.dados, criadoEm: mapaCotacao.criadoEm })
          .from(mapaCotacao)
          .where(inArray(mapaCotacao.itemPedidoId, ids))
          .orderBy(asc(mapaCotacao.criadoEm)),
        // Categoria do item: o catálogo cadastrado pelo agente usa o código como `item_chave`.
        chaves.length ? db.select({ codigo: itemCatalogo.codigo, categoria: itemCatalogo.categoria }).from(itemCatalogo).where(inArray(itemCatalogo.codigo, chaves)) : Promise.resolve([]),
      ])
    : [[], [], [], []];
  const categoriaCatalogo = new Map(catalogo.filter((c) => c.categoria).map((c) => [c.codigo, c.categoria!]));

  // Nomes de quem aparece por id no item: o escolhido, os alvos da negociação e os tirados do mapa.
  const idsFornecedor = new Set<string>();
  for (const { item } of d.itens) {
    if (item.fornecedorEscolhidoId) idsFornecedor.add(item.fornecedorEscolhidoId);
    for (const a of item.negociacao?.alvos ?? []) idsFornecedor.add(a);
    for (const e of item.excluidos) idsFornecedor.add(e);
  }
  const nomes = idsFornecedor.size
    ? await db.select({ id: fornecedor.id, nome: fornecedor.nome, origem: fornecedor.origem }).from(fornecedor).where(inArray(fornecedor.id, [...idsFornecedor]))
    : [];
  const fornecedores: Record<string, FornecedorCurto> = Object.fromEntries(nomes.map((f) => [f.id, { id: f.id, nome: f.nome, simulado: f.origem === "simulado" }]));

  // Liria: os cards da Busca mostram quantos pedidos já foram confirmados com cada fornecedor consultado.
  const idsConsultados = [...new Set(cotacoes.map((c) => c.cotacao.fornecedorId))];
  const confirmadosLinhas = idsConsultados.length
    ? await db
        .select({ fornecedorId: itemPedido.fornecedorEscolhidoId, n: sql<number>`count(*)::int` })
        .from(itemPedido)
        .where(and(inArray(itemPedido.fornecedorEscolhidoId, idsConsultados), inArray(itemPedido.estado, ["pedido_enviado", "confirmado"])))
        .groupBy(itemPedido.fornecedorEscolhidoId)
    : [];
  const pedidosConfirmados: Record<string, number> = Object.fromEntries(confirmadosLinhas.map((l) => [l.fornecedorId!, l.n]));

  // T8: o chat simulado de cada fornecedor simulado do pedido, para o botão "Ser o fornecedor" nas abas.
  const idsSimulados = new Set<string>();
  for (const c of cotacoes) if (c.origem === "simulado") idsSimulados.add(c.cotacao.fornecedorId);
  for (const o of ofertas) if (o.origem === "simulado") idsSimulados.add(o.fornecedorId);
  for (const f of nomes) if (f.origem === "simulado") idsSimulados.add(f.id);
  const chatsSimulados = await contatosSimulados([...idsSimulados]);

  const itens = d.itens.map((i) => {
    const id = i.item.id;
    const doItem = mapas.filter((m) => m.itemPedidoId === id).map((m) => ({ ...m, comparacao: m.dados as Comparacao }));
    // Um mapa por rodada: o último de cada uma (o mapa é refeito quando um fornecedor sai ou confirma o preço).
    const porRodada = [...new Map(doItem.map((m) => [m.rodada, m])).values()];
    const escolhida = i.mapa?.comparacao.validas.find((l) => l.oferta.id === i.item.ofertaEscolhidaId) ?? null;
    // Q6: quantos mapas a rodada atual já teve (mais de um = o mapa foi atualizado).
    const versoesDoMapa = i.mapa ? doItem.filter((m) => m.rodada === i.mapa!.rodada).length : 0;
    return {
      ...i,
      coluna: colunaDoItem(d.pedido.estado, i.item.estado),
      /** Cotações de todas as rodadas; `cotacoes` traz só a rodada atual. */
      cotacoesTodas: cotacoes.filter((c) => c.cotacao.itemPedidoId === id),
      ofertas: ofertas.filter((o) => o.itemPedidoId === id),
      mapasPorRodada: porRodada,
      versoesDoMapa,
      /** A linha do mapa da oferta aprovada, quando ainda está no mapa atual. */
      escolhida,
      escolhido: i.item.fornecedorEscolhidoId ? (fornecedores[i.item.fornecedorEscolhidoId] ?? null) : null,
      /** Do catálogo do banco; senão, da base fixa de itens. Nenhum dos dois: null. */
      categoria: i.item.itemChave ? (categoriaCatalogo.get(i.item.itemChave) ?? categoriasDaBase().get(i.item.itemChave) ?? null) : null,
    };
  });

  // R14b: a pergunta do prazo (encerrar ou estender) e a prioridade, lidas dos eventos da rodada atual,
  // com a mesma regra de src/agentes/cotador/prazo.ts (situacaoDoPrazo). Sem importar aquele módulo: ele
  // puxa a busca e o simulador, que o build das telas não carrega.
  const doPrazo = ids.length
    ? await db
        .select({ itemPedidoId: evento.itemPedidoId, dados: evento.dados, criadoEm: evento.criadoEm })
        .from(evento)
        .where(and(inArray(evento.itemPedidoId, ids), sql`${evento.dados}->>'tipo' in ('prazo_pergunta', 'prazo_resposta')`))
        .orderBy(desc(evento.criadoEm))
    : [];
  const itensComPrazo = itens.map((i) => {
    const daRodada = doPrazo
      .filter((e) => e.itemPedidoId === i.item.id && Number((e.dados as { rodada?: unknown })?.rodada) === i.item.rodada)
      .map((e) => e.dados as { tipo: string; escolha?: string });
    return {
      ...i,
      /** R14b: o prazo venceu com menos de 3 propostas e o comprador ainda não escolheu encerrar ou estender. */
      perguntaPrazo: i.item.estado === "cotando" && daRodada[0]?.tipo === "prazo_pergunta",
      /** R14b: o comprador estendeu o prazo nesta rodada (cotação com prioridade). */
      prioridade: daRodada.some((x) => x.tipo === "prazo_resposta" && x.escolha === "estender"),
    };
  });

  // Quando o comprador confirmou ou cancelou, pela transição do pedido na linha do tempo (a última vale).
  const transicoes = d.linhaDoTempo.filter((e) => e.tipo === "evento" && e.deEstado && ESTADOS_SO_DO_PEDIDO.includes(e.deEstado));
  const ultima = (para: string, de?: string) => transicoes.findLast((e) => e.tipo === "evento" && e.paraEstado === para && (!de || e.deEstado === de))?.em ?? null;
  const confirmadoEm = ultima("em_andamento", "aguardando_confirmacao");
  const canceladoEm = d.pedido.estado === "cancelado" ? ultima("cancelado") : null;

  return {
    pedido: d.pedido,
    dono: d.dono,
    itens: itensComPrazo,
    linhaDoTempo: d.linhaDoTempo,
    fornecedores,
    confirmadoEm,
    canceladoEm,
    /** T8: por id do fornecedor simulado, o `contato.id` do chat dele em /telegram-simulado. */
    chatsSimulados,
    /** Por id de fornecedor consultado: pedidos confirmados com ele (cards da Busca). */
    pedidosConfirmados,
  };
});

export type DadosPedido = NonNullable<Awaited<ReturnType<typeof pedidoCompleto>>>;
export type ItemDoPedido = DadosPedido["itens"][number];
