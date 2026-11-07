// Regra da área de compras: item pedido que não está na base é cadastrado pelo
// agente. Na confirmação do pedido, cada item sem correspondência ganha código
// próprio (ITM-1001 em diante) no catálogo; nas próximas vezes, casa com ele.

import { asc, eq } from "drizzle-orm";
import { db } from "../../nucleo/db/cliente.ts";
import { itemCatalogo, itemPedido } from "../../nucleo/db/schema.ts";
import { registrar } from "../../nucleo/registro.ts";
import { casarComBase, definirCadastrados } from "./base-itens.ts";

const PRIMEIRO_CODIGO = 1001;

/** Carrega o catálogo do banco para a memória (no início do processo e depois de cada cadastro). */
export async function carregarCatalogo() {
  const linhas = await db.select().from(itemCatalogo).orderBy(asc(itemCatalogo.id));
  definirCadastrados(
    linhas.map((l) => ({
      id: l.codigo,
      descricao: l.descricao,
      especificacao_tecnica: l.especificacao,
      unidade_compra: l.unidade,
      categoria: l.categoria ?? "Cadastrado pelo agente",
    })),
  );
  return linhas.length;
}

/** Cadastra os itens do pedido que não casaram com a base. Devolve os códigos criados. */
export async function cadastrarItensNovos(pedidoId: number): Promise<string[]> {
  const itens = await db.select().from(itemPedido).where(eq(itemPedido.pedidoId, pedidoId)).orderBy(asc(itemPedido.ordem));
  const criados: string[] = [];
  for (const it of itens) {
    if (it.itemChave?.startsWith("ITM-")) continue;
    const c = casarComBase(it.descricao, it.especificacao);
    if (c.tipo === "unico") {
      // Casou com um item já cadastrado (em outro pedido): só ganha o código.
      await db.update(itemPedido).set({ itemChave: c.item.id }).where(eq(itemPedido.id, it.id));
      continue;
    }
    if (c.tipo === "varios") continue; // ambíguo e confirmado assim: não vira item novo
    const codigo = await db.transaction(async (tx) => {
      const todos = await tx.select({ codigo: itemCatalogo.codigo }).from(itemCatalogo);
      const maior = todos.reduce((m, x) => Math.max(m, Number(x.codigo.replace("ITM-", "")) || 0), PRIMEIRO_CODIGO - 1);
      const novo = `ITM-${maior + 1}`;
      await tx.insert(itemCatalogo).values({ codigo: novo, descricao: it.descricao, unidade: it.unidade, especificacao: it.especificacao, pedidoId });
      await tx.update(itemPedido).set({ itemChave: novo }).where(eq(itemPedido.id, it.id));
      return novo;
    });
    criados.push(codigo);
    await registrar(db, {
      agente: "Interpretador",
      acao: `Cadastrou ${it.descricao} como ${codigo}.`,
      motivo: "Item pedido que não estava na base de itens.",
      pedidoId,
      itemPedidoId: it.id,
    });
  }
  if (criados.length) await carregarCatalogo();
  return criados;
}
