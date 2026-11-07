// Cadastro automático de item novo no catálogo. Usa DATABASE_URL_TESTE.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;

const m = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/orquestrador/index.ts")),
      ...(await import("../src/agentes/interpretador/catalogo.ts")),
    }
  : null;

before(async () => {
  if (!m) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(m.db, { migrationsFolder: "drizzle" });
});
after(async () => {
  if (m) await m.conexao.end();
});

test("item fora da base ganha código na confirmação e é reaproveitado no próximo pedido", { skip: pular }, async () => {
  const { eq } = await import("drizzle-orm");
  const descricao = `Telha de fibrocimento ondulada 6 mm ${Date.now()}`;
  const [c] = await m!.db.insert(m!.schema.contato).values({ canal: "web", endereco: `cat-${crypto.randomUUID()}`, papel: "comprador" }).returning();
  const novoPedido = async () => {
    const p = await m!.abrirPedido({ compradorId: c!.id, canalOrigem: "web", textoOriginal: "telhas" });
    const [it] = await m!.definirItens(m!.db, p.id, [{ descricao, quantidade: 30, unidade: "unidade" }]);
    return { p, it: it! };
  };
  const a = await novoPedido();
  const criados = await m!.cadastrarItensNovos(a.p.id);
  assert.equal(criados.length, 1);
  assert.match(criados[0]!, /^ITM-1\d{3,}$/);
  const [itemA] = await m!.db.select().from(m!.schema.itemPedido).where(eq(m!.schema.itemPedido.id, a.it.id));
  assert.equal(itemA!.itemChave, criados[0]);

  const b = await novoPedido();
  assert.deepEqual(await m!.cadastrarItensNovos(b.p.id), [], "não cadastra de novo");
  const [itemB] = await m!.db.select().from(m!.schema.itemPedido).where(eq(m!.schema.itemPedido.id, b.it.id));
  assert.equal(itemB!.itemChave, criados[0], "mesmo código do primeiro pedido");
});
