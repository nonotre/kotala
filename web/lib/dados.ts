// Leitura do banco para as telas. Só leitura: as ações vão para a API interna
// do processo dos bots (lib/acoes.ts). Usa o mesmo schema e as mesmas consultas
// do núcleo, em ../src.

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../src/nucleo/db/cliente.ts";
import {
  contato,
  cotacao,
  fornecedor,
  historicoCompra,
  itemPedido,
  mapaCotacao,
  mensagem,
  oferta,
  pedido,
  referenciaPreco,
} from "../../src/nucleo/db/schema.ts";
import { colunaDoItem, COLUNAS, type Coluna, type EstadoItem, type EstadoPedido } from "../../src/nucleo/orquestrador/estados.ts";
import { linhaDoTempo } from "../../src/nucleo/rastreio.ts";
import { acharRecompra } from "../../src/agentes/memoria/index.ts";
import type { Comparacao, Linha } from "../../src/agentes/comparador/calculo.ts";

export { COLUNAS, type Coluna };
export type { Comparacao, Linha };

const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** Frente 2: dono do pedido, o usuário ligado ao contato que pediu. Null quando o contato não tem usuário. */
const donoDoPedido = sql<string | null>`(select u.nome from contato c join usuario u on u.id = c.usuario_id where c.id = ${pedido.compradorId})`;

export type Etiqueta = { texto: string; tipo: "atencao" | "info" | "ok" | "alerta" | "urgente" };

export type Cartao = {
  itemId: number;
  pedidoId: number;
  descricao: string;
  quantidade: string;
  unidade: string;
  estado: EstadoItem;
  estadoPedido: EstadoPedido;
  coluna: Coluna;
  etiquetas: Etiqueta[];
  atualizadoEm: Date;
  /** Frente 2: quem é o responsável pelo card. */
  dono: string | null;
};

function etiquetasDo(
  i: { estado: EstadoItem; prazoRespostasEm: Date | null; rodada: number },
  p: { estado: EstadoPedido; urgencia: string },
  extra: { respostas: number; consultados: number; alertas: number; escolhido: string | null; negociando: boolean },
): Etiqueta[] {
  const e: Etiqueta[] = [];
  if (p.urgencia === "obra_parada") e.push({ texto: "Obra parada", tipo: "urgente" });
  else if (p.urgencia === "urgente") e.push({ texto: "Urgente", tipo: "urgente" });
  if (p.estado === "interpretando") e.push({ texto: "Lendo o pedido", tipo: "info" });
  else if (p.estado === "aguardando_confirmacao") e.push({ texto: "Aguardando você confirmar", tipo: "atencao" });
  else
    switch (i.estado) {
      case "na_fila":
        e.push({ texto: "Na fila", tipo: "info" });
        break;
      case "buscando":
        e.push({ texto: "Captando fornecedores", tipo: "info" });
        break;
      case "aguardando_recompra":
        e.push({ texto: "Repetir compra?", tipo: "atencao" });
        break;
      case "cotando":
        if (extra.negociando) e.push({ texto: "Em negociação", tipo: "atencao" });
        e.push({ texto: `${extra.respostas}/${extra.consultados} respostas`, tipo: "info" });
        if (i.prazoRespostasEm) e.push({ texto: `Fecha às ${hora(i.prazoRespostasEm)}`, tipo: "info" });
        break;
      case "comparando":
        e.push({ texto: "Montando o mapa", tipo: "info" });
        break;
      case "aguardando_decisao":
        e.push({ texto: "Aguardando sua decisão", tipo: "atencao" });
        if (extra.alertas) e.push({ texto: "Com alerta", tipo: "alerta" });
        break;
      case "aprovado":
        e.push({ texto: "Aprovada", tipo: "ok" });
        break;
      case "pedido_enviado":
        e.push({ texto: `Pedido enviado${extra.escolhido ? ` a ${extra.escolhido}` : ""}`, tipo: "ok" });
        break;
      case "confirmado":
        e.push({ texto: `Confirmado${extra.escolhido ? ` por ${extra.escolhido}` : ""}`, tipo: "ok" });
        break;
      case "sem_proposta":
        e.push({ texto: "Sem proposta válida", tipo: "alerta" });
        break;
      case "cancelado":
        e.push({ texto: "Cancelado", tipo: "info" });
        break;
    }
  if (i.rodada > 1 && !["confirmado", "cancelado"].includes(i.estado)) e.push({ texto: `Rodada ${i.rodada}`, tipo: "info" });
  return e;
}

/** R10: todos os itens, em 4 colunas. Cancelados ficam ocultos, a não ser que peça para ver. */
export async function quadro(mostrarCanceladas = false): Promise<Record<Coluna, Cartao[]>> {
  const linhas = await db
    .select({ item: itemPedido, pedido, escolhido: fornecedor.nome, dono: donoDoPedido })
    .from(itemPedido)
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .leftJoin(fornecedor, eq(fornecedor.id, itemPedido.fornecedorEscolhidoId))
    .where(mostrarCanceladas ? sql`true` : sql`${itemPedido.estado} <> 'cancelado'`)
    .orderBy(desc(itemPedido.atualizadoEm))
    .limit(200);

  const ids = linhas.map((l) => l.item.id);
  const contagens = ids.length
    ? await db
        .select({
          itemId: cotacao.itemPedidoId,
          rodada: cotacao.rodada,
          consultados: sql<number>`count(*)::int`,
          respostas: sql<number>`count(*) filter (where ${cotacao.situacao} = 'respondeu')::int`,
        })
        .from(cotacao)
        .where(inArray(cotacao.itemPedidoId, ids))
        .groupBy(cotacao.itemPedidoId, cotacao.rodada)
    : [];
  const mapas = ids.length
    ? await db
        .selectDistinctOn([mapaCotacao.itemPedidoId], { itemId: mapaCotacao.itemPedidoId, dados: mapaCotacao.dados })
        .from(mapaCotacao)
        .where(inArray(mapaCotacao.itemPedidoId, ids))
        .orderBy(mapaCotacao.itemPedidoId, desc(mapaCotacao.criadoEm))
    : [];

  const saida = Object.fromEntries(COLUNAS.map((c) => [c, [] as Cartao[]])) as Record<Coluna, Cartao[]>;
  for (const { item, pedido: p, escolhido, dono } of linhas) {
    const c = contagens.find((x) => x.itemId === item.id && x.rodada === item.rodada);
    const m = mapas.find((x) => x.itemId === item.id)?.dados as Comparacao | undefined;
    const alertas = (m?.validas ?? []).reduce((t, l) => t + l.alertas.length, 0) + (m?.alertasGerais.length ?? 0);
    const coluna = colunaDoItem(p.estado, item.estado);
    saida[coluna].push({
      itemId: item.id,
      pedidoId: p.id,
      descricao: item.descricao,
      quantidade: item.quantidade,
      unidade: item.unidade,
      estado: item.estado,
      estadoPedido: p.estado,
      coluna,
      etiquetas: etiquetasDo(item, p, {
        respostas: c?.respostas ?? 0,
        consultados: c?.consultados ?? 0,
        alertas,
        escolhido,
        negociando: !!item.negociacao && item.negociacao.rodada === item.rodada,
      }),
      atualizadoEm: item.atualizadoEm,
      dono,
    });
  }
  return saida;
}

export async function listaPedidos() {
  return db
    .select({ id: pedido.id, estado: pedido.estado, texto: pedido.textoOriginal, criadoEm: pedido.criadoEm, canal: pedido.canalOrigem, dono: donoDoPedido, itens: sql<number>`(select count(*)::int from item_pedido where pedido_id = ${pedido.id})` })
    .from(pedido)
    .orderBy(desc(pedido.id))
    .limit(100);
}

/** Pedido completo: itens, cotações, mapa, referência pública e linha do tempo. */
export async function detalhePedido(id: number) {
  const [linha] = await db.select({ pedido, dono: donoDoPedido }).from(pedido).where(eq(pedido.id, id));
  if (!linha) return null;
  const p = linha.pedido;
  const itens = await db.select().from(itemPedido).where(eq(itemPedido.pedidoId, id)).orderBy(asc(itemPedido.ordem));
  const porItem = await Promise.all(
    itens.map(async (item) => {
      const [m] = await db.select().from(mapaCotacao).where(eq(mapaCotacao.itemPedidoId, item.id)).orderBy(desc(mapaCotacao.criadoEm)).limit(1);
      const cots = await db
        .select({ cotacao, nome: fornecedor.nome, origem: fornecedor.origem })
        .from(cotacao)
        .innerJoin(fornecedor, eq(fornecedor.id, cotacao.fornecedorId))
        .where(and(eq(cotacao.itemPedidoId, item.id), eq(cotacao.rodada, item.rodada)))
        .orderBy(asc(fornecedor.nome));
      const refs = await db
        .select({ r: referenciaPreco, verificado: fornecedor.verificado })
        .from(referenciaPreco)
        .leftJoin(fornecedor, eq(fornecedor.id, referenciaPreco.fornecedorId))
        .where(eq(referenciaPreco.itemPedidoId, item.id))
        .orderBy(desc(referenciaPreco.aceita), desc(referenciaPreco.confianca));
      const verificacoes = m
        ? await db
            .select({ id: fornecedor.id, verificacao: fornecedor.verificacao, origem: fornecedor.origem })
            .from(fornecedor)
            .where(inArray(fornecedor.id, (m.dados as Comparacao).validas.map((l) => l.oferta.fornecedorId).concat(["00000000-0000-0000-0000-000000000000"])))
        : [];
      return {
        item,
        recompra: item.estado === "aguardando_recompra" ? await acharRecompra(item) : null,
        mapa: m ? { ...m, comparacao: m.dados as Comparacao } : null,
        cotacoes: cots,
        referencias: refs.map((x) => ({ ...x.r, cnpjAtivo: x.verificado === true })),
        verificacoes: Object.fromEntries(verificacoes.map((v) => [v.id, v.verificacao as Record<string, unknown> | null])),
      };
    }),
  );
  const tempo = await linhaDoTempo(id);
  return { pedido: p, dono: linha.dono, itens: porItem, linhaDoTempo: tempo };
}

/** Q8: fornecedores com o julgamento de confiança. */
export async function listaFornecedores() {
  const fs = await db.select().from(fornecedor).orderBy(asc(fornecedor.origem), asc(fornecedor.nome));
  const canais = await db.select({ fornecedorId: contato.fornecedorId, canal: contato.canal, parouEm: contato.parouEm }).from(contato).where(sql`${contato.fornecedorId} is not null`);
  const propostas = await db.select({ id: oferta.fornecedorId, n: sql<number>`count(*)::int` }).from(oferta).groupBy(oferta.fornecedorId);
  const compras = await db.select({ id: historicoCompra.fornecedorId, n: sql<number>`count(*)::int` }).from(historicoCompra).groupBy(historicoCompra.fornecedorId);
  return fs.map((f) => ({
    ...f,
    verificacao: f.verificacao as { pontos?: number; nivel?: string; motivos?: string[]; alertas?: string[]; fonte?: string; em?: string } | null,
    canais: canais.filter((c) => c.fornecedorId === f.id).map((c) => (c.parouEm ? `${c.canal} (parou)` : c.canal)),
    propostas: propostas.find((p) => p.id === f.id)?.n ?? 0,
    compras: compras.find((c) => c.id === f.id)?.n ?? 0,
  }));
}

/** E3: conversa do chat web de um navegador: as 300 mensagens mais recentes, em ordem. */
export async function conversaWeb(endereco: string) {
  const [c] = await db.select().from(contato).where(and(eq(contato.canal, "web"), eq(contato.endereco, endereco)));
  if (!c) return [];
  // Pega do fim para o começo e desvira: numa conversa longa, as mais novas não podem ficar de fora.
  const recentes = await db
    .select({ id: mensagem.id, direcao: mensagem.direcao, texto: mensagem.texto, botoes: mensagem.botoes, criadoEm: mensagem.criadoEm, anexos: mensagem.anexos })
    .from(mensagem)
    .where(eq(mensagem.contatoId, c.id))
    .orderBy(desc(mensagem.criadoEm))
    .limit(300);
  // Só o nome e o tipo dos anexos vão para a tela.
  return recentes.reverse().map(({ anexos, ...m }) => ({ ...m, anexos: (anexos ?? []).map((a) => ({ tipo: a.tipo, nome: a.nome ?? null })) }));
}
