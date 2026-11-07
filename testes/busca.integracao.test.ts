// Teto de crédito do Serper e cache. Usa DATABASE_URL_TESTE; nunca chama a rede.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;

const mod = urlTeste ? { ...(await import("../src/nucleo/index.ts")), ...(await import("../src/agentes/busca/rede.ts")) } : null;

before(async () => {
  if (!mod) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(mod.db, { migrationsFolder: "drizzle" });
});
after(async () => {
  if (mod) await mod.conexao.end();
});

test("teto do Serper bloqueia antes de chamar e conta todas as rotas", { skip: pular }, async () => {
  const m = mod!;
  const feitas = await m.consultasPagasFeitas();
  process.env.SERPER_LIMITE = String(feitas + 1);
  const [falsa] = await m.db.insert(m.schema.cacheBusca).values({ provedor: "serper-search", consulta: `teste-${Date.now()}`, resposta: {}, pago: true }).returning();
  const { eq } = await import("drizzle-orm");
  after(() => m.db.delete(m.schema.cacheBusca).where(eq(m.schema.cacheBusca.id, falsa!.id)));
  assert.equal(await m.consultasPagasFeitas(), feitas + 1);
  let chamou = false;
  await assert.rejects(
    m.comCache("serper-shopping", `nova-${Date.now()}`, { pago: true }, async () => {
      chamou = true;
      return {};
    }),
    /Teto de/,
  );
  assert.equal(chamou, false);
});

test("consulta repetida vem do cache sem chamar de novo", { skip: pular }, async () => {
  const m = mod!;
  const consulta = `cache-${Date.now()}`;
  let chamadas = 0;
  const f = async () => ({ n: ++chamadas });
  const a = await m.comCache("vtex-catalogo", consulta, { pago: false }, f);
  const b = await m.comCache("vtex-catalogo", consulta, { pago: false }, f);
  assert.equal(a!.doCache, false);
  assert.equal(b!.doCache, true);
  assert.equal(chamadas, 1);
});

test("durante testes, nenhuma consulta paga sai", { skip: pular }, async () => {
  const m = mod!;
  process.env.SERPER_LIMITE = "100000";
  await assert.rejects(m.comCache("serper-search", `x-${Date.now()}`, { pago: true }, async () => ({})), /bloqueada durante testes/);
});
