// Cadastro do fornecedor pelo bot (R5). Usa DATABASE_URL_TESTE.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;

const mod = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
      ...(await import("../src/fluxo/index.ts")),
    }
  : null;

before(async () => {
  if (!mod) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(mod.db, { migrationsFolder: "drizzle" });
});
after(async () => {
  if (mod) await mod.conexao.end();
});

test("fornecedor entra pelo bot, informa o nome e fica cadastrado", { skip: pular }, async () => {
  const m = mod!;
  const { adaptador, enviadas } = m.canalEmMemoria("web");
  m.registrarCanal(adaptador);
  m.ligarFluxos();
  const endereco = `forn-${crypto.randomUUID()}`;

  await m.receber({ canal: "web", endereco, papel: "fornecedor", texto: "/start convite", idExterno: "1" });
  assert.match(enviadas.at(-1)!.texto, /nome da sua empresa/);

  await m.receber({ canal: "web", endereco, papel: "fornecedor", texto: "Depósito Real Teste", idExterno: "2" });
  assert.match(enviadas.at(-1)!.texto, /Cadastro feito, Depósito Real Teste/);

  const c = await m.db.query.contato.findFirst({ where: (t, { eq }) => eq(t.endereco, endereco) });
  const f = await m.db.query.fornecedor.findFirst({ where: (t, { eq }) => eq(t.id, c!.fornecedorId!) });
  assert.equal(f!.origem, "real");
  assert.equal(f!.nome, "Depósito Real Teste");

  await m.receber({ canal: "web", endereco, papel: "fornecedor", texto: "oi, alguma cotação?", idExterno: "3" });
  assert.match(enviadas.at(-1)!.texto, /Não tenho cotação aberta/);
});
