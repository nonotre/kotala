// Rastreio: reconstrói o estado exato de qualquer linha em qualquer instante
// (pela auditoria por gatilho) e a linha do tempo completa de um pedido:
// eventos dos agentes, mudanças de dados, chamadas de IA e mensagens.

import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "./db/cliente.ts";
import { auditoria, evento, itemPedido, mensagem, usoIa } from "./db/schema.ts";

/** Valor da linha logo depois do instante pedido; null se ainda não existia ou já tinha sido apagada. */
export async function estadoEm(tabela: string, chave: string | number, instante: Date): Promise<Record<string, unknown> | null> {
  const [a] = await db
    .select()
    .from(auditoria)
    .where(and(eq(auditoria.tabela, tabela), eq(auditoria.chave, String(chave)), lte(auditoria.criadoEm, instante)))
    .orderBy(desc(auditoria.id))
    .limit(1);
  if (!a || a.operacao === "DELETE") return null;
  return a.depois as Record<string, unknown>;
}

/** Todas as versões de uma linha, da primeira à última. */
export async function historicoDaLinha(tabela: string, chave: string | number) {
  return db
    .select()
    .from(auditoria)
    .where(and(eq(auditoria.tabela, tabela), eq(auditoria.chave, String(chave))))
    .orderBy(asc(auditoria.id));
}

/** Campos que mudaram entre duas versões de uma linha. */
export function diferencas(antes: Record<string, unknown> | null, depois: Record<string, unknown> | null) {
  const campos = new Set([...Object.keys(antes ?? {}), ...Object.keys(depois ?? {})]);
  const mudou: { campo: string; de: unknown; para: unknown }[] = [];
  for (const c of campos) {
    if (c === "atualizado_em") continue;
    const de = antes?.[c] ?? null;
    const para = depois?.[c] ?? null;
    if (JSON.stringify(de) !== JSON.stringify(para)) mudou.push({ campo: c, de, para });
  }
  return mudou;
}

export type EntradaRastro =
  | { tipo: "evento"; em: Date; agente: string; acao: string; motivo: string; deEstado: string | null; paraEstado: string | null; txid: number | null; dados: unknown }
  | { tipo: "dado"; em: Date; tabela: string; chave: string; operacao: string; mudancas: { campo: string; de: unknown; para: unknown }[]; txid: number }
  | { tipo: "ia"; em: Date; agente: string; modelo: string; rota: string; ok: boolean; duracaoMs: number; tokensEntrada: number | null; tokensSaida: number | null; erro: string | null; prompt: string | null; resposta: string | null }
  | { tipo: "mensagem"; em: Date; canal: string; direcao: string; situacao: string; texto: string; contatoId: string };

/** Tabelas de negócio ligadas ao item pela coluna item_pedido_id. */
const TABELAS_DO_ITEM = ["cotacao", "oferta", "referencia_preco", "mapa_cotacao", "historico_compra"];

export async function linhaDoTempo(pedidoId: number): Promise<EntradaRastro[]> {
  // Itens atuais e também os que já foram apagados (correção do pedido recria os itens).
  const atuais = await db.select({ id: itemPedido.id }).from(itemPedido).where(eq(itemPedido.pedidoId, pedidoId));
  const antigos = await db
    .selectDistinct({ chave: auditoria.chave })
    .from(auditoria)
    .where(and(eq(auditoria.tabela, "item_pedido"), sql`coalesce(${auditoria.depois} ->> 'pedido_id', ${auditoria.antes} ->> 'pedido_id') = ${String(pedidoId)}`));
  const ids = [...new Set([...atuais.map((i) => i.id), ...antigos.map((a) => Number(a.chave))])];
  const idsTexto = ids.map(String);

  const eventos = await db
    .select()
    .from(evento)
    .where(ids.length ? or(eq(evento.pedidoId, pedidoId), inArray(evento.itemPedidoId, ids)) : eq(evento.pedidoId, pedidoId));

  const condDados = [and(eq(auditoria.tabela, "pedido"), eq(auditoria.chave, String(pedidoId)))];
  if (ids.length) {
    condDados.push(and(eq(auditoria.tabela, "item_pedido"), inArray(auditoria.chave, idsTexto)));
    condDados.push(
      and(
        inArray(auditoria.tabela, TABELAS_DO_ITEM),
        inArray(sql`coalesce(${auditoria.depois} ->> 'item_pedido_id', ${auditoria.antes} ->> 'item_pedido_id')`, idsTexto),
      ),
    );
  }
  const dados = await db.select().from(auditoria).where(or(...condDados)).orderBy(asc(auditoria.id));

  const ias = await db
    .select()
    .from(usoIa)
    .where(ids.length ? or(eq(usoIa.pedidoId, pedidoId), inArray(usoIa.itemPedidoId, ids)) : eq(usoIa.pedidoId, pedidoId));

  const msgs = await db
    .select()
    .from(mensagem)
    .where(ids.length ? or(eq(mensagem.pedidoId, pedidoId), inArray(mensagem.itemPedidoId, ids)) : eq(mensagem.pedidoId, pedidoId));

  const saida: EntradaRastro[] = [
    ...eventos.map((e) => ({ tipo: "evento" as const, em: e.criadoEm, agente: e.agente, acao: e.acao, motivo: e.motivo, deEstado: e.deEstado, paraEstado: e.paraEstado, txid: e.txid, dados: e.dados })),
    ...dados.map((a) => ({
      tipo: "dado" as const,
      em: a.criadoEm,
      tabela: a.tabela,
      chave: a.chave,
      operacao: a.operacao,
      mudancas: diferencas(a.antes as Record<string, unknown> | null, a.depois as Record<string, unknown> | null),
      txid: a.txid,
    })),
    ...ias.map((u) => ({
      tipo: "ia" as const,
      em: u.criadoEm,
      agente: u.papel,
      modelo: u.modelo,
      rota: u.rota,
      ok: u.ok,
      duracaoMs: u.duracaoMs,
      tokensEntrada: u.tokensEntrada,
      tokensSaida: u.tokensSaida,
      erro: u.erro,
      prompt: u.prompt,
      resposta: u.resposta,
    })),
    ...msgs.map((m) => ({ tipo: "mensagem" as const, em: m.criadoEm, canal: m.canal, direcao: m.direcao, situacao: m.situacao, texto: m.texto, contatoId: m.contatoId })),
  ];
  return saida.sort((a, b) => a.em.getTime() - b.em.getTime());
}

/** Estado do pedido e de todos os itens num instante. */
export async function fotoDoPedido(pedidoId: number, instante: Date) {
  const p = await estadoEm("pedido", pedidoId, instante);
  const itens = await db.select({ id: itemPedido.id }).from(itemPedido).where(eq(itemPedido.pedidoId, pedidoId));
  const fotos = await Promise.all(itens.map((i) => estadoEm("item_pedido", i.id, instante)));
  return { pedido: p, itens: fotos.filter(Boolean) };
}
