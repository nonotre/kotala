// Frente 2: contas, login simples e ligação de contatos a um usuário. Usa DATABASE_URL_TESTE.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;

const { db, conexao, schema, mensagens: m } = urlTeste ? await import("../src/nucleo/index.ts") : ({} as typeof import("../src/nucleo/index.ts"));
const contas = urlTeste ? await import("../src/contas.ts") : ({} as typeof import("../src/contas.ts"));
const { and, eq } = await import("drizzle-orm");

before(async () => {
  if (pular) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  if (!pular) await conexao.end();
});

const loginNovo = () => `t${crypto.randomUUID().slice(0, 8)}`;

test("hash de senha: confere a certa e recusa a errada", () => {
  const h = contas.hashSenha("abacaxi");
  assert.equal(contas.conferirSenha("abacaxi", h), true);
  assert.equal(contas.conferirSenha("outra", h), false);
  assert.notEqual(contas.hashSenha("abacaxi"), h, "cada hash tem o seu sal");
});

test("criar conta: entra, ganha o contato web e não repete o usuário", { skip: pular }, async () => {
  const login = loginNovo();
  const r = await contas.criarConta({ login: ` ${login.toUpperCase()} `, nome: "Pessoa Teste", senha: "1234" });
  assert.ok(r.ok);
  assert.equal(r.sessao.login, login, "login fica minúsculo e sem espaço");

  const [web] = await db.select().from(schema.contato).where(and(eq(schema.contato.canal, "web"), eq(schema.contato.endereco, r.sessao.id)));
  assert.equal(web?.usuarioId, r.sessao.id);

  const repetida = await contas.criarConta({ login, nome: "Outra", senha: "1234" });
  assert.equal(repetida.ok, false);

  assert.equal((await contas.entrar({ login, senha: "errada" })).ok, false);
  const certa = await contas.entrar({ login, senha: "1234" });
  assert.ok(certa.ok);
  assert.equal(certa.sessao.id, r.sessao.id);
  assert.equal((await contas.conferirSessao(r.sessao.id))?.nome, "Pessoa Teste");
});

test("ligar contatos: conta sem senha pega a senha da primeira entrada, e o contato fica com ela", { skip: pular }, async () => {
  const rec = await m.receber({ canal: "simulado", endereco: `c-${crypto.randomUUID()}`, texto: "oi" });
  assert.equal(rec.tipo, "recebida");
  const contato = rec.tipo === "recebida" ? rec.contato : assert.fail();

  const login = loginNovo();
  const lig = await contas.ligarContatos({ login, nome: "Ligada", contatoIds: [contato.id] });
  assert.equal(lig.ligados, 1);
  // Rodar de novo não duplica.
  const deNovo = await contas.ligarContatos({ login, nome: "Ligada", contatoIds: [contato.id] });
  assert.equal(deNovo.usuarioId, lig.usuarioId);

  const primeira = await contas.entrar({ login, senha: "minha" });
  assert.ok(primeira.ok);
  assert.equal((await contas.entrar({ login, senha: "outra" })).ok, false, "a primeira senha ficou");

  const canais = await contas.contatosDoUsuario(lig.usuarioId);
  assert.deepEqual(canais.map((c) => c.canal).sort(), ["simulado", "web"]);
});
