// I5: memória na conversa do comprador. "O mesmo de ontem", "manda pro mesmo endereço", "aquele
// fornecedor": quando a mensagem se refere a algo anterior, o Interpretador recebe os pedidos e as
// compras recentes do comprador (das tabelas que já existem: pedido, item_pedido, historico_compra),
// e o código completa o que a IA deixou vazio. Sem tabela nova. Só olha a memória quando a
// mensagem cita algo anterior, para não gastar tokens nem misturar pedidos à toa.

import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { db } from "../../nucleo/db/cliente.ts";
import { contato, fornecedor, historicoCompra, itemPedido, pedido } from "../../nucleo/db/schema.ts";
import type { Interpretacao } from "./index.ts";
import { palavrasEmComum } from "./index.ts";

/** Até onde a memória volta. */
export const DIAS_MEMORIA = 30;
const MAX_PEDIDOS = 5;

export type PedidoRecente = {
  id: number;
  criadoEm: Date;
  estado: string;
  destino: string | null;
  cep: string | null;
  modoEntrega: "entrega" | "retirada" | null;
  setor: string | null;
  pagamento: string | null;
  itens: { descricao: string; quantidade: number; unidade: string; especificacao: Record<string, string> }[];
  /** Compra fechada no pedido (historico_compra), quando houve. */
  compras: { item: string; fornecedor: string; precoUnitario: number; data: Date }[];
};

export type MemoriaConversa = { pedidos: PedidoRecente[] };

// ---------- Quando a mensagem cita algo anterior (código, sem IA) ----------

const sem = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const MESMOS_ITENS =
  /\b(o mesmo|a mesma|os mesmos|as mesmas|mesm[oa]s? (pedido|coisa|itens?|material|de ontem)|de novo|novamente|repet\w*|outra vez|igual(zinho)? (ao|a|o|da|do) (anterior|ultim[oa]|de ontem|da semana|pedido)|de sempre|como (da|na) (ultima|outra) vez|o (ultimo|anterior) pedido|o pedido (anterior|de ontem|da semana passada))\b/;
const MESMO_LOCAL = /\b(mesmo (endereco|local|lugar|destino|ponto)|mesma (obra|loja|filial|unidade|sede|entrega)|(entrega|manda|envia)\w* (la|no mesmo lugar)|onde (foi|entregou|mandou) (da|na) (ultima|outra) vez)\b/;
const MESMO_SETOR = /\bmesmo setor\b|\bmesma area\b/;
const MESMO_FORNECEDOR = /\b(aquele|daquele|o mesmo|do mesmo|mesmo) fornecedor\b|\bcomprar? (de|da|do) (novo |mesm[oa] )?(quem|onde) (comprei|compramos)\b|\bmesma loja\b/;
const ONTEM = /\bontem\b/;
const ANTEONTEM = /\banteontem\b/;
const SEMANA_PASSADA = /\bsemana passada\b/;

/** A mensagem se refere a um pedido, compra, endereço ou fornecedor anterior. */
export function citaAlgoAnterior(texto: string): boolean {
  const t = sem(texto);
  return [MESMOS_ITENS, MESMO_LOCAL, MESMO_SETOR, MESMO_FORNECEDOR, ONTEM, ANTEONTEM, SEMANA_PASSADA].some((r) => r.test(t)) || /\bpedido\s*(n[ºo°.]?\s*)?\d+\b/.test(t);
}

const DIA_MS = 24 * 3600_000;
const diaSP = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/**
 * O pedido a que a mensagem se refere: "pedido 12" pelo número; "ontem", "anteontem" e "semana
 * passada" pela data; senão o mais recente. Cancelado só entra se for o único da data.
 */
export function pedidoReferido(texto: string, pedidos: readonly PedidoRecente[], agora: Date): PedidoRecente | null {
  if (!pedidos.length) return null;
  const t = sem(texto);
  const n = /\bpedido\s*(?:n[ºo°.]?\s*)?(\d+)\b/.exec(t)?.[1];
  if (n) return pedidos.find((p) => p.id === Number(n)) ?? null;
  let candidatos = [...pedidos].sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
  const noDia = (dias: number) => candidatos.filter((p) => diaSP(p.criadoEm) === diaSP(new Date(agora.getTime() - dias * DIA_MS)));
  if (ANTEONTEM.test(t)) candidatos = noDia(2);
  else if (ONTEM.test(t)) candidatos = noDia(1);
  else if (SEMANA_PASSADA.test(t)) candidatos = candidatos.filter((p) => agora.getTime() - p.criadoEm.getTime() >= 6 * DIA_MS && agora.getTime() - p.criadoEm.getTime() <= 14 * DIA_MS);
  return candidatos.find((p) => p.estado !== "cancelado") ?? candidatos[0] ?? null;
}

const dataCurta = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

/** Bloco que vai no prompt do Interpretador: compacto, só o que serve para completar o pedido. */
export function textoMemoria(m: MemoriaConversa): string {
  return JSON.stringify(
    m.pedidos.map((p) => ({
      pedido: p.id,
      em: dataCurta(p.criadoEm),
      situacao: p.estado,
      itens: p.itens.map((i) => ({ descricao: i.descricao, quantidade: i.quantidade, unidade: i.unidade, ...(Object.keys(i.especificacao).length ? { especificacao: i.especificacao } : {}) })),
      destino: p.modoEntrega === "retirada" ? "retirada na loja" : p.destino,
      setor: p.setor,
      ...(p.compras.length ? { comprado: p.compras.map((c) => ({ item: c.item, fornecedor: c.fornecedor, em: dataCurta(c.data) })) } : {}),
    })),
  );
}

type ItemLido = Interpretacao["itens"][number];

/**
 * Completa em código o que a IA deixou vazio, a partir do pedido referido:
 * - "o mesmo de ontem", "repete o último" sem item: os itens do pedido, com quantidade e unidade;
 * - item citado sem quantidade que estava no pedido: a quantidade de lá;
 * - "mesmo endereço" (ou itens repetidos) sem destino: o destino de lá; o mesmo para o setor;
 * - "aquele fornecedor": só a anotação de quem foi (a recompra, X2, oferece repetir com ele).
 * Cada uso vira suposição, que o comprador vê na confirmação. Consulta, recusa e outras
 * classes não mudam: só "pedido" e "ambiguo".
 */
export function aplicarMemoria(i: Interpretacao, texto: string, m: MemoriaConversa, agora: Date): { interpretacao: Interpretacao; usou: number | null } {
  if (i.classe !== "pedido" && i.classe !== "ambiguo") return { interpretacao: i, usou: null };
  const ref = pedidoReferido(texto, m.pedidos, agora);
  if (!ref) return { interpretacao: i, usou: null };
  const t = sem(texto);
  const r: Interpretacao = { ...i, itens: i.itens.map((x) => ({ ...x })), faltando: [...i.faltando], suposicoes: [...i.suposicoes] };
  const de = `do pedido ${ref.id} (${dataCurta(ref.criadoEm)})`;
  let usou = false;

  const repetiu = !r.itens.length && MESMOS_ITENS.test(t) && ref.itens.length > 0;
  if (repetiu) {
    r.itens = ref.itens.map(
      (x): ItemLido => ({
        descricao: x.descricao,
        quantidade: x.quantidade,
        unidade: x.unidade,
        especificacao: Object.entries(x.especificacao).map(([nome, valor]) => ({ nome, valor })),
        marca: null,
        marcaExigida: false,
        aceitaSimilar: null,
        risco: "nenhum",
        motivoRisco: null,
      }),
    );
    r.classe = "pedido";
    r.subtipo = null;
    r.opcoes = [];
    // As perguntas de "o que quer comprar?" perdem o sentido com os itens repetidos.
    r.faltando = r.faltando.filter((f) => !/qual|quais|o que|do que|itens?|produto/i.test(f));
    r.suposicoes.push(`Mesmos itens ${de}`);
    usou = true;
  } else {
    for (const it of r.itens) {
      if (it.quantidade > 0) continue;
      const igual = ref.itens.find((x) => palavrasEmComum(x.descricao, it.descricao));
      if (!igual) continue;
      it.quantidade = igual.quantidade;
      if (!it.unidade || it.unidade === "unidade") it.unidade = igual.unidade;
      r.faltando = r.faltando.filter((f) => !(/quant|quantos|quantas/i.test(f) && palavrasEmComum(f, it.descricao)));
      r.suposicoes.push(`${it.descricao}: ${igual.quantidade} ${igual.unidade}, como ${de}`);
      usou = true;
    }
  }

  if ((MESMO_LOCAL.test(t) || repetiu) && !r.destino && (ref.destino || ref.modoEntrega === "retirada")) {
    r.destino = ref.destino;
    r.cep = r.cep ?? ref.cep;
    r.modoEntrega = r.modoEntrega ?? ref.modoEntrega;
    r.faltando = r.faltando.filter((f) => !/destino|endere[cç]o|entreg|onde|local|cep/i.test(f));
    r.suposicoes.push(ref.modoEntrega === "retirada" ? `Retirada na loja, como ${de}` : `Mesmo endereço ${de}`);
    usou = true;
  }
  if ((MESMO_SETOR.test(t) || repetiu) && !r.setor && ref.setor) {
    r.setor = ref.setor;
    r.suposicoes.push(`Setor ${ref.setor}, como ${de}`);
    usou = true;
  }
  if (repetiu && !r.pagamento && ref.pagamento) r.pagamento = ref.pagamento;
  if (MESMO_FORNECEDOR.test(t) && ref.compras.length) {
    const c = ref.compras[0]!;
    r.suposicoes.push(`Fornecedor citado: ${c.fornecedor} (compra de ${c.item} em ${dataCurta(c.data)})`);
    usou = true;
  }
  if (!usou) return { interpretacao: i, usou: null };
  r.suposicoes = r.suposicoes.slice(0, 6);
  r.ehPedido = r.classe === "pedido" && r.itens.length > 0;
  return { interpretacao: r, usou: ref.id };
}

// ---------- Banco ----------

/**
 * Pedidos recentes do comprador e as compras fechadas neles. Vale para todas as conversas da mesma
 * pessoa (o chat web abre um contato por conversa, ligado à mesma conta), nunca de outra pessoa.
 */
export async function memoriaDoComprador(compradorId: string, o: { excetoPedidoId?: number; agora?: Date } = {}): Promise<MemoriaConversa> {
  const agora = o.agora ?? new Date();
  const [eu] = await db.select({ usuarioId: contato.usuarioId }).from(contato).where(eq(contato.id, compradorId));
  const contatos = eu?.usuarioId ? (await db.select({ id: contato.id }).from(contato).where(eq(contato.usuarioId, eu.usuarioId))).map((c) => c.id) : [];
  const ids = [...new Set([compradorId, ...contatos])];
  const desde = new Date(agora.getTime() - DIAS_MEMORIA * DIA_MS);
  const pedidos = await db
    .select()
    .from(pedido)
    .where(and(inArray(pedido.compradorId, ids), gte(pedido.criadoEm, desde), ...(o.excetoPedidoId ? [ne(pedido.id, o.excetoPedidoId)] : [])))
    .orderBy(desc(pedido.criadoEm))
    .limit(MAX_PEDIDOS);
  if (!pedidos.length) return { pedidos: [] };
  const itens = await db.select().from(itemPedido).where(inArray(itemPedido.pedidoId, pedidos.map((p) => p.id)));
  const compras = itens.length
    ? await db
        .select({ itemPedidoId: historicoCompra.itemPedidoId, descricao: historicoCompra.descricao, preco: historicoCompra.precoUnitario, data: historicoCompra.data, fornecedor: fornecedor.nome })
        .from(historicoCompra)
        .innerJoin(fornecedor, eq(fornecedor.id, historicoCompra.fornecedorId))
        .where(inArray(historicoCompra.itemPedidoId, itens.map((i) => i.id)))
    : [];
  return {
    pedidos: pedidos.map((p) => {
      const deste = itens.filter((i) => i.pedidoId === p.id).sort((a, b) => a.ordem - b.ordem);
      const ids = new Set(deste.map((i) => i.id));
      return {
        id: p.id,
        criadoEm: p.criadoEm,
        estado: p.estado,
        destino: p.destino,
        cep: p.cep,
        modoEntrega: p.modoEntrega,
        setor: p.setor,
        pagamento: p.pagamentoPreferido,
        itens: deste.map((i) => ({ descricao: i.descricao, quantidade: Number(i.quantidade), unidade: i.unidade, especificacao: i.especificacao })),
        compras: compras.filter((c) => c.itemPedidoId !== null && ids.has(c.itemPedidoId)).map((c) => ({ item: c.descricao, fornecedor: c.fornecedor, precoUnitario: Number(c.preco), data: c.data })),
      };
    }),
  };
}
