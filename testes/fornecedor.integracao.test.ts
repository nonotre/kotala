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

  // "oi" antes do convite não vira nome de empresa.
  await m.receber({ canal: "web", endereco, papel: "fornecedor", texto: "oi", idExterno: "0" });
  assert.match(enviadas.at(-1)!.texto, /nome da sua empresa/);
  assert.equal((await m.db.query.contato.findFirst({ where: (t, { eq }) => eq(t.endereco, endereco) }))!.fornecedorId, null);

  await m.receber({ canal: "web", endereco, papel: "fornecedor", texto: "/start convite", idExterno: "1" });
  assert.match(enviadas.at(-1)!.texto, /nome da sua empresa/);

  await m.receber({ canal: "web", endereco, papel: "fornecedor", texto: "Depósito Real Teste", idExterno: "2" });
  // Cadastro em etapas: o que vende (categorias da base, para entrar nas cotações certas) e CNPJ opcional.
  assert.match(enviadas.at(-1)!.texto, /O que vocês vendem/);
  assert.ok(enviadas.at(-1)!.opcoes.botoes?.some((b) => b.dado === "cad:pronto"));

  await m.receber({ canal: "web", endereco, papel: "fornecedor", texto: "vendemos cimento e areia", idExterno: "2b" });
  assert.match(enviadas.at(-1)!.texto, /CNPJ/);
  await m.receber({ canal: "web", endereco, papel: "fornecedor", texto: "pular", idExterno: "2c" });
  assert.match(enviadas.at(-1)!.texto, /Cadastro feito, Depósito Real Teste/);

  const c = await m.db.query.contato.findFirst({ where: (t, { eq }) => eq(t.endereco, endereco) });
  const f = await m.db.query.fornecedor.findFirst({ where: (t, { eq }) => eq(t.id, c!.fornecedorId!) });
  assert.equal(f!.origem, "real");
  assert.equal(f!.nome, "Depósito Real Teste");
  assert.deepEqual([...f!.categorias].sort(), ["Agregados", "Cimentícios"]);
  assert.equal(f!.cadastroEtapa, null);

  // Sem cotação aberta, a conversa não se encerra: a mensagem é guardada e o bot explica.
  await m.receber({ canal: "web", endereco, papel: "fornecedor", texto: "cimento CP II a R$ 38 o saco", idExterno: "3" });
  assert.match(enviadas.at(-1)!.texto, /guardei/);
  assert.match(enviadas.at(-1)!.texto, /não há pedido de cotação aberto/);
});
