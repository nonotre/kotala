// Regra da área de compras: item pedido que não está na base é cadastrado pelo
// agente. Na confirmação do pedido, cada item sem correspondência ganha código
// próprio (ITM-1001 em diante) no catálogo; nas próximas vezes, casa com ele.

import { asc, eq } from "drizzle-orm";
import { db } from "../../nucleo/db/cliente.ts";
import { itemCatalogo, itemPedido } from "../../nucleo/db/schema.ts";
import { registrar } from "../../nucleo/registro.ts";
import { categoriaProvavel } from "../../dominio/categorias.ts";
import { casarComBase, definirCadastrados, itemDaBase } from "./base-itens.ts";

/** Categoria que o agente dá ao item que ele mesmo cadastrou, quando não deduz nenhuma. */
export const SEM_CATEGORIA = "Cadastrado pelo agente";

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
      categoria: l.categoria ?? SEM_CATEGORIA,
    })),
  );
  return linhas.length;
}

/**
 * Cadastra os itens do pedido que não casaram com a base e grava a categoria de cada item do pedido
 * (item_pedido.categoria), que decide a quem a cotação vai. Devolve os códigos criados.
 */
export async function cadastrarItensNovos(pedidoId: number): Promise<string[]> {
  const itens = await db.select().from(itemPedido).where(eq(itemPedido.pedidoId, pedidoId)).orderBy(asc(itemPedido.ordem));
  const criados: string[] = [];
  for (const it of itens) {
    const deduzida = categoriaProvavel(it.descricao);
    if (it.itemChave?.startsWith("ITM-")) {
      if (!it.categoria) await db.update(itemPedido).set({ categoria: categoriaDeCodigo(it.itemChave) ?? deduzida }).where(eq(itemPedido.id, it.id));
      continue;
    }
    const c = casarComBase(it.descricao, it.especificacao);
    if (c.tipo === "unico") {
      // Casou com um item já cadastrado (em outro pedido): ganha o código e a categoria dele.
      const categoria = c.item.categoria !== SEM_CATEGORIA ? c.item.categoria : deduzida;
      await db.update(itemPedido).set({ itemChave: c.item.id, categoria: it.categoria ?? categoria }).where(eq(itemPedido.id, it.id));
      continue;
    }
    if (c.tipo === "varios") {
      // Ambíguo e confirmado assim: não vira item novo, mas as opções costumam ser da mesma categoria.
      if (!it.categoria) await db.update(itemPedido).set({ categoria: c.opcoes[0]!.categoria !== SEM_CATEGORIA ? c.opcoes[0]!.categoria : deduzida }).where(eq(itemPedido.id, it.id));
      continue;
    }
    const codigo = await db.transaction(async (tx) => {
      const todos = await tx.select({ codigo: itemCatalogo.codigo }).from(itemCatalogo);
      const maior = todos.reduce((m, x) => Math.max(m, Number(x.codigo.replace("ITM-", "")) || 0), PRIMEIRO_CODIGO - 1);
      const novo = `ITM-${maior + 1}`;
      await tx.insert(itemCatalogo).values({ codigo: novo, descricao: it.descricao, unidade: it.unidade, especificacao: it.especificacao, categoria: deduzida, pedidoId });
      await tx.update(itemPedido).set({ itemChave: novo, categoria: it.categoria ?? deduzida }).where(eq(itemPedido.id, it.id));
      return novo;
    });
    criados.push(codigo);
    await registrar(db, {
      agente: "Interpretador",
      acao: `Cadastrou ${it.descricao} como ${codigo}.`,
      motivo: `Item pedido que não estava na base de itens. Categoria: ${deduzida ?? "nenhuma deduzida (a cotação vai a todos)"}.`,
      pedidoId,
      itemPedidoId: it.id,
    });
  }
  if (criados.length) await carregarCatalogo();
  return criados;
}

function categoriaDeCodigo(codigo: string): string | null {
  const c = itemDaBase(codigo)?.categoria;
  return c && c !== SEM_CATEGORIA ? c : null;
}
