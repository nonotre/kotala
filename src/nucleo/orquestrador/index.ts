// N3: orquestrador. Sabe em que passo cada pedido e cada item está e chama o
// agente certo. Toda mudança de estado passa por avancarPedido/avancarItem:
// UPDATE atômico (WHERE estado = atual) + evento no registro, na mesma transação.
// Os agentes rodam depois do commit, nunca dentro da transação.

import { and, asc, eq, inArray, lte, notInArray } from "drizzle-orm";
import { db, type Executor } from "../db/cliente.ts";
import { itemPedido, pedido } from "../db/schema.ts";
import { registrar, type Agente } from "../registro.ts";
import {
  FINAIS_ITEM,
  proximoEstadoItem,
  proximoEstadoPedido,
  type EstadoItem,
  type EstadoPedido,
  type EventoItem,
  type EventoPedido,
} from "./estados.ts";

export * from "./estados.ts";

export class TransicaoInvalida extends Error {
  constructor(alvo: string, atual: string, evento: string) {
    super(`${alvo}: o evento "${evento}" não vale no estado "${atual}".`);
    this.name = "TransicaoInvalida";
  }
}

/** Outro processo mudou o estado entre a leitura e a escrita. Quem chamou decide se tenta de novo. */
export class TransicaoConcorrente extends Error {
  constructor(alvo: string) {
    super(`${alvo}: o estado mudou durante a transição.`);
    this.name = "TransicaoConcorrente";
  }
}

export type Motivo = { agente: Agente; motivo: string; acao?: string; dados?: unknown; fornecedorIds?: string[] };

// ---------- Ganchos: quem reage à entrada em cada estado ----------

export type MudancaPedido = { pedidoId: number; de: EstadoPedido; para: EstadoPedido; evento: EventoPedido };
export type MudancaItem = { pedidoId: number; itemPedidoId: number; de: EstadoItem; para: EstadoItem; evento: EventoItem };

type Gancho<M> = (m: M) => Promise<void> | void;
const ganchosPedido = new Map<EstadoPedido, Gancho<MudancaPedido>[]>();
const ganchosItem = new Map<EstadoItem, Gancho<MudancaItem>[]>();

/** Registra um agente para agir quando um pedido entra no estado. */
export function aoEntrarPedido(estado: EstadoPedido, fn: Gancho<MudancaPedido>) {
  ganchosPedido.set(estado, [...(ganchosPedido.get(estado) ?? []), fn]);
}

/** Registra um agente para agir quando um item entra no estado. Ex.: aoEntrarItem("buscando", buscar). */
export function aoEntrarItem(estado: EstadoItem, fn: Gancho<MudancaItem>) {
  ganchosItem.set(estado, [...(ganchosItem.get(estado) ?? []), fn]);
}

async function disparar<M extends { pedidoId: number; itemPedidoId?: number; para: string }>(ganchos: Gancho<M>[], m: M) {
  for (const g of ganchos) {
    try {
      await g(m);
    } catch (erro) {
      // Falha de agente não desfaz a transição: fica registrada e o pedido continua visível no quadro.
      await registrar(db, {
        agente: "Acompanhamento do pedido",
        acao: `Falhou ao agir em "${m.para}".`,
        motivo: erro instanceof Error ? erro.message : String(erro),
        pedidoId: m.pedidoId,
        itemPedidoId: m.itemPedidoId,
        dados: { erro: String(erro) },
      }).catch(() => {});
      console.error(`[orquestrador] gancho de "${m.para}" falhou:`, erro);
    }
  }
}

// ---------- Transições ----------

export async function avancarPedido(
  pedidoId: number,
  evento: EventoPedido,
  motivo: Motivo,
  alteracoes: Partial<Omit<typeof pedido.$inferInsert, "id" | "estado">> = {},
): Promise<MudancaPedido> {
  const mudanca = await db.transaction(async (tx) => {
    const [atual] = await tx.select({ estado: pedido.estado }).from(pedido).where(eq(pedido.id, pedidoId));
    if (!atual) throw new Error(`Pedido ${pedidoId} não existe.`);
    const para = proximoEstadoPedido(atual.estado, evento);
    if (!para) throw new TransicaoInvalida(`Pedido ${pedidoId}`, atual.estado, evento);
    const feito = await tx
      .update(pedido)
      .set({ ...alteracoes, estado: para })
      .where(and(eq(pedido.id, pedidoId), eq(pedido.estado, atual.estado)))
      .returning({ id: pedido.id });
    if (!feito.length) throw new TransicaoConcorrente(`Pedido ${pedidoId}`);
    await registrar(tx, {
      agente: motivo.agente,
      acao: motivo.acao ?? `Pedido ${pedidoId}: ${atual.estado} → ${para}.`,
      motivo: motivo.motivo,
      pedidoId,
      deEstado: atual.estado,
      paraEstado: para,
      dados: motivo.dados,
      fornecedorIds: motivo.fornecedorIds,
    });
    return { pedidoId, de: atual.estado, para, evento };
  });
  await disparar(ganchosPedido.get(mudanca.para) ?? [], mudanca);
  return mudanca;
}

export async function avancarItem(
  itemPedidoId: number,
  evento: EventoItem,
  motivo: Motivo,
  alteracoes: Partial<Omit<typeof itemPedido.$inferInsert, "id" | "pedidoId" | "estado">> = {},
): Promise<MudancaItem> {
  const mudanca = await db.transaction(async (tx) => {
    const [atual] = await tx
      .select({ estado: itemPedido.estado, pedidoId: itemPedido.pedidoId })
      .from(itemPedido)
      .where(eq(itemPedido.id, itemPedidoId));
    if (!atual) throw new Error(`Item ${itemPedidoId} não existe.`);
    const para = proximoEstadoItem(atual.estado, evento);
    if (!para) throw new TransicaoInvalida(`Item ${itemPedidoId}`, atual.estado, evento);
    const feito = await tx
      .update(itemPedido)
      .set({ ...alteracoes, estado: para })
      .where(and(eq(itemPedido.id, itemPedidoId), eq(itemPedido.estado, atual.estado)))
      .returning({ id: itemPedido.id });
    if (!feito.length) throw new TransicaoConcorrente(`Item ${itemPedidoId}`);
    await registrar(tx, {
      agente: motivo.agente,
      acao: motivo.acao ?? `Item ${itemPedidoId}: ${atual.estado} → ${para}.`,
      motivo: motivo.motivo,
      pedidoId: atual.pedidoId,
      itemPedidoId,
      deEstado: atual.estado,
      paraEstado: para,
      dados: motivo.dados,
      fornecedorIds: motivo.fornecedorIds,
    });
    return { pedidoId: atual.pedidoId, itemPedidoId, de: atual.estado, para, evento };
  });
  await disparar(ganchosItem.get(mudanca.para) ?? [], mudanca);
  await aoMudarItem(mudanca);
  return mudanca;
}

// ---------- Fila: cota um item por vez ----------

/**
 * O próximo item da fila começa quando o atual termina a cotação (mapa pronto)
 * ou chega a um estado final. Assim o comprador decide um item enquanto o
 * seguinte já está sendo cotado.
 */
const LIBERA_FILA: readonly EstadoItem[] = ["aguardando_decisao", "aguardando_recompra", ...FINAIS_ITEM];
const OCUPA_FILA: readonly EstadoItem[] = ["buscando", "cotando", "comparando"];

async function iniciarProximoDaFila(pedidoId: number) {
  const ocupados = await db
    .select({ id: itemPedido.id })
    .from(itemPedido)
    .where(and(eq(itemPedido.pedidoId, pedidoId), inArray(itemPedido.estado, [...OCUPA_FILA])))
    .limit(1);
  if (ocupados.length) return;
  const [proximo] = await db
    .select({ id: itemPedido.id })
    .from(itemPedido)
    .where(and(eq(itemPedido.pedidoId, pedidoId), eq(itemPedido.estado, "na_fila")))
    .orderBy(asc(itemPedido.ordem))
    .limit(1);
  if (!proximo) return;
  try {
    await avancarItem(proximo.id, "iniciar_busca", {
      agente: "Acompanhamento do pedido",
      motivo: "É a vez deste item na fila.",
    });
  } catch (erro) {
    if (!(erro instanceof TransicaoConcorrente)) throw erro;
  }
}

async function aoMudarItem(m: MudancaItem) {
  if (!LIBERA_FILA.includes(m.para)) return;
  await iniciarProximoDaFila(m.pedidoId);
  if (!FINAIS_ITEM.includes(m.para)) return;
  const pendentes = await db
    .select({ id: itemPedido.id })
    .from(itemPedido)
    .where(and(eq(itemPedido.pedidoId, m.pedidoId), notInArray(itemPedido.estado, [...FINAIS_ITEM])))
    .limit(1);
  if (pendentes.length) return;
  try {
    await avancarPedido(m.pedidoId, "itens_finalizados", {
      agente: "Acompanhamento do pedido",
      motivo: "Todos os itens do pedido terminaram.",
    });
  } catch (erro) {
    if (!(erro instanceof TransicaoInvalida || erro instanceof TransicaoConcorrente)) throw erro;
  }
}

aoEntrarPedido("em_andamento", (m) => iniciarProximoDaFila(m.pedidoId));

aoEntrarPedido("cancelado", async (m) => {
  const abertos = await db
    .select({ id: itemPedido.id })
    .from(itemPedido)
    .where(and(eq(itemPedido.pedidoId, m.pedidoId), notInArray(itemPedido.estado, [...FINAIS_ITEM])));
  for (const { id } of abertos) {
    await avancarItem(id, "cancelar", { agente: "Acompanhamento do pedido", motivo: "O pedido foi cancelado." }).catch(
      (erro) => {
        if (!(erro instanceof TransicaoConcorrente || erro instanceof TransicaoInvalida)) throw erro;
      },
    );
  }
});

// ---------- Criação ----------

export type NovoItem = {
  descricao: string;
  quantidade: number | string;
  unidade: string;
  itemChave?: string;
  especificacao?: Record<string, string>;
  aceitaSimilar?: boolean;
};

export async function abrirPedido(dados: {
  compradorId: string;
  canalOrigem: typeof pedido.$inferInsert.canalOrigem;
  textoOriginal: string;
}) {
  return db.transaction(async (tx) => {
    const [novo] = await tx.insert(pedido).values(dados).returning();
    await registrar(tx, {
      agente: "Acompanhamento do pedido",
      acao: `Abriu o pedido ${novo!.id}.`,
      motivo: "Chegou uma mensagem do comprador.",
      pedidoId: novo!.id,
      paraEstado: "interpretando",
    });
    return novo!;
  });
}

/** R2 grava aqui o que entendeu. Só vale antes da confirmação; substitui os itens anteriores. */
export async function definirItens(exec: Executor, pedidoId: number, itens: NovoItem[]) {
  const [p] = await exec.select({ estado: pedido.estado }).from(pedido).where(eq(pedido.id, pedidoId));
  if (!p) throw new Error(`Pedido ${pedidoId} não existe.`);
  if (p.estado !== "interpretando" && p.estado !== "aguardando_confirmacao") {
    throw new Error(`Pedido ${pedidoId} já foi confirmado; os itens não mudam mais.`);
  }
  await exec.delete(itemPedido).where(eq(itemPedido.pedidoId, pedidoId));
  if (!itens.length) return [];
  return exec
    .insert(itemPedido)
    .values(
      itens.map((it, i) => ({
        pedidoId,
        ordem: i + 1,
        descricao: it.descricao,
        quantidade: String(it.quantidade),
        unidade: it.unidade,
        itemChave: it.itemChave,
        especificacao: it.especificacao ?? {},
        aceitaSimilar: it.aceitaSimilar ?? false,
      })),
    )
    .returning();
}

// ---------- Varredor: prazos que vencem sozinhos (Q4) ----------

export async function varrerPrazos(agora = new Date()) {
  const vencidos = await db
    .select({ id: itemPedido.id })
    .from(itemPedido)
    .where(and(eq(itemPedido.estado, "cotando"), lte(itemPedido.prazoRespostasEm, agora)));
  for (const { id } of vencidos) {
    try {
      await avancarItem(id, "encerrar_cotacao", {
        agente: "Acompanhamento do pedido",
        motivo: "O prazo de respostas venceu. A comparação segue com quem respondeu.",
      });
    } catch (erro) {
      if (!(erro instanceof TransicaoConcorrente || erro instanceof TransicaoInvalida)) throw erro;
    }
  }
  return vencidos.length;
}

const tarefasDoVarredor: ((agora: Date) => Promise<unknown>)[] = [];
/** Outras tarefas periódicas (ex.: lembrete do Cotador) rodam junto do varredor. */
export function aoVarrer(fn: (agora: Date) => Promise<unknown>) {
  tarefasDoVarredor.push(fn);
}

export function iniciarVarredor(intervaloMs = 5_000): () => void {
  let rodando = false;
  const t = setInterval(async () => {
    if (rodando) return;
    rodando = true;
    try {
      const agora = new Date();
      for (const t of tarefasDoVarredor) await t(agora).catch((e) => console.error("[varredor]", e));
      await varrerPrazos(agora);
    } catch (erro) {
      console.error("[varredor]", erro);
    } finally {
      rodando = false;
    }
  }, intervaloMs);
  return () => clearInterval(t);
}
