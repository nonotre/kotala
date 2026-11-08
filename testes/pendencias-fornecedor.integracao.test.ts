// Pendências do lado do fornecedor (junção da rodada 2), com banco: quem compra no pedido
// de compra. Usa DATABASE_URL_TESTE.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;
else process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta sem o banco de teste

const m = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
      ...(await import("../src/fluxo/decisao.ts")),
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

test("quem compra: responsável do card, senão o usuário do contato; sem conta, nada", { skip: pular }, async () => {
  const { db, schema } = m!;
  const sufixo = crypto.randomUUID().slice(0, 8);
  const [ana] = await db.insert(schema.usuario).values({ login: `ana-${sufixo}`, nome: "Ana Souza" }).returning();
  const [bia] = await db.insert(schema.usuario).values({ login: `bia-${sufixo}`, nome: "Bia Lima" }).returning();
  const [ligado] = await db.insert(schema.contato).values({ canal: "telegram", endereco: `t-${sufixo}`, papel: "comprador", nome: "anazinha_tg", usuarioId: ana!.id }).returning();
  const [solto] = await db.insert(schema.contato).values({ canal: "telegram", endereco: `s-${sufixo}`, papel: "comprador", nome: "Fulano do Telegram" }).returning();

  assert.equal(await m!.nomeDoComprador({ responsavelId: null, compradorId: ligado!.id }), "Ana Souza");
  assert.equal(await m!.nomeDoComprador({ responsavelId: bia!.id, compradorId: ligado!.id }), "Bia Lima");
  // Contato sem conta: não usa o nome do Telegram.
  assert.equal(await m!.nomeDoComprador({ responsavelId: null, compradorId: solto!.id }), null);
});
