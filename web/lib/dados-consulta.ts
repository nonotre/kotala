// Consultas das telas de consulta: fornecedores, ficha do fornecedor e itens.
// Só leitura, como lib/dados.ts. Tudo sai serializável (datas em texto ISO),
// para ir direto às telas de cliente.

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../../src/nucleo/db/cliente.ts";
import {
  contato,
  cotacao,
  fornecedor,
  historicoCompra,
  itemCatalogo,
  itemPedido,
  mapaCotacao,
  oferta,
  pedido,
  referenciaPreco,
  sancao,
} from "../../src/nucleo/db/schema.ts";
import { listaFornecedores } from "./dados";
import type { Comparacao } from "./dados";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

/** O que o Q8 grava em fornecedor.verificacao. Tudo opcional: só aparece o que veio. */
export type Verificacao = {
  pontos?: number;
  nivel?: string;
  resumo?: string;
  motivos?: string[];
  alertas?: string[];
  fonte?: string;
  em?: string;
  cnpj?: string | null;
  razaoSocial?: string | null;
  municipio?: string | null;
  uf?: string | null;
};

// ---------- Lista ----------

export type LinhaFornecedor = {
  id: string;
  nome: string;
  cnpj: string | null;
  simulado: boolean;
  verificado: boolean;
  homologado: boolean;
  bloqueadoEm: string | null;
  motivoBloqueio: string | null;
  parouEm: string | null;
  fonte: string | null;
  regiao: string | null;
  verificacao: Verificacao | null;
  /** Como lib/dados mostra: "telegram", "telegram (parou)". */
  canais: string[];
  /** Canais em que ainda dá para falar com ele. */
  canaisAtivos: number;
  propostas: number;
  compras: number;
};

/** Q8: a mesma lista de lib/dados, com o que a tela precisa para filtrar. */
export async function fornecedoresDaLista(): Promise<LinhaFornecedor[]> {
  const lista = await listaFornecedores();
  return lista.map((f) => ({
    id: f.id,
    nome: f.nome,
    cnpj: f.cnpj,
    simulado: f.origem === "simulado",
    verificado: f.verificado,
    homologado: f.homologado,
    bloqueadoEm: iso(f.bloqueadoEm),
    motivoBloqueio: f.motivoBloqueio,
    parouEm: iso(f.parouEm),
    fonte: f.fonte,
    regiao: f.regiao,
    verificacao: f.verificacao as Verificacao | null,
    canais: f.canais,
    canaisAtivos: f.canais.filter((c) => !c.endsWith("(parou)")).length,
    propostas: f.propostas,
    compras: f.compras,
  }));
}

// ---------- Ficha ----------

export type CotacaoDaFicha = {
  id: string;
  pedidoId: number;
  itemId: number;
  item: string;
  quantidade: string;
  unidade: string;
  estadoItem: string;
  rodada: number;
  rodadaAtual: number;
  situacao: string;
  enviadaEm: string | null;
  respondeuEm: string | null;
  /** Mesma regra da tela de voz: item cotando e cotação aguardando ou respondida. */
  podeLigar: boolean;
  escolhido: boolean;
  proposta: {
    itemOferecido: string;
    precoUnitario: number | null;
    totalProduto: number | null;
    frete: number | null;
    origemFrete: string | null;
    prazoDias: number | null;
    pagamento: string | null;
    formato: string;
    /** Do mapa de cotação mais recente do item, quando a oferta está nele. */
    custo: number | null;
    nota: number | null;
    valida: boolean | null;
    motivos: string[];
  } | null;
};

export type FichaFornecedor = {
  id: string;
  nome: string;
  cnpj: string | null;
  simulado: boolean;
  verificado: boolean;
  homologado: boolean;
  bloqueadoEm: string | null;
  motivoBloqueio: string | null;
  parouEm: string | null;
  fonte: string | null;
  regiao: string | null;
  cep: string | null;
  email: string | null;
  temConvitePessoal: boolean;
  criadoEm: string;
  verificacao: Verificacao | null;
  contatos: { id: string; canal: string; nome: string | null; desde: string; avisoPrivacidadeEm: string | null; parouEm: string | null }[];
  /** null quando o fornecedor não tem CNPJ ou a base de sanções está vazia. */
  sancoes: { base: string | null; lista: { cadastro: string; categoria: string | null; orgao: string | null; uf: string | null; inicio: string | null; fim: string | null; mesmaUnidade: boolean }[] } | null;
  cotacoes: CotacaoDaFicha[];
  /** Propostas que não vieram de uma cotação enviada (busca, histórico). */
  ofertasAvulsas: number;
  compras: {
    id: string;
    descricao: string;
    precoUnitario: number;
    quantidade: number;
    frete: number | null;
    data: string;
    prazoPrometidoDias: number | null;
    prazoCumprido: boolean | null;
    experiencia: string | null;
    simulado: boolean;
    pedidoId: number | null;
    itemId: number | null;
  }[];
};

const so8 = (cnpj: string) => cnpj.replace(/\D/g, "");

export async function fichaFornecedor(id: string): Promise<FichaFornecedor | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [f] = await db.select().from(fornecedor).where(eq(fornecedor.id, id));
  if (!f) return null;

  const contatos = await db.select().from(contato).where(eq(contato.fornecedorId, id)).orderBy(asc(contato.criadoEm));

  let sancoes: FichaFornecedor["sancoes"] = null;
  if (f.cnpj && so8(f.cnpj).length >= 8) {
    const digitos = so8(f.cnpj);
    const [base] = await db.select({ base: sql<string | null>`max(${sancao.base})` }).from(sancao);
    if (base?.base) {
      const achadas = await db.select().from(sancao).where(eq(sancao.raiz, digitos.slice(0, 8))).orderBy(desc(sancao.inicio));
      sancoes = {
        base: base.base,
        lista: achadas.map((s) => ({ cadastro: s.cadastro, categoria: s.categoria, orgao: s.orgao, uf: s.uf, inicio: s.inicio, fim: s.fim, mesmaUnidade: s.cnpj === digitos })),
      };
    }
  }

  const cots = await db
    .select({ c: cotacao, item: itemPedido })
    .from(cotacao)
    .innerJoin(itemPedido, eq(itemPedido.id, cotacao.itemPedidoId))
    .where(eq(cotacao.fornecedorId, id))
    .orderBy(desc(cotacao.criadoEm))
    .limit(50);
  const ofertas = await db.select().from(oferta).where(eq(oferta.fornecedorId, id)).orderBy(desc(oferta.criadoEm));
  const itensIds = [...new Set(cots.map((x) => x.item.id))];
  const mapas = itensIds.length
    ? await db
        .selectDistinctOn([mapaCotacao.itemPedidoId], { itemId: mapaCotacao.itemPedidoId, dados: mapaCotacao.dados })
        .from(mapaCotacao)
        .where(inArray(mapaCotacao.itemPedidoId, itensIds))
        .orderBy(mapaCotacao.itemPedidoId, desc(mapaCotacao.criadoEm))
    : [];

  const cotacoes: CotacaoDaFicha[] = cots.map(({ c, item }) => {
    const o = ofertas.find((x) => x.cotacaoId === c.id) ?? null;
    const m = mapas.find((x) => x.itemId === item.id)?.dados as Comparacao | undefined;
    const linha = o && m ? [...m.validas, ...(m.cortadas ?? [])].find((l) => l.oferta.id === o.id) : undefined;
    return {
      id: c.id,
      pedidoId: item.pedidoId,
      itemId: item.id,
      item: item.descricao,
      quantidade: item.quantidade,
      unidade: item.unidade,
      estadoItem: item.estado,
      rodada: c.rodada,
      rodadaAtual: item.rodada,
      situacao: c.situacao,
      enviadaEm: iso(c.enviadaEm),
      respondeuEm: iso(c.respondeuEm),
      podeLigar: item.estado === "cotando" && ["aguardando", "respondeu"].includes(c.situacao),
      escolhido: !!o && item.ofertaEscolhidaId === o.id,
      proposta: o
        ? {
            itemOferecido: o.itemOferecido,
            precoUnitario: num(o.precoUnitario),
            totalProduto: num(o.totalProduto),
            frete: num(o.frete),
            origemFrete: o.origemFrete,
            prazoDias: o.prazoDias,
            pagamento: o.pagamento,
            formato: o.formato,
            custo: linha?.custo ?? null,
            nota: linha?.nota ?? null,
            valida: linha ? linha.valida : null,
            motivos: linha?.motivos ?? [],
          }
        : null,
    };
  });

  const compras = await db.select().from(historicoCompra).where(eq(historicoCompra.fornecedorId, id)).orderBy(desc(historicoCompra.data));
  const pedidosDasCompras = compras.some((h) => h.itemPedidoId)
    ? await db
        .select({ id: itemPedido.id, pedidoId: itemPedido.pedidoId })
        .from(itemPedido)
        .where(inArray(itemPedido.id, compras.flatMap((h) => (h.itemPedidoId ? [h.itemPedidoId] : []))))
    : [];

  return {
    id: f.id,
    nome: f.nome,
    cnpj: f.cnpj,
    simulado: f.origem === "simulado",
    verificado: f.verificado,
    homologado: f.homologado,
    bloqueadoEm: iso(f.bloqueadoEm),
    motivoBloqueio: f.motivoBloqueio,
    parouEm: iso(f.parouEm),
    fonte: f.fonte,
    regiao: f.regiao,
    cep: f.cep,
    email: f.email,
    temConvitePessoal: !!f.codigoConvite,
    criadoEm: f.criadoEm.toISOString(),
    verificacao: f.verificacao as Verificacao | null,
    contatos: contatos.map((c) => ({ id: c.id, canal: c.canal, nome: c.nome, desde: c.criadoEm.toISOString(), avisoPrivacidadeEm: iso(c.avisoPrivacidadeEm), parouEm: iso(c.parouEm) })),
    sancoes,
    cotacoes,
    ofertasAvulsas: ofertas.filter((o) => !o.cotacaoId).length,
    compras: compras.map((h) => ({
      id: h.id,
      descricao: h.descricao,
      precoUnitario: Number(h.precoUnitario),
      quantidade: Number(h.quantidade),
      frete: num(h.frete),
      data: h.data.toISOString(),
      prazoPrometidoDias: h.prazoPrometidoDias,
      prazoCumprido: h.prazoCumprido,
      experiencia: h.experiencia,
      simulado: h.simulado,
      itemId: h.itemPedidoId,
      pedidoId: pedidosDasCompras.find((p) => p.id === h.itemPedidoId)?.pedidoId ?? null,
    })),
  };
}

// ---------- Itens ----------

export type ItemDaBase = {
  /** Chave do item: o código (ITM-...) ou a chave de memória do pedido. */
  chave: string;
  codigo: string | null;
  descricao: string;
  unidade: string;
  especificacao: Record<string, string>;
  categoria: string | null;
  /** Cadastrado pelo assistente porque não estava na base: o pedido em que apareceu. */
  cadastradoNoPedido: number | null;
  pedidos: { pedidoId: number; itemId: number; quantidade: number; unidade: string; estado: string; em: string }[];
  compras: { fornecedorId: string; fornecedor: string; simuladoFornecedor: boolean; precoUnitario: number; quantidade: number; frete: number | null; data: string; simulado: boolean; pedidoId: number | null }[];
  propostas: { fornecedorId: string; fornecedor: string; simulado: boolean; quantas: number }[];
  referencia: {
    /** Mediana do preço convertido para a unidade do pedido, das lojas aceitas e disponíveis. */
    mediana: number | null;
    lojas: number;
    lista: { loja: string; titulo: string; url: string; preco: number | null; unidade: string; coletadoEm: string }[];
  };
};

const chaveDe = (itemChave: string | null, descricao: string) =>
  itemChave ??
  descricao
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function mediana(v: number[]): number | null {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2;
}

/** E6: o que já foi pedido, comprado ou cadastrado, agrupado pelo mesmo item. */
export async function itensDaBase(): Promise<ItemDaBase[]> {
  const catalogo = await db.select().from(itemCatalogo).orderBy(asc(itemCatalogo.id));
  const pedidos = await db
    .select({ id: itemPedido.id, pedidoId: itemPedido.pedidoId, itemChave: itemPedido.itemChave, descricao: itemPedido.descricao, quantidade: itemPedido.quantidade, unidade: itemPedido.unidade, especificacao: itemPedido.especificacao, estado: itemPedido.estado, criadoEm: itemPedido.criadoEm })
    .from(itemPedido)
    .orderBy(desc(itemPedido.criadoEm));
  const compras = await db
    .select({ h: historicoCompra, nome: fornecedor.nome, origem: fornecedor.origem })
    .from(historicoCompra)
    .innerJoin(fornecedor, eq(fornecedor.id, historicoCompra.fornecedorId))
    .orderBy(desc(historicoCompra.data));
  const propostas = await db
    .select({ itemId: oferta.itemPedidoId, fornecedorId: oferta.fornecedorId, nome: fornecedor.nome, origem: fornecedor.origem, n: sql<number>`count(*)::int` })
    .from(oferta)
    .innerJoin(fornecedor, eq(fornecedor.id, oferta.fornecedorId))
    .groupBy(oferta.itemPedidoId, oferta.fornecedorId, fornecedor.nome, fornecedor.origem);
  const refs = await db
    .select()
    .from(referenciaPreco)
    .where(and(eq(referenciaPreco.aceita, true), ne(referenciaPreco.disponivel, false)))
    .orderBy(desc(referenciaPreco.coletadoEm));

  const grupos = new Map<string, ItemDaBase>();
  const novo = (chave: string, descricao: string, unidade: string, especificacao: Record<string, string>): ItemDaBase => ({
    chave,
    codigo: chave.startsWith("ITM-") ? chave : null,
    descricao,
    unidade,
    especificacao,
    categoria: null,
    cadastradoNoPedido: null,
    pedidos: [],
    compras: [],
    propostas: [],
    referencia: { mediana: null, lojas: 0, lista: [] },
  });

  for (const c of catalogo) {
    const g = novo(c.codigo, c.descricao, c.unidade, c.especificacao);
    g.categoria = c.categoria;
    g.cadastradoNoPedido = c.pedidoId;
    grupos.set(c.codigo, g);
  }
  const itemParaChave = new Map<number, string>();
  for (const p of pedidos) {
    const chave = chaveDe(p.itemChave, p.descricao);
    itemParaChave.set(p.id, chave);
    // O mais novo vem primeiro: ele dá o nome e a especificação, se o catálogo não deu.
    const g = grupos.get(chave) ?? novo(chave, p.descricao, p.unidade, p.especificacao);
    grupos.set(chave, g);
    g.pedidos.push({ pedidoId: p.pedidoId, itemId: p.id, quantidade: Number(p.quantidade), unidade: p.unidade, estado: p.estado, em: p.criadoEm.toISOString() });
  }
  for (const { h, nome, origem } of compras) {
    const chave = h.itemChave;
    const g = grupos.get(chave) ?? novo(chave, h.descricao, "", {});
    grupos.set(chave, g);
    g.compras.push({
      fornecedorId: h.fornecedorId,
      fornecedor: nome,
      simuladoFornecedor: origem === "simulado",
      precoUnitario: Number(h.precoUnitario),
      quantidade: Number(h.quantidade),
      frete: num(h.frete),
      data: h.data.toISOString(),
      simulado: h.simulado,
      pedidoId: pedidos.find((p) => p.id === h.itemPedidoId)?.pedidoId ?? null,
    });
  }
  for (const p of propostas) {
    const g = grupos.get(itemParaChave.get(p.itemId) ?? "");
    if (!g) continue;
    const ja = g.propostas.find((x) => x.fornecedorId === p.fornecedorId);
    if (ja) ja.quantas += p.n;
    else g.propostas.push({ fornecedorId: p.fornecedorId, fornecedor: p.nome, simulado: p.origem === "simulado", quantas: p.n });
  }
  for (const r of refs) {
    const g = grupos.get(itemParaChave.get(r.itemPedidoId) ?? "");
    if (!g) continue;
    g.referencia.lista.push({ loja: r.loja, titulo: r.titulo, url: r.url, preco: num(r.precoUnitario), unidade: g.unidade, coletadoEm: r.coletadoEm.toISOString() });
  }
  for (const g of grupos.values()) {
    const precos = g.referencia.lista.flatMap((r) => (r.preco !== null ? [r.preco] : []));
    g.referencia.mediana = mediana(precos);
    g.referencia.lojas = precos.length;
    g.propostas.sort((a, b) => b.quantas - a.quantas || a.fornecedor.localeCompare(b.fornecedor, "pt-BR"));
  }
  return [...grupos.values()].sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR"));
}
