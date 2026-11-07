// Convite do fornecedor por e-mail com link pessoal (E1) e a trava do e-mail. Usa DATABASE_URL_TESTE.
// Nenhum e-mail sai de verdade: o transporte é falso.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

const mod = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
      ...(await import("../src/fluxo/index.ts")),
      ...(await import("../src/fluxo/fornecedor.ts")),
      ...(await import("../src/canais/email.ts")),
    }
  : null;

type Email = { from: string; to: string; subject: string; text: string };
const emails: Email[] = [];
const transporte = {
  async sendMail(m: Email) {
    emails.push(m);
    return { messageId: `falso-${emails.length}` };
  },
};

before(async () => {
  if (!mod) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(mod.db, { migrationsFolder: "drizzle" });
  mod.registrarCanal(mod.adaptadorEmail({ transporte, usuarioBot: "bot_teste" }));
});
after(async () => {
  if (mod) await mod.conexao.end();
});

const emailNovo = () => `teste-${crypto.randomUUID()}@exemplo.com`;

test("e-mail de fornecedor que não veio do convite manual nem está na lista é bloqueado", { skip: pular }, async () => {
  const m = mod!;
  const email = emailNovo();
  const [f] = await m.db.insert(m.schema.fornecedor).values({ nome: "Loja da busca", origem: "real", fonte: "https://loja.exemplo", email }).returning();
  const [c] = await m.db.insert(m.schema.contato).values({ canal: "email", endereco: email, papel: "fornecedor", fornecedorId: f!.id }).returning();
  const antes = emails.length;

  const r = await m.enviar(c!.id, "Pedido de cotação", { tipo: "cotacao" });
  assert.equal(r.situacao, "falhou");
  assert.match(r.erro!, /bloqueado/);
  assert.equal(emails.length, antes, "não pode chamar o transporte");

  // Convite manual não libera endereço de fornecedor achado na busca.
  await assert.rejects(m.convidarPorEmail({ email, usuarioBot: "bot_teste" }), /achado na busca/);
  assert.equal(emails.length, antes);
});

test("EMAIL_PERMITIDOS libera o endereço", { skip: pular }, async () => {
  const m = mod!;
  const email = emailNovo();
  assert.equal(await m.emailLiberado(email), false);
  process.env.EMAIL_PERMITIDOS = `outro@exemplo.com, ${email.toUpperCase()}`;
  try {
    assert.equal(await m.emailLiberado(email), true);
  } finally {
    delete process.env.EMAIL_PERMITIDOS;
  }
});

test("convite manual: e-mail com link pessoal e conversa ligada sem perguntar o nome", { skip: pular }, async () => {
  const m = mod!;
  const { adaptador, enviadas } = m.canalEmMemoria("web");
  m.registrarCanal(adaptador);
  m.ligarFluxos();
  const email = emailNovo();

  const c = await m.convidarPorEmail({ email: `  ${email.toUpperCase()} `, nome: "Banca Avaliadora", usuarioBot: "bot_teste" });
  assert.equal(c.envio.situacao, "enviada");
  assert.match(c.codigo, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(c.link, `https://t.me/bot_teste?start=${c.codigo}`);
  const e = emails.at(-1)!;
  assert.equal(e.to, email);
  assert.match(e.subject, /Convite/);
  assert.ok(e.text.includes(c.link));

  const f = await m.db.query.fornecedor.findFirst({ where: (t, { eq }) => eq(t.id, c.fornecedorId) });
  assert.equal(f!.fonte, m.FONTE_CONVITE_MANUAL);
  assert.equal(f!.email, email);

  // Convidar de novo reaproveita o fornecedor e o código.
  const de_novo = await m.convidarPorEmail({ email, usuarioBot: "bot_teste" });
  assert.equal(de_novo.fornecedorId, c.fornecedorId);
  assert.equal(de_novo.codigo, c.codigo);

  // A pessoa abre o link: /start <código>.
  const endereco = `forn-${crypto.randomUUID()}`;
  await m.receber({ canal: "web", endereco, papel: "fornecedor", texto: `/start ${c.codigo}`, convite: c.codigo, idExterno: "1" });
  const textos = enviadas.filter((x) => x.endereco === endereco).map((x) => x.texto);
  assert.ok(textos.some((t) => /Banca Avaliadora/.test(t) && /ligada à sua empresa/.test(t)));
  assert.ok(!textos.some((t) => /nome da sua empresa/.test(t)));
  const ct = await m.db.query.contato.findFirst({ where: (t, { eq }) => eq(t.endereco, endereco) });
  assert.equal(ct!.fornecedorId, c.fornecedorId);

  // Código desconhecido cai no cadastro com pergunta do nome (reserva do QR).
  const outro = `forn-${crypto.randomUUID()}`;
  await m.receber({ canal: "web", endereco: outro, papel: "fornecedor", texto: "/start cadastro", convite: "cadastro", idExterno: "2" });
  assert.match(enviadas.at(-1)!.texto, /nome da sua empresa/);
});
