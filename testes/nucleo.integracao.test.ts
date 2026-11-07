// Integração com Postgres. Usa DATABASE_URL_TESTE, que é apagado a cada rodada.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;

const { db, conexao, schema, orquestrador: o, mensagens: m } = urlTeste
  ? await import("../src/nucleo/index.ts")
  : ({} as typeof import("../src/nucleo/index.ts"));

before(async () => {
  if (pular) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(db, { migrationsFolder: "drizzle" });
  await conexao`truncate evento, uso_ia, mensagem, oferta, cotacao, historico_compra, item_pedido, pedido, contato, fornecedor restart identity cascade`;
});
after(async () => {
  if (!pular) await conexao.end();
});

async function comprador() {
  const r = await m.receber({ canal: "simulado", endereco: `c-${crypto.randomUUID()}`, texto: "oi" });
  assert.equal(r.tipo, "recebida");
  return r.tipo === "recebida" ? r.contato : assert.fail();
}

test("pedido com 2 itens: fila cota um por vez e fecha o pedido", { skip: pular }, async () => {
  const c = await comprador();
  const p = await o.abrirPedido({ compradorId: c.id, canalOrigem: "simulado", textoOriginal: "40 cp2 e 2 carrada de areia" });
  const [i1, i2] = await o.definirItens(db, p.id, [
    { descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco" },
    { descricao: "Areia média", quantidade: 2, unidade: "carrada" },
  ]);
  const motivo = { agente: "Interpretador" as const, motivo: "teste" };
  await o.avancarPedido(p.id, "interpretado", motivo);
  await o.avancarPedido(p.id, "comprador_confirmou", { agente: "Comprador", motivo: "confirmou" });

  const estado = async (id: number) =>
    (await db.query.itemPedido.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!.estado;
  assert.equal(await estado(i1!.id), "buscando");
  assert.equal(await estado(i2!.id), "na_fila");

  await o.avancarItem(i1!.id, "busca_concluida", motivo, { prazoRespostasEm: new Date(Date.now() - 1000) });
  assert.equal(await o.varrerPrazos(), 1);
  assert.equal(await estado(i1!.id), "comparando");
  await o.avancarItem(i1!.id, "mapa_pronto", { agente: "Comparador", motivo: "teste" });
  // Mapa do 1º pronto: o 2º começa enquanto o comprador decide.
  assert.equal(await estado(i2!.id), "buscando");

  await o.avancarItem(i2!.id, "busca_sem_resultado", { agente: "Busca", motivo: "teste" });
  await o.avancarItem(i1!.id, "aprovar", { agente: "Comprador", motivo: "teste" });
  await o.avancarItem(i1!.id, "pedido_enviado", motivo);
  await o.avancarItem(i1!.id, "fornecedor_confirmou", { agente: "Fornecedor", motivo: "teste" });

  const pf = await db.query.pedido.findFirst({ where: (t, { eq }) => eq(t.id, p.id) });
  assert.equal(pf!.estado, "concluido");
  const eventos = await db.query.evento.findMany({ where: (t, { eq }) => eq(t.pedidoId, p.id) });
  assert.ok(eventos.length >= 10);
});

test("transição inválida e concorrente", { skip: pular }, async () => {
  const c = await comprador();
  const p = await o.abrirPedido({ compradorId: c.id, canalOrigem: "simulado", textoOriginal: "x" });
  await assert.rejects(o.avancarPedido(p.id, "comprador_confirmou", { agente: "Comprador", motivo: "t" }), o.TransicaoInvalida);
  const r = await Promise.allSettled([
    o.avancarPedido(p.id, "interpretado", { agente: "Interpretador", motivo: "t" }),
    o.avancarPedido(p.id, "interpretado", { agente: "Interpretador", motivo: "t" }),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
});

test("mesmo id de mensagem em conversas diferentes não é repetida", { skip: pular }, async () => {
  const a = await m.receber({ canal: "simulado", endereco: `a-${crypto.randomUUID()}`, texto: "oi", idExterno: "42" });
  const b = await m.receber({ canal: "simulado", endereco: `b-${crypto.randomUUID()}`, texto: "oi", idExterno: "42" });
  assert.equal(a.tipo, "recebida");
  assert.equal(b.tipo, "recebida");
});

test("PARAR bloqueia o envio em todos os canais do fornecedor", { skip: pular }, async () => {
  const { adaptador, enviadas } = m.canalEmMemoria("simulado");
  m.registrarCanal(adaptador);
  const [f] = await db.insert(schema.fornecedor).values({ nome: "Depósito Exemplo", origem: "simulado" }).returning();
  const [tg, wa] = await db
    .insert(schema.contato)
    .values([
      { canal: "simulado", endereco: `f-${crypto.randomUUID()}`, papel: "fornecedor", fornecedorId: f!.id },
      { canal: "whatsapp", endereco: `f-${crypto.randomUUID()}`, papel: "fornecedor", fornecedorId: f!.id },
    ])
    .returning();

  assert.equal((await m.enviar(tg!.id, "Pedido de cotação")).situacao, "enviada");
  const r = await m.receber({ canal: "simulado", endereco: tg!.endereco, texto: "PARAR", idExterno: "x1" });
  assert.equal(r.tipo, "parou");
  assert.equal((await m.receber({ canal: "simulado", endereco: tg!.endereco, texto: "PARAR", idExterno: "x1" })).tipo, "repetida");

  assert.equal((await m.enviar(tg!.id, "Lembrete")).situacao, "bloqueada_parar");
  assert.equal((await m.enviar(wa!.id, "Lembrete")).situacao, "bloqueada_parar");
  assert.equal(enviadas.length, 1);
});
