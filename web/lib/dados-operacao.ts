// Leitura do banco para Início, Quadro, Lista de pedidos e Avisos. Só leitura, como lib/dados.ts:
// junta o que essas telas mostram além do que dados.ts já traz (proposta da vez, respostas,
// registro do assistente e números), sempre tirado do estado real. Datas saem como texto ISO,
// para irem direto aos componentes de cliente.

import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "../../src/nucleo/db/cliente.ts";
import { cotacao, evento, fornecedor, itemPedido, mapaCotacao, pedido } from "../../src/nucleo/db/schema.ts";
import { colunaDoItem, FINAIS_ITEM, type EstadoItem, type EstadoPedido } from "../../src/nucleo/orquestrador/estados.ts";
import { listarAvisos, type Aviso, type TipoAviso } from "./avisos";
import { listaPedidos, quadro, type Coluna, type Comparacao, type Etiqueta } from "./dados";
import { VERBO_DO_AVISO } from "../components/operacao/textos";

// ---------- Tipos que vão para as telas ----------

export type Urgencia = "normal" | "urgente" | "obra_parada";

/** Proposta que a tela pode mostrar como real: a escolhida pelo comprador ou a recomendada do mapa. */
export type PropostaDaVez = {
  rotulo: "Escolhida" | "Recomendada";
  custo: number;
  fornecedor: string;
  simulado: boolean;
  prazoDias: number | null;
  /** Propostas válidas no mapa: a explicação da recomendação cita o número. */
  validas: number;
};

export type ExtraDoItem = {
  /** Fornecedores consultados e respostas na rodada atual. */
  consultados: number;
  respostas: number;
  proposta: PropostaDaVez | null;
};

export type AvisoSerial = Omit<Aviso, "em"> & {
  em: string;
  canal: string;
  /** Item do aviso, ou o primeiro item do pedido, para dar nome à linha. */
  item: string | null;
};

export type Grupo = "voce" | "andando" | "concluidos" | "cancelados";

export type LinhaPedido = {
  id: number;
  estado: EstadoPedido;
  texto: string;
  canal: string;
  /** Frente 2: responsável pelo pedido. */
  dono: string | null;
  criadoEm: string;
  atualizadoEm: string;
  itens: number;
  urgencia: Urgencia;
  destino: string | null;
  prazoTexto: string | null;
  setor: string | null;
  motivoCancelamento: string | null;
  /** Os itens na ordem da fila: "40 sacos de cimento". */
  descricoes: { quantidade: string; unidade: string; descricao: string }[];
  /** O item que anda agora: o primeiro que não terminou; senão, o último. */
  itemDaVez: { id: number; descricao: string; quantidade: string; unidade: string; estado: EstadoItem } | null;
  coluna: Coluna;
  etiquetas: Etiqueta[];
  grupo: Grupo;
  /** O que falta, em uma frase. */
  passo: string;
  /** Só quando a vez é do comprador. */
  acao: { texto: string; href: string } | null;
  proposta: PropostaDaVez | null;
  respostas: { consultados: number; respostas: number } | null;
};

const iso = (d: Date) => d.toISOString();

// ---------- Propostas e respostas por item ----------

/** Respostas da rodada atual e a proposta da vez de cada item. */
export async function extrasDosItens(ids: number[]): Promise<Record<number, ExtraDoItem>> {
  if (!ids.length) return {};
  const itens = await db
    .select({ id: itemPedido.id, estado: itemPedido.estado, rodada: itemPedido.rodada, ofertaEscolhidaId: itemPedido.ofertaEscolhidaId })
    .from(itemPedido)
    .where(inArray(itemPedido.id, ids));
  const contagens = await db
    .select({
      itemId: cotacao.itemPedidoId,
      rodada: cotacao.rodada,
      consultados: sql<number>`count(*)::int`,
      respostas: sql<number>`count(*) filter (where ${cotacao.situacao} = 'respondeu')::int`,
    })
    .from(cotacao)
    .where(inArray(cotacao.itemPedidoId, ids))
    .groupBy(cotacao.itemPedidoId, cotacao.rodada);
  const mapas = await db
    .selectDistinctOn([mapaCotacao.itemPedidoId], { itemId: mapaCotacao.itemPedidoId, dados: mapaCotacao.dados })
    .from(mapaCotacao)
    .where(inArray(mapaCotacao.itemPedidoId, ids))
    .orderBy(mapaCotacao.itemPedidoId, desc(mapaCotacao.criadoEm));

  const saida: Record<number, ExtraDoItem> = {};
  for (const i of itens) {
    const c = contagens.find((x) => x.itemId === i.id && x.rodada === i.rodada);
    const m = mapas.find((x) => x.itemId === i.id)?.dados as Comparacao | undefined;
    saida[i.id] = { consultados: c?.consultados ?? 0, respostas: c?.respostas ?? 0, proposta: propostaDoMapa(i, m) };
  }
  return saida;
}

/** Sem mapa, sem número. A recomendada só com 3 ou mais válidas (o mapa já diz em podeDizerMelhor). */
function propostaDoMapa(i: { estado: EstadoItem; ofertaEscolhidaId: string | null }, m: Comparacao | undefined): PropostaDaVez | null {
  if (!m) return null;
  const escolhida = i.ofertaEscolhidaId ? m.validas.find((l) => l.oferta.id === i.ofertaEscolhidaId) : undefined;
  const linha = escolhida ?? (i.estado === "aguardando_decisao" && m.podeDizerMelhor ? m.vencedora : null);
  if (!linha || linha.custo === null) return null;
  return {
    rotulo: escolhida ? "Escolhida" : "Recomendada",
    custo: linha.custo,
    fornecedor: linha.oferta.fornecedorNome,
    simulado: linha.oferta.simulado,
    prazoDias: linha.oferta.prazoDias,
    validas: m.validas.length,
  };
}

// ---------- Avisos ----------

/** Os avisos de lib/avisos.ts com o canal do pedido e o nome do item. */
export async function avisosComContexto(): Promise<AvisoSerial[]> {
  const avisos = await listarAvisos();
  const ids = [...new Set(avisos.map((a) => a.pedidoId))];
  if (!ids.length) return [];
  const pedidos = await db.select({ id: pedido.id, canal: pedido.canalOrigem }).from(pedido).where(inArray(pedido.id, ids));
  const itens = await db
    .select({ id: itemPedido.id, pedidoId: itemPedido.pedidoId, ordem: itemPedido.ordem, descricao: itemPedido.descricao, quantidade: itemPedido.quantidade, unidade: itemPedido.unidade })
    .from(itemPedido)
    .where(inArray(itemPedido.pedidoId, ids))
    .orderBy(asc(itemPedido.ordem));
  return avisos.map((a) => {
    const i = a.itemId ? itens.find((x) => x.id === a.itemId) : itens.find((x) => x.pedidoId === a.pedidoId);
    return { ...a, em: iso(a.em), canal: pedidos.find((p) => p.id === a.pedidoId)?.canal ?? "", item: i ? i.descricao : null };
  });
}

/** O que pede ação do comprador. Sem proposta só informa, como no sino. */
export const pedeAcao = (tipo: TipoAviso) => tipo !== "sem_proposta";

export type Acontecido = { chave: string; pedidoId: number; itemId: number; texto: string; item: string; fornecedor: string | null; simulado: boolean; canal: string; em: string; href: string };

/** O que já aconteceu nos últimos dias e não pede nada: compras aprovadas, enviadas, confirmadas e itens cancelados. */
export async function acontecidosRecentes(dias = 7): Promise<Acontecido[]> {
  const desde = new Date(Date.now() - dias * 86_400_000);
  const linhas = await db
    .select({ item: itemPedido, canal: pedido.canalOrigem, fornecedor: fornecedor.nome, origem: fornecedor.origem })
    .from(itemPedido)
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .leftJoin(fornecedor, eq(fornecedor.id, itemPedido.fornecedorEscolhidoId))
    .where(and(inArray(itemPedido.estado, ["aprovado", "pedido_enviado", "confirmado", "cancelado"]), gt(itemPedido.atualizadoEm, desde)))
    .orderBy(desc(itemPedido.atualizadoEm))
    .limit(30);
  return linhas.map(({ item, canal, fornecedor: nome, origem }) => {
    const texto =
      item.estado === "confirmado"
        ? `Compra confirmada${nome ? ` por ${nome}` : ""}.`
        : item.estado === "pedido_enviado"
          ? `Pedido enviado${nome ? ` a ${nome}` : ""}. Falta o fornecedor confirmar.`
          : item.estado === "aprovado"
            ? `Você aprovou a compra${nome ? ` com ${nome}` : ""}.`
            : "Item cancelado.";
    return {
      chave: `${item.estado}-${item.id}`,
      pedidoId: item.pedidoId,
      itemId: item.id,
      texto,
      item: item.descricao,
      fornecedor: item.estado === "cancelado" ? null : nome,
      simulado: origem === "simulado",
      canal,
      em: iso(item.atualizadoEm),
      href: `/pedidos/${item.pedidoId}`,
    };
  });
}

// ---------- Lista de pedidos ----------

const PASSO_DO_ITEM: Record<EstadoItem, string> = {
  na_fila: "Na fila: espera o item anterior terminar.",
  buscando: "O assistente está procurando fornecedores.",
  aguardando_recompra: "Você comprou este item há pouco. Repita ou cote de novo.",
  cotando: "Esperando as propostas dos fornecedores.",
  comparando: "O assistente está montando o mapa de cotações.",
  aguardando_decisao: "O mapa de cotações está pronto. Falta a sua decisão.",
  aprovado: "Aprovada. O assistente vai enviar o pedido ao fornecedor.",
  pedido_enviado: "Pedido enviado. Falta o fornecedor confirmar.",
  confirmado: "Compra confirmada pelo fornecedor.",
  sem_proposta: "Nenhuma proposta válida para este item.",
  cancelado: "Item cancelado.",
};



/** Todos os pedidos da lista atual (até 100), com etapa, situação, próximo passo e proposta. */
export async function pedidosOperacao(): Promise<LinhaPedido[]> {
  const base = await listaPedidos();
  const ids = base.map((p) => p.id);
  if (!ids.length) return [];
  const [pedidos, itens, colunas, avisos] = await Promise.all([
    db.select().from(pedido).where(inArray(pedido.id, ids)),
    db.select().from(itemPedido).where(inArray(itemPedido.pedidoId, ids)).orderBy(asc(itemPedido.ordem)),
    quadro(true),
    listarAvisos(),
  ]);
  const cartoes = Object.values(colunas).flat();
  const daVez = new Map<number, (typeof itens)[number]>();
  for (const id of ids) {
    const doPedido = itens.filter((i) => i.pedidoId === id);
    const i = doPedido.find((x) => !FINAIS_ITEM.includes(x.estado)) ?? doPedido[doPedido.length - 1];
    if (i) daVez.set(id, i);
  }
  const extras = await extrasDosItens([...daVez.values()].map((i) => i.id));

  return base.map((b): LinhaPedido => {
    const p = pedidos.find((x) => x.id === b.id)!;
    const i = daVez.get(b.id) ?? null;
    const extra = i ? extras[i.id] : undefined;
    const aviso = avisos.find((a) => a.pedidoId === b.id && pedeAcao(a.tipo));
    const grupo: Grupo = p.estado === "cancelado" ? "cancelados" : p.estado === "concluido" ? "concluidos" : aviso ? "voce" : "andando";
    const coluna: Coluna = p.estado === "concluido" ? "Decidido" : i ? colunaDoItem(p.estado, i.estado) : "Solicitado";
    const passo =
      p.estado === "interpretando"
        ? "O assistente está lendo a cotação."
        : p.estado === "aguardando_confirmacao"
          ? "Confirme o que o assistente entendeu da cotação."
          : p.estado === "cancelado"
            ? p.motivoCancelamento
              ? `Cancelada: ${p.motivoCancelamento.charAt(0).toLowerCase()}${p.motivoCancelamento.slice(1)}.`
              : "Cotação cancelada."
            : p.estado === "concluido"
              ? "Todos os itens terminaram."
              : i
                ? PASSO_DO_ITEM[i.estado]
                : "Sem itens.";
    return {
      id: b.id,
      estado: b.estado,
      texto: b.texto,
      canal: b.canal,
      dono: b.dono,
      criadoEm: iso(b.criadoEm),
      atualizadoEm: iso(p.atualizadoEm),
      itens: b.itens,
      urgencia: p.urgencia,
      destino: p.destino,
      prazoTexto: p.prazoTexto,
      setor: p.setor,
      motivoCancelamento: p.motivoCancelamento,
      descricoes: itens.filter((x) => x.pedidoId === b.id).map((x) => ({ quantidade: x.quantidade, unidade: x.unidade, descricao: x.descricao })),
      itemDaVez: i ? { id: i.id, descricao: i.descricao, quantidade: i.quantidade, unidade: i.unidade, estado: i.estado } : null,
      coluna,
      etiquetas: i ? (cartoes.find((c) => c.itemId === i.id)?.etiquetas ?? []) : [],
      grupo,
      passo,
      acao: aviso ? { texto: VERBO_DO_AVISO[aviso.tipo], href: aviso.href } : null,
      proposta: extra?.proposta ?? null,
      respostas: i && i.estado === "cotando" && extra?.consultados ? { consultados: extra.consultados, respostas: extra.respostas } : null,
    };
  });
}

// ---------- Início ----------

export type Numeros = {
  /** Pedidos que ainda não terminaram. */
  abertos: number;
  /** Itens entre a busca e o mapa. */
  emCotacao: number;
  /** Cotações enviadas que ainda esperam resposta, nos itens em cotação. */
  aguardandoResposta: number;
  /** Itens com compra confirmada pelo fornecedor. */
  fechadas: number;
  /** Pedidos concluídos, para o link da lista. */
  concluidos: number;
  /** Todos os pedidos, cancelados inclusive: zero é a primeira vez. */
  total: number;
};

export async function numerosOperacao(): Promise<Numeros> {
  const [p] = await db
    .select({
      abertos: sql<number>`count(*) filter (where ${pedido.estado} in ('interpretando', 'aguardando_confirmacao', 'em_andamento'))::int`,
      concluidos: sql<number>`count(*) filter (where ${pedido.estado} = 'concluido')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(pedido);
  const [i] = await db
    .select({
      emCotacao: sql<number>`count(*) filter (where ${itemPedido.estado} in ('buscando', 'cotando', 'comparando'))::int`,
      fechadas: sql<number>`count(*) filter (where ${itemPedido.estado} = 'confirmado')::int`,
    })
    .from(itemPedido)
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .where(sql`${pedido.estado} <> 'cancelado'`);
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cotacao)
    .innerJoin(itemPedido, and(eq(itemPedido.id, cotacao.itemPedidoId), eq(itemPedido.rodada, cotacao.rodada)))
    .where(and(eq(cotacao.situacao, "aguardando"), eq(itemPedido.estado, "cotando")));
  return { abertos: p?.abertos ?? 0, concluidos: p?.concluidos ?? 0, total: p?.total ?? 0, emCotacao: i?.emCotacao ?? 0, fechadas: i?.fechadas ?? 0, aguardandoResposta: c?.n ?? 0 };
}

export type Registro = { id: string; acao: string; motivo: string; em: string };

/** As últimas ações registradas pelo assistente num pedido, da mais nova para a mais antiga. */
export async function registroDoPedido(pedidoId: number, limite = 5): Promise<Registro[]> {
  const ids = (await db.select({ id: itemPedido.id }).from(itemPedido).where(eq(itemPedido.pedidoId, pedidoId))).map((i) => i.id);
  const linhas = await db
    .select({ id: evento.id, acao: evento.acao, motivo: evento.motivo, em: evento.criadoEm })
    .from(evento)
    .where(ids.length ? or(eq(evento.pedidoId, pedidoId), inArray(evento.itemPedidoId, ids)) : eq(evento.pedidoId, pedidoId))
    .orderBy(desc(evento.criadoEm))
    .limit(limite);
  return linhas.map((l) => ({ ...l, em: iso(l.em) }));
}

export type PropostaDoMapa = { fornecedor: string; simulado: boolean; custo: number; prazoDias: number | null; recomendada: boolean };

/** O que o herói do Início mostra, conforme o aviso. Só números que o banco tem. */
export type Heroi =
  | {
      tipo: "decidir";
      aviso: AvisoSerial;
      urgencia: Urgencia;
      destino: string | null;
      prazoTexto: string | null;
      quantidade: string;
      unidade: string;
      descricao: string;
      /** Válidas, com a recomendada na primeira linha quando houver. */
      propostas: PropostaDoMapa[];
      podeDizerMelhor: boolean;
      /** Quanto a recomendada custa a mais que a mais barata. */
      aMais: number;
      /** Dias de diferença: positivo, a recomendada entrega antes da mais barata. */
      difPrazo: number | null;
      urgente: boolean;
      alertas: string[];
      respostas: { consultados: number; respostas: number };
    }
  | {
      tipo: "confirmar_pedido";
      aviso: AvisoSerial;
      urgencia: Urgencia;
      destino: string | null;
      prazoTexto: string | null;
      modoEntrega: string | null;
      janela: string | null;
      itens: { quantidade: string; unidade: string; descricao: string }[];
      suposicoes: string[];
      faltando: string[];
      texto: string;
    }
  | { tipo: "recompra" | "sem_proposta"; aviso: AvisoSerial; urgencia: Urgencia; destino: string | null; prazoTexto: string | null };

export async function heroiDoAviso(a: AvisoSerial): Promise<Heroi | null> {
  const [p] = await db.select().from(pedido).where(eq(pedido.id, a.pedidoId));
  if (!p) return null;
  const comum = { aviso: a, urgencia: p.urgencia, destino: p.destino, prazoTexto: p.prazoTexto };

  if (a.tipo === "confirmar_pedido") {
    const itens = await db.select().from(itemPedido).where(eq(itemPedido.pedidoId, p.id)).orderBy(asc(itemPedido.ordem));
    return {
      ...comum,
      tipo: "confirmar_pedido",
      modoEntrega: p.modoEntrega,
      janela: p.janelaRecebimento,
      itens: itens.map((i) => ({ quantidade: i.quantidade, unidade: i.unidade, descricao: i.descricao })),
      suposicoes: p.suposicoes,
      faltando: p.faltando,
      texto: p.textoOriginal,
    };
  }

  if (a.tipo === "decidir" && a.itemId) {
    const [i] = await db.select().from(itemPedido).where(eq(itemPedido.id, a.itemId));
    const [m] = await db.select().from(mapaCotacao).where(eq(mapaCotacao.itemPedidoId, a.itemId)).orderBy(desc(mapaCotacao.criadoEm)).limit(1);
    const extras = await extrasDosItens([a.itemId]);
    if (i && m) {
      const c = m.dados as Comparacao;
      const v = c.podeDizerMelhor ? c.vencedora : null;
      const ordem = v ? [v, ...c.validas.filter((l) => l.oferta.id !== v.oferta.id)] : [...c.validas].sort((x, y) => (x.custo ?? Infinity) - (y.custo ?? Infinity));
      const prazoV = v?.oferta.prazoDias ?? null;
      const prazoB = c.maisBarata?.oferta.prazoDias ?? null;
      return {
        ...comum,
        tipo: "decidir",
        quantidade: i.quantidade,
        unidade: i.unidade,
        descricao: i.descricao,
        propostas: ordem.filter((l) => l.custo !== null).map((l) => ({ fornecedor: l.oferta.fornecedorNome, simulado: l.oferta.simulado, custo: l.custo as number, prazoDias: l.oferta.prazoDias, recomendada: l === v })),
        podeDizerMelhor: Boolean(v),
        aMais: v ? c.aMaisQueAMaisBarata : 0,
        difPrazo: v && prazoV !== null && prazoB !== null ? prazoB - prazoV : null,
        urgente: c.urgente,
        alertas: [...(v?.alertas ?? []), ...c.alertasGerais],
        respostas: { consultados: extras[a.itemId]?.consultados ?? 0, respostas: extras[a.itemId]?.respostas ?? 0 },
      };
    }
  }

  return { ...comum, tipo: a.tipo === "sem_proposta" ? "sem_proposta" : "recompra" };
}
