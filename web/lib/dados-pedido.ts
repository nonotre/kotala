// Leitura do pedido para as abas de /pedidos/[id]. Só leitura, como lib/dados.ts:
// junta o detalhe do pedido com o que as abas mostram a mais (todas as rodadas de
// cotação, as propostas como chegaram e os mapas anteriores).
//
// `pedidoCompleto` usa o `cache` do React: o layout e a aba leem o mesmo pedido
// na mesma requisição sem ir ao banco duas vezes.

import { cache } from "react";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../../src/nucleo/db/cliente.ts";
import { cotacao, fornecedor, mapaCotacao, oferta } from "../../src/nucleo/db/schema.ts";
import { colunaDoItem, FINAIS_ITEM } from "../../src/nucleo/orquestrador/estados.ts";
import { detalhePedido, type Comparacao } from "./dados";

export { colunaDoItem, FINAIS_ITEM };

export type FornecedorCurto = { id: string; nome: string; simulado: boolean };

export const pedidoCompleto = cache(async (id: number) => {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const d = await detalhePedido(id);
  if (!d) return null;
  const ids = d.itens.map((i) => i.item.id);

  const [cotacoes, ofertas, mapas] = ids.length
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
      ])
    : [[], [], []];

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

  const itens = d.itens.map((i) => {
    const id = i.item.id;
    const doItem = mapas.filter((m) => m.itemPedidoId === id).map((m) => ({ ...m, comparacao: m.dados as Comparacao }));
    // Um mapa por rodada: o último de cada uma (o mapa é refeito quando um fornecedor sai ou confirma o preço).
    const porRodada = [...new Map(doItem.map((m) => [m.rodada, m])).values()];
    const escolhida = i.mapa?.comparacao.validas.find((l) => l.oferta.id === i.item.ofertaEscolhidaId) ?? null;
    return {
      ...i,
      coluna: colunaDoItem(d.pedido.estado, i.item.estado),
      /** Cotações de todas as rodadas; `cotacoes` traz só a rodada atual. */
      cotacoesTodas: cotacoes.filter((c) => c.cotacao.itemPedidoId === id),
      ofertas: ofertas.filter((o) => o.itemPedidoId === id),
      mapasPorRodada: porRodada,
      /** A linha do mapa da oferta aprovada, quando ainda está no mapa atual. */
      escolhida,
      escolhido: i.item.fornecedorEscolhidoId ? (fornecedores[i.item.fornecedorEscolhidoId] ?? null) : null,
    };
  });

  return { pedido: d.pedido, dono: d.dono, itens, linhaDoTempo: d.linhaDoTempo, fornecedores };
});

export type DadosPedido = NonNullable<Awaited<ReturnType<typeof pedidoCompleto>>>;
export type ItemDoPedido = DadosPedido["itens"][number];
