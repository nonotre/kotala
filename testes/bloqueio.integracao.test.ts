// Lista de bloqueio e homologação. Usa DATABASE_URL_TESTE.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;

const m = urlTeste
  ? { ...(await import("../src/nucleo/index.ts")), ...(await import("../src/agentes/busca/index.ts")), ...(await import("../src/agentes/fornecedores/index.ts")) }
  : null;

before(async () => {
  if (!m) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(m.db, { migrationsFolder: "drizzle" });
});
after(async () => {
  if (m) await m.conexao.end();
});

test("fornecedor bloqueado sai da busca com o motivo e volta ao desbloquear", { skip: pular }, async () => {
  const { eq } = await import("drizzle-orm");
  const [f] = await m!.db.insert(m!.schema.fornecedor).values({ nome: `Real Teste ${Date.now()}`, origem: "real" }).returning();
  await m!.db.insert(m!.schema.contato).values({ canal: "web", endereco: `forn-${crypto.randomUUID()}`, papel: "fornecedor", fornecedorId: f!.id });
  const item = { descricao: "Cimento Portland CP II", itemChave: null };
  const achar = async () => (await m!.candidatos(item)).find((c) => c.fornecedorId === f!.id);

  assert.equal((await achar())?.motivoCorte, undefined);
  assert.equal((await m!.alterarFornecedor(f!.id, "bloquear", "")).ok, false, "bloquear exige motivo");
  assert.ok((await m!.alterarFornecedor(f!.id, "bloquear", "Atrasou e não avisou")).ok);
  assert.equal((await achar())?.motivoCorte, "Bloqueado pela empresa: Atrasou e não avisou");
  await m!.alterarFornecedor(f!.id, "desbloquear", "");
  assert.equal((await achar())?.motivoCorte, undefined);

  await m!.alterarFornecedor(f!.id, "homologar", "");
  const [depois] = await m!.db.select().from(m!.schema.fornecedor).where(eq(m!.schema.fornecedor.id, f!.id));
  assert.equal(depois!.homologado, true);
});
