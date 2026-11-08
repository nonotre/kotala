// Telegram simulado (T5, T6): escrever como o fornecedor simulado e assumir o chat.
// Integração com Postgres. Usa DATABASE_URL_TESTE, que é apagado a cada rodada.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { setTimeout as esperar } from "node:timers/promises";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;
// Atraso mínimo do simulador (500 ms): as respostas automáticas chegam rápido.
process.env.SIM_ATRASO_FATOR = "0.001";

const { db, conexao, schema, mensagens: m } = urlTeste
  ? await import("../src/nucleo/index.ts")
  : ({} as typeof import("../src/nucleo/index.ts"));
const sim = urlTeste ? await import("../src/simulador/index.ts") : ({} as typeof import("../src/simulador/index.ts"));
const { iniciarApiInterna } = urlTeste ? await import("../src/api-interna.ts") : ({} as typeof import("../src/api-interna.ts"));

const TOKEN = "token-teste";
let servidor: ReturnType<typeof iniciarApiInterna> | undefined;
let base = "";

before(async () => {
  if (pular) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(db, { migrationsFolder: "drizzle" });
  await conexao`truncate item_catalogo, auditoria, arquivo, evento, uso_ia, mensagem, mapa_cotacao, referencia_preco, oferta, cotacao, historico_compra, item_pedido, pedido, contato, usuario, fornecedor restart identity cascade`;
  await sim.semearSimulados();
  m.registrarCanal(sim.adaptadorSimulado());
  servidor = iniciarApiInterna(0, TOKEN);
  await new Promise((ok) => servidor!.once("listening", ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
after(async () => {
  if (pular) return;
  await new Promise((ok) => servidor?.close(ok));
  await conexao.end();
});

/** Contato do fornecedor simulado de uma persona (endereço = chave). */
async function contatoDa(chave: string) {
  const c = await db.query.contato.findFirst({ where: (t, { and, eq }) => and(eq(t.canal, "simulado"), eq(t.endereco, chave)) });
  return c!;
}

async function entradas(contatoId: string) {
  return db.query.mensagem.findMany({ where: (t, { and, eq }) => and(eq(t.contatoId, contatoId), eq(t.direcao, "entrada")) });
}

async function post(rota: string, corpo: unknown) {
  const r = await fetch(base + rota, { method: "POST", headers: { "x-kotala-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify(corpo) });
  return { status: r.status, dados: (await r.json()) as Record<string, unknown> };
}

test("automático: a persona responde sozinha ao que o sistema manda", { skip: pular }, async () => {
  const c = await contatoDa("sim-perto");
  await m.enviar(c.id, "Confirma esse preço?", { tipo: "confirmar_preco" });
  await esperar(900);
  const lista = await entradas(c.id);
  assert.equal(lista.length, 1);
  assert.match(lista[0]!.texto, /confirmo o preço/);
});

test("assumir cancela a resposta já agendada e cala a persona; devolver volta a reagir", { skip: pular }, async () => {
  const c = await contatoDa("sim-lagoa");
  await m.enviar(c.id, "Confirma esse preço?", { tipo: "confirmar_preco" });
  // A resposta está agendada (500 ms); o usuário assume antes do disparo.
  assert.deepEqual(await sim.assumirChat(c.id, true), { mudou: true });
  assert.equal(await sim.chatAssumido(c.id), true);
  await m.enviar(c.id, "Segue o pedido de compra.", { tipo: "pedido_compra" });
  await esperar(900);
  assert.equal((await entradas(c.id)).length, 0);

  // Estado não mudou: não grava outro evento.
  assert.deepEqual(await sim.assumirChat(c.id, true), { mudou: false });
  const eventos = await db.query.evento.findMany({ where: (t, { sql }) => sql`${t.dados}->>'contatoId' = ${c.id}` });
  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0]!.fornecedorIds, [c.fornecedorId]);

  // Devolvido ao automático: reage só ao que chega depois.
  assert.deepEqual(await sim.assumirChat(c.id, false), { mudou: true });
  assert.equal(await sim.chatAssumido(c.id), false);
  await m.enviar(c.id, "Confirma esse preço?", { tipo: "confirmar_preco" });
  await esperar(900);
  const lista = await entradas(c.id);
  assert.equal(lista.length, 1);
  assert.match(lista[0]!.texto, /confirmo o preço/);
});

test("resposta agendada não dispara se o chat foi assumido por fora (estado no banco)", { skip: pular }, async () => {
  const c = await contatoDa("sim-vale");
  await m.enviar(c.id, "Confirma esse preço?", { tipo: "confirmar_preco" });
  // Evento gravado direto, sem passar pelo assumirChat (que cancelaria o timer): o disparo confere o banco.
  await db.insert(schema.evento).values({
    agente: "Fornecedor",
    acao: "teste",
    motivo: "teste",
    fornecedorIds: [c.fornecedorId!],
    dados: { tipo: "sim_assumido", contatoId: c.id, assumido: true },
  });
  await esperar(900);
  assert.equal((await entradas(c.id)).length, 0);
  await sim.assumirChat(c.id, false);
});

test("rota de mensagem: entra pela receber() como o fornecedor e assume o chat", { skip: pular }, async () => {
  const c = await contatoDa("sim-ipe");
  const r = await post("/simulado/mensagem", { contatoId: c.id, texto: "  Cimento a R$ 38,00 o saco, entrega em 2 dias.  " });
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados, { ok: true, tipo: "recebida" });
  const lista = await entradas(c.id);
  assert.equal(lista.length, 1);
  assert.equal(lista[0]!.texto, "Cimento a R$ 38,00 o saco, entrega em 2 dias.");
  assert.match(lista[0]!.idExterno!, /^simtela-/);
  assert.equal(await sim.chatAssumido(c.id), true);

  // Com o chat assumido, o que o sistema manda não tem resposta automática.
  await m.enviar(c.id, "Confirma esse preço?", { tipo: "confirmar_preco" });
  await esperar(900);
  assert.equal((await entradas(c.id)).length, 1);

  // Botão sem texto também vale; texto comprido é cortado em 4000.
  const b = await post("/simulado/mensagem", { contatoId: c.id, botao: "pc:1:ok" });
  assert.equal(b.status, 200);
  await post("/simulado/mensagem", { contatoId: c.id, texto: "x".repeat(5_000) });
  const textos = (await entradas(c.id)).map((e) => e.texto.length);
  assert.ok(textos.includes(4_000));

  // Devolver ao automático pela rota.
  const a = await post("/simulado/automatico", { contatoId: c.id, ligado: true });
  assert.deepEqual(a.dados, { ok: true, automatico: true });
  assert.equal(await sim.chatAssumido(c.id), false);
  const s = await post("/simulado/automatico", { contatoId: c.id, ligado: false });
  assert.deepEqual(s.dados, { ok: true, automatico: false });
  assert.equal(await sim.chatAssumido(c.id), true);
});

test("rotas rejeitam contato que não é fornecedor simulado e corpo inválido", { skip: pular }, async () => {
  const sim1 = await contatoDa("sim-serra");
  const comprador = await m.receber({ canal: "web", endereco: `c-${crypto.randomUUID()}`, texto: "oi", papel: "comprador" });
  assert.equal(comprador.tipo, "recebida");
  const compradorId = comprador.tipo === "recebida" ? comprador.contato.id : "";

  const casos: [string, unknown, number][] = [
    ["/simulado/mensagem", { contatoId: "nao-e-uuid", texto: "oi" }, 400],
    ["/simulado/mensagem", { contatoId: crypto.randomUUID(), texto: "oi" }, 404],
    ["/simulado/mensagem", { contatoId: compradorId, texto: "oi" }, 400],
    ["/simulado/mensagem", { contatoId: sim1.id, texto: "   " }, 400],
    ["/simulado/mensagem", { contatoId: sim1.id }, 400],
    ["/simulado/automatico", { contatoId: compradorId, ligado: true }, 400],
    ["/simulado/automatico", { contatoId: sim1.id, ligado: "sim" }, 400],
  ];
  for (const [rota, corpo, status] of casos) {
    const r = await post(rota, corpo);
    assert.equal(r.status, status, `${rota} ${JSON.stringify(corpo)}`);
    assert.equal(typeof r.dados.erro, "string");
  }
  // Nada disso gravou mensagem nem assumiu o chat.
  assert.equal((await entradas(sim1.id)).length, 0);
  assert.equal(await sim.chatAssumido(sim1.id), false);
});
