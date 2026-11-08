// Avisos: o que espera o comprador agora. Tirado do estado real dos pedidos e itens,
// sem tabela própria. O sino mostra a contagem; /avisos mostra a lista.

import { and, desc, eq, gt, inArray, ne, or } from "drizzle-orm";
import { db } from "../../src/nucleo/db/cliente.ts";
import { itemPedido, pedido } from "../../src/nucleo/db/schema.ts";

export type TipoAviso = "confirmar_pedido" | "decidir" | "recompra" | "sem_proposta";

export type Aviso = {
  chave: string;
  tipo: TipoAviso;
  pedidoId: number;
  itemId: number | null;
  titulo: string;
  texto: string;
  href: string;
  urgencia: string;
  em: Date;
};

/** Sem proposta válida conta como aviso só por este tempo; depois, fica no histórico do pedido. */
const SEM_PROPOSTA_DIAS = 7;

export async function listarAvisos(): Promise<Aviso[]> {
  const pedidos = await db.select().from(pedido).where(eq(pedido.estado, "aguardando_confirmacao")).orderBy(desc(pedido.atualizadoEm));
  const desde = new Date(Date.now() - SEM_PROPOSTA_DIAS * 86_400_000);
  const itens = await db
    .select({ item: itemPedido, urgencia: pedido.urgencia })
    .from(itemPedido)
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .where(
      and(
        ne(pedido.estado, "cancelado"),
        // A janela de 7 dias vale só para "sem proposta": decisão e recompra esperam o comprador o tempo que for.
        or(inArray(itemPedido.estado, ["aguardando_decisao", "aguardando_recompra"]), and(eq(itemPedido.estado, "sem_proposta"), gt(itemPedido.atualizadoEm, desde))),
      ),
    )
    .orderBy(desc(itemPedido.atualizadoEm));

  const lista: Aviso[] = pedidos.map((p) => ({
    chave: `pedido-${p.id}`,
    tipo: "confirmar_pedido",
    pedidoId: p.id,
    itemId: null,
    titulo: `Confirme a cotação ${p.id}`,
    texto: "O assistente leu a cotação e espera você conferir antes de pedir propostas.",
    href: `/pedidos/${p.id}/solicitado`,
    urgencia: p.urgencia,
    em: p.atualizadoEm,
  }));
  for (const { item, urgencia } of itens) {
    const base = { pedidoId: item.pedidoId, itemId: item.id, urgencia, em: item.atualizadoEm };
    if (item.estado === "aguardando_decisao")
      lista.push({ ...base, chave: `decidir-${item.id}`, tipo: "decidir", titulo: `Decida a compra de ${item.descricao}`, texto: "O mapa de cotações está pronto. Nada é comprado sem a sua aprovação.", href: `/pedidos/${item.pedidoId}/decisao` });
    else if (item.estado === "aguardando_recompra")
      lista.push({ ...base, chave: `recompra-${item.id}`, tipo: "recompra", titulo: `Repetir a compra de ${item.descricao}?`, texto: "Você comprou este item há pouco tempo. Repita ou cote de novo.", href: `/pedidos/${item.pedidoId}/comparacao#item-${item.id}` });
    else
      lista.push({ ...base, chave: `sem-${item.id}`, tipo: "sem_proposta", titulo: `Sem proposta válida para ${item.descricao}`, texto: "Nenhum fornecedor mandou proposta que passasse nas regras.", href: `/pedidos/${item.pedidoId}/cotacoes#item-${item.id}` });
  }
  const peso = (u: string) => (u === "parada" ? 0 : u === "urgente" ? 1 : 2);
  return lista.sort((a, b) => peso(a.urgencia) - peso(b.urgencia) || b.em.getTime() - a.em.getTime());
}

/** Só o que pede ação: sem proposta é informativo e não conta no sino. */
export async function contarAvisos(): Promise<number> {
  return (await listarAvisos()).filter((a) => a.tipo !== "sem_proposta").length;
}
