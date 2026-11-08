// Leitura do banco para as ferramentas do Assistente (implementa Consultas, de tipos.ts).
// Só leitura: nada aqui escreve. Visão da empresa inteira, como as telas (ainda não há login):
// todo pedido aparece, e `daConversa` marca os que este contato fez. Valores em reais (number),
// datas em texto ISO, e nada de dado pessoal (e-mail, telefone) sai daqui.
// A lógica repete a de web/lib (avisos, dados-operacao, dados, dados-consulta) porque src/
// não pode depender das telas.

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { JANELA_CONFIRMACAO_MIN } from "../config.ts";
import { db } from "../nucleo/db/cliente.ts";
import { cotacao, evento, fornecedor, historicoCompra, itemPedido, mapaCotacao, pedido, referenciaPreco } from "../nucleo/db/schema.ts";
import { colunaDoItem, FINAIS_PEDIDO } from "../nucleo/orquestrador/estados.ts";
import { categoriaDoItem } from "../agentes/busca/index.ts";
import { baseDeItens } from "../agentes/interpretador/base-itens.ts";
import { dias as textoDias, nomePedido } from "../texto.ts";
import type { Comparacao, Linha } from "../agentes/comparador/calculo.ts";
import type {
  CartaoEstado,
  CategoriaResumo,
  CompraResumo,
  Consultas,
  ContextoAssistente,
  CotacaoResumo,
  DetalhePedido,
  EconomiaResumo,
  EventoResumo,
  FiltroEstado,
  FornecedorResumo,
  ItemResumo,
  MapaResumo,
  Pendencia,
  PropostaResumo,
  ResumoPedido,
  Urgencia,
} from "./tipos.ts";

// ---------- Limites ----------

const BUSCA_PADRAO = 10;
const BUSCA_MAXIMA = 20;
const TEMPO_PADRAO = 15;
const TEMPO_MAXIMO = 50;
const CARTAO_PENDENCIAS = 8;
const CARTAO_PEDIDOS = 10;
/** No cartão, pedido com muitos itens mostra só os primeiros: o `nome` já diz "(+N itens)". */
const CARTAO_ITENS_POR_PEDIDO = 6;
/** Teto de pendências na ferramenta: a lista vai inteira para o modelo, então não pode crescer sem fim. */
const PENDENCIAS_MAXIMAS = 50;
const MOTIVO_MAXIMO = 400;
const PALAVRAS_MAXIMAS = 6;
const ECONOMIA_DIAS_PADRAO = 30;
const ECONOMIA_DIAS_MAXIMO = 365;
/**
 * Sem proposta só avisa por este tempo. Decisão e recompra não vencem: ficam enquanto o pedido
 * estiver de pé. A tela de avisos (web/lib/avisos.ts) ainda aplica a janela a todos os tipos;
 * isso é assunto da Frente 1.
 */
const SEM_PROPOSTA_DIAS = 7;
/**
 * Igual a VALIDADE_DUVIDA_MS de src/agentes/cotador/index.ts (que não exporta): depois disso,
 * a dúvida do fornecedor não captura mais a mensagem do comprador.
 */
const VALIDADE_DUVIDA_MS = 30 * 60_000;
/** Maior id de `serial` do Postgres: acima disso a consulta nem chega ao banco. */
const ID_MAXIMO = 2_147_483_647;

// ---------- Utilidades puras ----------

const iso = (d: Date) => d.toISOString();
const reais = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
const centavos = (v: number) => Math.round(v * 100) / 100;
const idValido = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= ID_MAXIMO;
const limitar = (n: number | undefined, padrao: number, maximo: number) =>
  n === undefined || !Number.isFinite(n) ? padrao : Math.min(maximo, Math.max(1, Math.trunc(n)));
const PESO_URGENCIA: Record<Urgencia, number> = { obra_parada: 0, urgente: 1, normal: 2 };
const porUrgencia = (a: Urgencia, b: Urgencia) => PESO_URGENCIA[a] - PESO_URGENCIA[b];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const semAcento = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "");

/**
 * Chave para comparar categorias: sem acento, sem caixa. Mesma regra de mesmaCategoria em
 * agentes/busca/index.ts (que não a exporta), para "quem vende" bater com "quem recebe a cotação".
 */
const chaveCategoria = (t: string) => semAcento(t).toLowerCase().trim();
/** Categoria que o catálogo dá a item sem categoria: não é nome de material, não entra na lista. */
const CATEGORIA_ARTIFICIAL = "Cadastrado pelo agente";
/** Fornecedor ativo: nem bloqueado pela empresa, nem pediu PARAR. */
const ativo = (f: { bloqueadoEm: Date | null; parouEm: Date | null }) => f.bloqueadoEm === null && f.parouEm === null;
/** Pontos do Q8 (verificacao); sem julgamento, -1 para ficar atrás de quem tem. */
const pontosDe = (f: { verificacao: Record<string, unknown> | null }) => Number(f.verificacao?.pontos ?? -1);

/** Palavras da busca, sem acento e em minúsculas, prontas para LIKE (curinga do usuário escapado). */
export function palavrasDaBusca(texto: string): string[] {
  return semAcento(texto)
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.replace(/[\\%_]/g, (c) => `\\${c}`))
    .filter(Boolean)
    .slice(0, PALAVRAS_MAXIMAS);
}

/** Texto do pedido: "12", "#12" ou "pedido 12" falam do número, não de palavras. */
export function numeroDoPedido(texto: string): number | null {
  const m = /^\s*(?:pedido\s*)?#?(\d+)\s*$/i.exec(texto);
  const n = m ? Number(m[1]) : NaN;
  return idValido(n) ? n : null;
}

const ACENTUADAS = "áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ";
const PLANAS = "aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC";
/**
 * ILIKE sem acento sem precisar da extensão unaccent (o banco não a tem): troca as letras
 * acentuadas e baixa a caixa dos dois lados. `coluna` é texto SQL fixo, nunca entrada do usuário.
 */
const contem = (coluna: string, palavra: string): SQL =>
  sql`lower(translate(coalesce(${sql.raw(coluna)}, ''), ${ACENTUADAS}, ${PLANAS})) like ${`%${palavra}%`}`;

// ---------- Montagem dos resumos ----------

type LinhaPedido = typeof pedido.$inferSelect;
type LinhaItem = typeof itemPedido.$inferSelect;

function resumoItem(p: LinhaPedido, i: LinhaItem): ItemResumo {
  const cancelado = i.estado === "cancelado" || p.estado === "cancelado";
  return {
    itemId: i.id,
    ordem: i.ordem,
    descricao: i.descricao,
    quantidade: Number(i.quantidade),
    unidade: i.unidade,
    estado: i.estado,
    // O contrato prevê "Cancelado" para o que o quadro esconde na coluna Decidido.
    coluna: cancelado ? "Cancelado" : colunaDoItem(p.estado, i.estado),
    // Sem carregarCatalogo() (só os bots carregam) os itens ITM-1001+ do catálogo não são
    // achados na base em memória e ficam com null; nada aqui depende de o catálogo estar carregado.
    categoria: categoriaDoItem({ itemChave: i.itemChave, descricao: i.descricao }),
    href: `/pedidos/${p.id}#item-${i.id}`,
  };
}

function resumoPedido(ctx: ContextoAssistente, p: LinhaPedido, itens: LinhaItem[], maxItens = Infinity): ResumoPedido {
  return {
    pedidoId: p.id,
    nome: nomePedido(p, itens),
    estado: p.estado,
    setor: p.setor,
    urgencia: p.urgencia,
    criadoEm: iso(p.criadoEm),
    atualizadoEm: iso(p.atualizadoEm),
    daConversa: p.compradorId === ctx.contatoId,
    itens: itens.slice(0, maxItens).map((i) => resumoItem(p, i)),
    href: `/pedidos/${p.id}`,
  };
}

/** Itens de vários pedidos numa consulta só, agrupados e na ordem da fila. */
async function itensPorPedido(ids: number[]): Promise<Map<number, LinhaItem[]>> {
  const mapa = new Map<number, LinhaItem[]>();
  if (!ids.length) return mapa;
  const itens = await db.select().from(itemPedido).where(inArray(itemPedido.pedidoId, ids)).orderBy(asc(itemPedido.ordem));
  for (const i of itens) mapa.set(i.pedidoId, [...(mapa.get(i.pedidoId) ?? []), i]);
  return mapa;
}

async function resumos(ctx: ContextoAssistente, pedidos: LinhaPedido[], maxItens?: number): Promise<ResumoPedido[]> {
  const itens = await itensPorPedido(pedidos.map((p) => p.id));
  return pedidos.map((p) => resumoPedido(ctx, p, itens.get(p.id) ?? [], maxItens));
}

// ---------- Filtros da busca de pedidos ----------

/** Pedido tem item em algum destes estados (SQL fixo, correlacionado com o `pedido` de fora). */
function itemEm(estados: readonly string[]): SQL {
  return sql`exists (select 1 from item_pedido ip where ip.pedido_id = pedido.id and ip.estado in (${sql.join(estados.map((e) => sql`${e}`), sql`, `)}))`;
}

/**
 * Filtro de estado, no nível do pedido (a lista é de pedidos). Estados reais em orquestrador/estados.ts:
 *  - aberto: pedido que não terminou (nem concluído, nem cancelado), inclusive "lendo" e "confirma?".
 *  - aguardando_voce: pedido em "confirma?" ou com item esperando decisão ou recompra, a vez do comprador.
 *  - cotando: pedido confirmado com item entre a busca e o mapa (buscando, cotando, comparando).
 *  - concluido: pedido concluído, ou com ao menos um item confirmado pelo fornecedor.
 *  - cancelado: pedido cancelado. Os outros filtros nunca trazem cancelado.
 *  - todos: sem filtro.
 */
function condicaoDeEstado(estado: FiltroEstado): SQL | undefined {
  switch (estado) {
    case "aberto":
      return notInArray(pedido.estado, [...FINAIS_PEDIDO]);
    case "aguardando_voce":
      return and(ne(pedido.estado, "cancelado"), or(eq(pedido.estado, "aguardando_confirmacao"), itemEm(["aguardando_decisao", "aguardando_recompra"])));
    case "cotando":
      return and(eq(pedido.estado, "em_andamento"), itemEm(["buscando", "cotando", "comparando"]));
    case "concluido":
      return and(ne(pedido.estado, "cancelado"), or(eq(pedido.estado, "concluido"), itemEm(["confirmado"])));
    case "cancelado":
      return eq(pedido.estado, "cancelado");
    case "todos":
      return undefined;
  }
}

/** A palavra aparece no texto do pedido, no setor, na descrição de um item ou no nome de um fornecedor cotado. */
function condicaoDePalavra(palavra: string): SQL {
  return sql`(${contem("pedido.texto_original", palavra)}
    or ${contem("pedido.setor", palavra)}
    or exists (select 1 from item_pedido ip where ip.pedido_id = pedido.id and ${contem("ip.descricao", palavra)})
    or exists (select 1 from cotacao c join item_pedido ip on ip.id = c.item_pedido_id join fornecedor f on f.id = c.fornecedor_id
               where ip.pedido_id = pedido.id and ${contem("f.nome", palavra)}))`;
}

// ---------- Pendências ----------

/** Parecida com web/lib/avisos.ts (listarAvisos), para todos os compradores, mas só `sem_proposta` some após SEM_PROPOSTA_DIAS. */
async function listarPendencias(ctx: ContextoAssistente): Promise<Pendencia[]> {
  const desde = new Date(ctx.agora.getTime() - SEM_PROPOSTA_DIAS * 86_400_000);
  const emConfirmacao = await db.select().from(pedido).where(eq(pedido.estado, "aguardando_confirmacao")).orderBy(desc(pedido.atualizadoEm));
  const itens = await db
    .select({ item: itemPedido, urgencia: pedido.urgencia, compradorId: pedido.compradorId })
    .from(itemPedido)
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .where(and(ne(pedido.estado, "cancelado"), or(inArray(itemPedido.estado, ["aguardando_decisao", "aguardando_recompra"]), and(eq(itemPedido.estado, "sem_proposta"), gte(itemPedido.atualizadoEm, desde)))))
    .orderBy(desc(itemPedido.atualizadoEm));

  const lista: Pendencia[] = emConfirmacao.map((p) => ({
    tipo: "confirmar_pedido",
    pedidoId: p.id,
    itemId: null,
    titulo: `Confirme o pedido ${p.id}`,
    texto: "O assistente leu o pedido e espera você conferir antes de cotar.",
    urgencia: p.urgencia,
    em: iso(p.atualizadoEm),
    daConversa: p.compradorId === ctx.contatoId,
    href: `/pedidos/${p.id}`,
  }));
  for (const { item, urgencia, compradorId } of itens) {
    const base = { pedidoId: item.pedidoId, itemId: item.id, urgencia, em: iso(item.atualizadoEm), daConversa: compradorId === ctx.contatoId };
    if (item.estado === "aguardando_decisao")
      lista.push({ ...base, tipo: "decidir", titulo: `Decida a compra de ${item.descricao}`, texto: "O mapa de cotação está pronto. Nada é comprado sem a sua aprovação.", href: `/pedidos/${item.pedidoId}/decisao#item-${item.id}` });
    else if (item.estado === "aguardando_recompra")
      lista.push({ ...base, tipo: "recompra", titulo: `Repetir a compra de ${item.descricao}?`, texto: "Você comprou este item há pouco tempo. Repita ou cote de novo.", href: `/pedidos/${item.pedidoId}#item-${item.id}` });
    else lista.push({ ...base, tipo: "sem_proposta", titulo: `Sem proposta válida para ${item.descricao}`, texto: "Nenhum fornecedor mandou proposta que passasse nas regras.", href: `/pedidos/${item.pedidoId}/cotacoes#item-${item.id}` });
  }
  // Obra parada primeiro, depois urgente; dentro de cada grupo, o mais novo.
  return lista.sort((a, b) => porUrgencia(a.urgencia, b.urgencia) || b.em.localeCompare(a.em));
}

// ---------- Cartão de estado ----------

/**
 * Mesma regra de pedidoPendente (src/fluxo/comprador.ts): o pedido mais novo ainda antes da
 * confirmação ("interpretando" ou "confirma?"), e só dentro da janela desde a última atividade
 * (a mudança mais recente ou o lembrete). Fora dela o fluxo abriria pedido novo, então o
 * assistente não pode encaminhar a mensagem como correção.
 */
async function pedidoEmConfirmacaoDaConversa(ctx: ContextoAssistente): Promise<CartaoEstado["pedidoEmConfirmacao"]> {
  const [p] = await db
    .select()
    .from(pedido)
    .where(and(eq(pedido.compradorId, ctx.contatoId), inArray(pedido.estado, ["interpretando", "aguardando_confirmacao"])))
    .orderBy(desc(pedido.id))
    .limit(1);
  if (!p) return null;
  const ultimaAtividade = Math.max(p.atualizadoEm.getTime(), p.lembreteConfirmacaoEm?.getTime() ?? 0);
  if (ctx.agora.getTime() - ultimaAtividade > JANELA_CONFIRMACAO_MIN() * 60_000) return null;
  const itens = (await itensPorPedido([p.id])).get(p.id) ?? [];
  return { pedidoId: p.id, nome: nomePedido(p, itens) };
}

/** Só leitura: quem limpa a dúvida é repassarRespostaDoComprador, quando o comprador responde. */
async function duvidaDoFornecedorDaConversa(ctx: ContextoAssistente): Promise<CartaoEstado["duvidaFornecedorPendente"]> {
  const [l] = await db
    .select({ item: itemPedido })
    .from(itemPedido)
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .where(and(eq(pedido.compradorId, ctx.contatoId), isNotNull(itemPedido.duvidaPendente), inArray(itemPedido.estado, ["cotando", "buscando"])))
    .orderBy(desc(itemPedido.atualizadoEm))
    .limit(1);
  const pend = l?.item.duvidaPendente;
  if (!l || !pend) return null;
  // Dúvida velha não captura mais a mensagem: não pode aparecer como pendente.
  if (ctx.agora.getTime() - new Date(pend.em).getTime() > VALIDADE_DUVIDA_MS) return null;
  return { itemId: l.item.id, fornecedor: pend.fornecedor, pergunta: pend.pergunta };
}

async function pedidosAbertos(ctx: ContextoAssistente, limite: number, maxItens: number): Promise<ResumoPedido[]> {
  const linhas = await db
    .select()
    .from(pedido)
    .where(notInArray(pedido.estado, [...FINAIS_PEDIDO]))
    .orderBy(sql`case ${pedido.urgencia} when 'obra_parada' then 0 when 'urgente' then 1 else 2 end`, desc(pedido.atualizadoEm), desc(pedido.id))
    .limit(limite);
  return resumos(ctx, linhas, maxItens);
}

// ---------- Mapa de cotação ----------

/** Loja com estoque desconhecido (null) conta como disponível, como em referenciasDoItem (`!== false`). */
const disponivelOuDesconhecido = or(isNull(referenciaPreco.disponivel), eq(referenciaPreco.disponivel, true));

/**
 * Nível do Q8 em palavras. Mesmos cortes de julgar() em agentes/verificacao/confianca.ts
 * (75 e 50), que não os exporta. Simulado não tem pontos de verdade.
 */
function nivelDeConfianca(simulado: boolean, pontos: number | null | undefined): string | null {
  if (simulado) return "simulado";
  if (pontos === null || pontos === undefined) return null;
  return pontos >= 75 ? "alta" : pontos >= 50 ? "media" : "baixa";
}

function propostaResumo(l: Linha): PropostaResumo {
  const o = l.oferta;
  return {
    ofertaId: o.id,
    fornecedor: o.fornecedorNome,
    fornecedorId: o.fornecedorId,
    simulado: o.simulado,
    lojaOnline: o.online === true,
    // Preço por unidade já com a conta do mapa (produto ÷ quantidade); cai no que o fornecedor falou.
    precoUnitario: l.precoUnitarioEfetivo ?? o.precoUnitario,
    frete: l.origemFrete === "nao_se_aplica" ? null : l.frete,
    freteOrigem: l.origemFrete,
    custoTotal: l.custo,
    prazoDias: o.prazoDias,
    pagamento: o.pagamento,
    validade: o.validadeDias === null ? null : textoDias(o.validadeDias),
    confianca: nivelDeConfianca(o.simulado, o.confiancaFornecedor),
    nota: l.nota,
  };
}

// ---------- Economia ----------

/** Compra confirmada com os números que a tela /economia usa (web/lib/dados.ts, economia). */
type CompraEconomia = {
  custo: number | null;
  produto: number | null;
  produtoAntesNegociar: number | null;
  maisCaraCusto: number | null;
  validas: number;
  referenciaProduto: number | null;
  simulado: boolean;
};

export function somarEconomia(compras: CompraEconomia[]): Omit<EconomiaResumo, "periodoDias" | "href" | "observacao"> & { simuladas: number } {
  const soma = (xs: number[]) => centavos(xs.reduce((t, x) => t + x, 0));
  const comReferencia = compras.filter((c) => c.referenciaProduto !== null && c.produto !== null);
  const comFaixa = compras.filter((c) => c.maisCaraCusto !== null && c.custo !== null && c.validas > 1);
  const negociadas = compras.filter((c) => c.produtoAntesNegociar !== null && c.produto !== null && c.produtoAntesNegociar - c.produto >= 0.01);
  return {
    comprasConfirmadas: compras.length,
    totalPago: soma(compras.map((c) => c.custo ?? 0)),
    economiaVsReferencia: comReferencia.length ? soma(comReferencia.map((c) => c.referenciaProduto! - c.produto!)) : null,
    economiaVsMaisCara: comFaixa.length ? soma(comFaixa.map((c) => c.maisCaraCusto! - c.custo!)) : null,
    economiaNegociacao: negociadas.length ? soma(negociadas.map((c) => c.produtoAntesNegociar! - c.produto!)) : null,
    simuladas: compras.filter((c) => c.simulado).length,
  };
}

// ---------- Consultas ----------

export const consultasDoBanco: Consultas = {
  async cartaoDeEstado(ctx) {
    const [todas, abertos, pedidoEmConfirmacao, duvidaFornecedorPendente] = await Promise.all([
      listarPendencias(ctx),
      pedidosAbertos(ctx, CARTAO_PEDIDOS, CARTAO_ITENS_POR_PEDIDO),
      pedidoEmConfirmacaoDaConversa(ctx),
      duvidaDoFornecedorDaConversa(ctx),
    ]);
    return { pendencias: todas.slice(0, CARTAO_PENDENCIAS), pedidosAbertos: abertos, pedidoEmConfirmacao, duvidaFornecedorPendente };
  },

  async pendencias(ctx) {
    return (await listarPendencias(ctx)).slice(0, PENDENCIAS_MAXIMAS);
  },

  async buscarPedidos(ctx, filtro) {
    const limite = limitar(filtro.limite, BUSCA_PADRAO, BUSCA_MAXIMA);
    const texto = filtro.texto?.trim() ?? "";
    const numero = texto ? numeroDoPedido(texto) : null;
    const condicoes: (SQL | undefined)[] = [condicaoDeEstado(filtro.estado ?? "todos")];
    if (numero !== null) condicoes.push(eq(pedido.id, numero));
    // Várias palavras: todas precisam aparecer, cada uma em qualquer campo ("cimento comunicação").
    else for (const palavra of palavrasDaBusca(texto)) condicoes.push(condicaoDePalavra(palavra));
    const linhas = await db
      .select()
      .from(pedido)
      .where(and(...condicoes))
      .orderBy(desc(pedido.id))
      .limit(limite);
    return resumos(ctx, linhas);
  },

  async detalhePedido(ctx, pedidoId) {
    if (!idValido(pedidoId)) return null;
    const [p] = await db.select().from(pedido).where(eq(pedido.id, pedidoId));
    if (!p) return null;
    const itens = (await itensPorPedido([p.id])).get(p.id) ?? [];
    // Cotações só da rodada atual de cada item, como a tela do pedido.
    const cotacoes = itens.length
      ? await db
          .select({ c: cotacao, nome: fornecedor.nome, origem: fornecedor.origem })
          .from(cotacao)
          .innerJoin(fornecedor, eq(fornecedor.id, cotacao.fornecedorId))
          .where(inArray(cotacao.itemPedidoId, itens.map((i) => i.id)))
          .orderBy(asc(fornecedor.nome))
      : [];
    const base = resumoPedido(ctx, p, itens);
    return {
      ...base,
      destino: p.destino,
      cep: p.cep,
      prazoTexto: p.prazoTexto,
      prazoMaxDias: p.prazoMaxDias,
      entregas: p.entregas,
      suposicoes: p.suposicoes,
      motivoCancelamento: p.motivoCancelamento,
      itens: itens.map((i, n) => ({
        ...base.itens[n]!,
        rodada: i.rodada,
        cotacoes: cotacoes
          .filter((x) => x.c.itemPedidoId === i.id && x.c.rodada === i.rodada)
          .map((x): CotacaoResumo => ({ fornecedor: x.nome, fornecedorId: x.c.fornecedorId, simulado: x.origem === "simulado", situacao: x.c.situacao, rodada: x.c.rodada })),
      })),
    } satisfies DetalhePedido;
  },

  async mapaCotacao(ctx, itemId) {
    if (!idValido(itemId)) return null;
    const [l] = await db
      .select({ item: itemPedido, pedido })
      .from(itemPedido)
      .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
      .where(eq(itemPedido.id, itemId));
    if (!l) return null;
    const [m] = await db.select().from(mapaCotacao).where(eq(mapaCotacao.itemPedidoId, itemId)).orderBy(desc(mapaCotacao.criadoEm)).limit(1);
    // Sem mapa não há número para citar.
    if (!m) return null;
    const c = m.dados as Comparacao;
    const refs = await db
      .select()
      .from(referenciaPreco)
      .where(and(eq(referenciaPreco.itemPedidoId, itemId), eq(referenciaPreco.aceita, true), disponivelOuDesconhecido, isNotNull(referenciaPreco.precoUnitario)))
      .orderBy(desc(referenciaPreco.confianca), desc(referenciaPreco.coletadoEm))
      .limit(5);
    return {
      itemId,
      pedidoId: l.pedido.id,
      descricao: l.item.descricao,
      quantidade: Number(l.item.quantidade),
      unidade: l.item.unidade,
      estado: l.item.estado,
      rodada: m.rodada,
      daConversa: l.pedido.compradorId === ctx.contatoId,
      validas: c.validas.map(propostaResumo),
      cortadas: (c.cortadas ?? []).map((x) => ({ fornecedor: x.oferta.fornecedorNome, simulado: x.oferta.simulado, motivos: x.motivos })),
      // Com menos de 3 válidas o mapa nunca diz "melhor": não há recomendada.
      recomendada: c.podeDizerMelhor && c.vencedora ? c.vencedora.oferta.id : null,
      justificativa: m.recomendacao || null,
      pesos: c.pesos ?? null,
      // precoUnitario da referência já está na unidade do pedido (conversão segura, senão nulo e fica de fora).
      referenciaPublica: refs.map((r) => ({ loja: r.loja, preco: Number(r.precoUnitario), unidade: l.item.unidade, link: r.url, em: iso(r.coletadoEm) })),
      href: `/pedidos/${l.pedido.id}/comparacao#item-${itemId}`,
    } satisfies MapaResumo;
  },

  async linhaDoTempo(_ctx, pedidoId, limite) {
    if (!idValido(pedidoId)) return null;
    const [p] = await db.select({ id: pedido.id }).from(pedido).where(eq(pedido.id, pedidoId));
    if (!p) return null;
    const ids = (await db.select({ id: itemPedido.id }).from(itemPedido).where(eq(itemPedido.pedidoId, pedidoId))).map((i) => i.id);
    // Só os eventos dos agentes (o que fizeram e por quê), não a auditoria nem as chamadas de IA: são os que o comprador entende.
    const recentes = await db
      .select({ em: evento.criadoEm, agente: evento.agente, acao: evento.acao, motivo: evento.motivo, itemId: evento.itemPedidoId })
      .from(evento)
      .where(ids.length ? or(eq(evento.pedidoId, pedidoId), inArray(evento.itemPedidoId, ids)) : eq(evento.pedidoId, pedidoId))
      .orderBy(desc(evento.criadoEm))
      .limit(limitar(limite, TEMPO_PADRAO, TEMPO_MAXIMO));
    // Pegou os mais novos; devolve em ordem cronológica.
    return recentes.reverse().map(
      (e): EventoResumo => ({ em: iso(e.em), agente: e.agente, acao: e.acao, motivo: e.motivo.length > MOTIVO_MAXIMO ? `${e.motivo.slice(0, MOTIVO_MAXIMO)}…` : e.motivo, itemId: e.itemId }),
    );
  },

  async fornecedores(_ctx, busca) {
    let linhas: (typeof fornecedor.$inferSelect)[];
    if (busca.id !== undefined) {
      linhas = UUID.test(busca.id) ? await db.select().from(fornecedor).where(eq(fornecedor.id, busca.id.toLowerCase())) : [];
    } else {
      const palavras = palavrasDaBusca(busca.nome ?? "");
      const categoria = busca.categoria?.trim() ? chaveCategoria(busca.categoria) : null;
      const consulta = db
        .select()
        .from(fornecedor)
        .where(and(...palavras.map((w) => contem("fornecedor.nome", w))))
        .orderBy(asc(fornecedor.origem), asc(fornecedor.nome));
      if (categoria !== null) {
        // Categoria fica em jsonb: compara em código (sem acento e sem caixa), como a busca de fornecedores faz.
        // Quem vai receber cotação: sem bloqueados nem quem pediu PARAR. Confiança manda; no empate, real antes de simulado.
        linhas = (await consulta)
          .filter((f) => ativo(f) && f.categorias.some((c) => chaveCategoria(c) === categoria))
          .sort((a, b) => pontosDe(b) - pontosDe(a) || Number(a.origem === "simulado") - Number(b.origem === "simulado") || a.nome.localeCompare(b.nome))
          .slice(0, BUSCA_MAXIMA);
      } else if (palavras.length) {
        linhas = await consulta.limit(BUSCA_PADRAO);
      } else {
        // Sem nome ("qual é o mais confiável?"): sem bloqueados nem quem pediu PARAR, como na categoria.
        // A confiança manda, já no SQL e antes do limite; sem pontos (simulado) fica por último.
        linhas = await db
          .select()
          .from(fornecedor)
          .where(and(isNull(fornecedor.bloqueadoEm), isNull(fornecedor.parouEm)))
          .orderBy(sql`(${fornecedor.verificacao}->>'pontos')::numeric desc nulls last`, asc(fornecedor.origem), asc(fornecedor.nome))
          .limit(BUSCA_PADRAO);
      }
    }
    if (!linhas.length) return [];
    const compras = await db
      .select({ id: historicoCompra.fornecedorId, n: sql<number>`count(*)::int` })
      .from(historicoCompra)
      .where(inArray(historicoCompra.fornecedorId, linhas.map((f) => f.id)))
      .groupBy(historicoCompra.fornecedorId);
    return linhas.map((f): FornecedorResumo => {
      const v = (f.verificacao ?? {}) as { nivel?: unknown; pontos?: unknown; motivos?: unknown; alertas?: unknown };
      const textos = (x: unknown) => (Array.isArray(x) ? x.filter((t): t is string => typeof t === "string") : []);
      const simulado = f.origem === "simulado";
      return {
        id: f.id,
        nome: f.nome,
        origem: f.origem,
        categorias: f.categorias,
        homologado: f.homologado,
        bloqueado: f.bloqueadoEm !== null,
        // Sem julgamento gravado, o simulado ainda tem nível ("simulado"); o real fica sem.
        confianca: { nivel: typeof v.nivel === "string" ? v.nivel : simulado ? "simulado" : null, pontos: typeof v.pontos === "number" ? v.pontos : null, motivos: textos(v.motivos), alertas: textos(v.alertas) },
        compras: compras.find((c) => c.id === f.id)?.n ?? 0,
        href: `/fornecedores/${f.id}`,
      };
    });
  },

  async categorias() {
    // Chave sem acento e sem caixa, com o nome como a base escreve (ou, faltando na base, como o fornecedor).
    const mapa = new Map<string, CategoriaResumo>();
    const entrada = (nome: string) => {
      const chave = chaveCategoria(nome);
      if (!mapa.has(chave)) mapa.set(chave, { categoria: nome, itens: 0, fornecedores: 0, simulados: 0 });
      return mapa.get(chave)!;
    };
    // Base fixa mais o catálogo, se o processo o carregou (na web, só a base fixa).
    for (const item of baseDeItens()) if (item.categoria !== CATEGORIA_ARTIFICIAL) entrada(item.categoria).itens++;
    const fornecedores = await db.select({ categorias: fornecedor.categorias, origem: fornecedor.origem, bloqueadoEm: fornecedor.bloqueadoEm, parouEm: fornecedor.parouEm }).from(fornecedor);
    // As da base entram primeiro (nome certo); categoria só do fornecedor entra depois, para não roubar a grafia.
    for (const f of fornecedores) for (const c of f.categorias) if (c.trim() && c !== CATEGORIA_ARTIFICIAL) entrada(c);
    for (const f of fornecedores.filter(ativo)) {
      // Um fornecedor com a mesma categoria escrita duas vezes conta uma só.
      for (const chave of new Set(f.categorias.map(chaveCategoria))) {
        const e = mapa.get(chave);
        if (!e) continue;
        e.fornecedores++;
        if (f.origem === "simulado") e.simulados++;
      }
    }
    return [...mapa.values()].sort((a, b) => a.categoria.localeCompare(b.categoria, "pt-BR"));
  },

  async historicoCompras(_ctx, texto) {
    const palavras = palavrasDaBusca(texto);
    // innerJoin com o item: compra sem pedido (histórico inicial da base fictícia) não tem tela para citar.
    const linhas = await db
      .select({ h: historicoCompra, nome: fornecedor.nome, origem: fornecedor.origem, pedidoId: itemPedido.pedidoId, unidade: itemPedido.unidade })
      .from(historicoCompra)
      .innerJoin(fornecedor, eq(fornecedor.id, historicoCompra.fornecedorId))
      .innerJoin(itemPedido, eq(itemPedido.id, historicoCompra.itemPedidoId))
      .where(and(...palavras.map((w) => or(contem("historico_compra.descricao", w), contem("historico_compra.item_chave", w)))))
      .orderBy(desc(historicoCompra.data))
      .limit(BUSCA_PADRAO);
    return linhas.map(
      ({ h, nome, origem, pedidoId, unidade }): CompraResumo => ({
        pedidoId,
        itemId: h.itemPedidoId,
        item: h.descricao,
        fornecedor: nome,
        // Simulado se o fornecedor é simulado ou se a compra foi registrada como simulada.
        simulado: origem === "simulado" || h.simulado,
        precoUnitario: Number(h.precoUnitario),
        quantidade: Number(h.quantidade),
        unidade,
        data: iso(h.data),
        prazoCumprido: h.prazoCumprido,
        href: `/pedidos/${pedidoId}`,
      }),
    );
  },

  async economia(ctx, diasPedidos) {
    const periodoDias = limitar(diasPedidos, ECONOMIA_DIAS_PADRAO, ECONOMIA_DIAS_MAXIMO);
    const desde = new Date(ctx.agora.getTime() - periodoDias * 86_400_000);
    const confirmados = await db
      .select({ item: itemPedido })
      .from(itemPedido)
      .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
      .where(and(eq(itemPedido.estado, "confirmado"), gte(itemPedido.atualizadoEm, desde)));
    const ids = confirmados.map((c) => c.item.id);
    const mapas = ids.length
      ? await db
          .selectDistinctOn([mapaCotacao.itemPedidoId], { itemId: mapaCotacao.itemPedidoId, dados: mapaCotacao.dados })
          .from(mapaCotacao)
          .where(inArray(mapaCotacao.itemPedidoId, ids))
          .orderBy(mapaCotacao.itemPedidoId, desc(mapaCotacao.criadoEm))
      : [];
    // Mediana do preço público (lojas aceitas e em estoque), como a tela de economia.
    const refs = ids.length
      ? await db
          .select({ itemId: referenciaPreco.itemPedidoId, mediana: sql<string | null>`percentile_cont(0.5) within group (order by ${referenciaPreco.precoUnitario})` })
          .from(referenciaPreco)
          .where(and(inArray(referenciaPreco.itemPedidoId, ids), eq(referenciaPreco.aceita, true), disponivelOuDesconhecido, isNotNull(referenciaPreco.precoUnitario)))
          .groupBy(referenciaPreco.itemPedidoId)
      : [];

    const compras = confirmados.map(({ item }): CompraEconomia => {
      const c = mapas.find((m) => m.itemId === item.id)?.dados as Comparacao | undefined;
      const escolhida = c?.validas.find((l) => l.oferta.id === item.ofertaEscolhidaId) ?? null;
      const maisCara = c?.validas.length ? c.validas.reduce((a, b) => ((b.custo ?? 0) > (a.custo ?? 0) ? b : a)) : null;
      const mediana = reais(refs.find((r) => r.itemId === item.id)?.mediana);
      return {
        custo: escolhida?.custo ?? null,
        produto: escolhida?.produto ?? null,
        produtoAntesNegociar: escolhida?.oferta.produtoAnterior ?? null,
        maisCaraCusto: maisCara?.custo ?? null,
        validas: c?.validas.length ?? 0,
        referenciaProduto: mediana === null ? null : centavos(mediana * Number(item.quantidade)),
        simulado: escolhida?.oferta.simulado ?? false,
      };
    });
    const { simuladas, ...numeros } = somarEconomia(compras);
    const observacao = [
      "Economia vs referência: produto comprado contra a mediana dos preços públicos da internet vezes a quantidade (frete fora).",
      "Vs mais cara: custo total escolhido contra a proposta válida mais cara do mesmo mapa.",
      "Negociação: quanto o produto baixou depois da contraproposta.",
      "Total pago soma só compras com mapa gravado.",
      simuladas ? `${simuladas} de ${compras.length} compras foram com fornecedores simulados.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return { periodoDias, ...numeros, observacao, href: "/economia" };
  },
};
