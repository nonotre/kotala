// R8 pela cadência (U3): o preço muito abaixo da referência fica retido no mapa e o
// fornecedor é perguntado se é isso mesmo, uma vez por proposta. A pergunta passa por
// pedirAoFornecedor: com outra pergunta pendente, espera a resposta e sai depois
// (despacharPerguntas ou o varredor). A marca é `oferta.confirmacao_pedida_em`, gravada
// antes do envio (reserva) e desfeita se o envio falhar.
//
// Quem monta o mapa (Comparador) chama pedirConfirmacoesDePreco(item) no lugar de mandar
// a pergunta direto.

import { and, eq, isNull } from "drizzle-orm";
import { formatarBRL, ultimoMapa } from "../comparador/index.ts";
import type { Linha } from "../comparador/calculo.ts";
import { db } from "../../nucleo/db/cliente.ts";
import { itemPedido, oferta } from "../../nucleo/db/schema.ts";
import { contatoAtivoDoFornecedor } from "../../nucleo/mensagens/index.ts";
import { registrar } from "../../nucleo/registro.ts";
import { quantidade } from "../../texto.ts";
import { pedirAoFornecedor, type Pergunta } from "./cadencia.ts";

type Item = Pick<typeof itemPedido.$inferSelect, "id" | "pedidoId" | "quantidade" | "unidade" | "descricao">;

/** Texto da pergunta (o mesmo que o Comparador mandava). */
export function textoConfirmacaoDePreco(item: Item, l: Pick<Linha, "precoUnitarioEfetivo" | "produto">): string {
  const unit = l.precoUnitarioEfetivo !== null ? `${formatarBRL(l.precoUnitarioEfetivo)} por ${item.unidade}` : formatarBRL(l.produto ?? 0);
  return (
    `Sobre a cotação ${item.id} (${quantidade(item.quantidade, item.unidade)} de ${item.descricao}): ` +
    `o seu preço de ${unit} ficou bem abaixo das outras propostas. Pode confirmar que é esse valor mesmo, para o item pedido e entregue no local? ` +
    "Responda SIM para confirmar."
  );
}

/** Linhas retidas do último mapa do item, ainda não perguntadas, e o contato de cada fornecedor. */
async function retidasSemPergunta(itemPedidoId: number, fornecedorId?: string) {
  const [item] = await db.select().from(itemPedido).where(eq(itemPedido.id, itemPedidoId));
  if (!item || item.estado !== "aguardando_decisao") return { item: null, linhas: [] as Linha[] };
  const mapa = await ultimoMapa(itemPedidoId);
  const linhas: Linha[] = [];
  for (const c of mapa?.comparacao.cortadas ?? []) {
    if (c.portoes.naoRetida || c.oferta.online) continue;
    if (fornecedorId && c.oferta.fornecedorId !== fornecedorId) continue;
    const [o] = await db.select({ pedidaEm: oferta.confirmacaoPedidaEm, confirmado: oferta.precoConfirmado }).from(oferta).where(eq(oferta.id, c.oferta.id));
    if (!o || o.pedidaEm || o.confirmado) continue;
    linhas.push(c);
  }
  return { item, linhas };
}

function pergunta(item: Item, l: Linha): Pergunta {
  return {
    tipo: "confirmar_preco",
    itemPedidoId: item.id,
    texto: textoConfirmacaoDePreco(item, l),
    opcoes: { pedidoId: item.pedidoId, itemPedidoId: item.id, tipo: "confirmar_preco" },
    // Reserva: o varredor, a fila e o Comparador não perguntam duas vezes.
    reservar: async () =>
      (
        await db
          .update(oferta)
          .set({ confirmacaoPedidaEm: new Date() })
          .where(and(eq(oferta.id, l.oferta.id), isNull(oferta.confirmacaoPedidaEm), eq(oferta.precoConfirmado, false)))
          .returning({ id: oferta.id })
      ).length > 0,
    marcar: async (r) => {
      if (r.situacao !== "enviada") {
        await db.update(oferta).set({ confirmacaoPedidaEm: null }).where(eq(oferta.id, l.oferta.id));
        return;
      }
      await registrar(db, {
        agente: "Comparador",
        acao: `Pediu a ${l.oferta.fornecedorNome} para confirmar o preço.`,
        motivo: `Preço ${Math.round(l.abaixoDaReferencia * 100)}% abaixo da referência: fica retido até o fornecedor confirmar.`,
        pedidoId: item.pedidoId,
        itemPedidoId: item.id,
        fornecedorIds: [l.oferta.fornecedorId],
      });
    },
  };
}

/**
 * Pergunta a cada fornecedor com preço retido no último mapa se o preço está certo, pela
 * cadência. Devolve quantas saíram agora e quantas ficaram na fila.
 */
export async function pedirConfirmacoesDePreco(itemPedidoId: number): Promise<{ enviadas: number; naFila: number }> {
  const { item, linhas } = await retidasSemPergunta(itemPedidoId);
  let enviadas = 0;
  let naFila = 0;
  if (!item) return { enviadas, naFila };
  for (const l of linhas) {
    const ct = await contatoAtivoDoFornecedor(l.oferta.fornecedorId);
    if (!ct) continue;
    const r = await pedirAoFornecedor(ct.id, pergunta(item, l));
    if (r.enviada) enviadas++;
    else if (r.pendente) naFila++;
  }
  return { enviadas, naFila };
}

/** Itens esperando decisão com alguma proposta ainda não perguntada (candidatos da fila). */
async function itensComRetidas(): Promise<number[]> {
  const linhas = await db
    .selectDistinct({ id: itemPedido.id })
    .from(itemPedido)
    .innerJoin(oferta, eq(oferta.itemPedidoId, itemPedido.id))
    .where(and(eq(itemPedido.estado, "aguardando_decisao"), isNull(oferta.confirmacaoPedidaEm), eq(oferta.precoConfirmado, false)));
  return linhas.map((l) => l.id);
}

/** Fonte da cadência: confirmações que ficaram na fila, deste fornecedor. */
export async function perguntasDeConfirmacao(_contatoId: string, fornecedorId: string): Promise<Pergunta[]> {
  const out: Pergunta[] = [];
  for (const id of await itensComRetidas()) {
    const { item, linhas } = await retidasSemPergunta(id, fornecedorId);
    if (item) for (const l of linhas) out.push(pergunta(item, l));
  }
  return out;
}

/** Contatos com confirmação na fila (o varredor libera a fila deles). */
export async function contatosComConfirmacao(): Promise<string[]> {
  const out = new Set<string>();
  for (const id of await itensComRetidas()) {
    for (const l of (await retidasSemPergunta(id)).linhas) {
      const ct = await contatoAtivoDoFornecedor(l.oferta.fornecedorId);
      if (ct) out.add(ct.id);
    }
  }
  return [...out];
}
