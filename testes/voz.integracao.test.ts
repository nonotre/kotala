// X5: registro da ligação por voz no banco (DATABASE_URL_TESTE), sem IA e sem Live.
// Idempotência, uma oferta por rodada, Q1 a confirmar, desconto uma vez (I1) com a mesma
// marca do texto, alertas que barram, rodada velha e transcrição no rastro.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;
else process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x";
process.env.GUARDRAIL_MODO_DEMO = "1";

const m = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
      ...(await import("../src/nucleo/orquestrador/index.ts")),
      ...(await import("../src/agentes/voz/index.ts")),
    }
  : null;

before(async () => {
  if (!m) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(m.db, { migrationsFolder: "drizzle" });
  m.registrarCanal(m.canalEmMemoria("web").adaptador);
});
after(async () => {
  if (m) await m.conexao.end();
});

/** Item cotando com duas cotações: a da ligação e outra aguardando (a cotação não fecha no meio do teste). */
async function cenario(p: { extraido?: Record<string, unknown>; ofertaTexto?: boolean } = {}) {
  const { db, schema } = m!;
  const { eq } = await import("drizzle-orm");
  const [comprador] = await db.insert(schema.contato).values({ canal: "web", endereco: `comp-${crypto.randomUUID()}`, papel: "comprador" }).returning();
  const [f] = await db.insert(schema.fornecedor).values({ nome: `Distribuidora Voz ${Date.now()}`, origem: "simulado" }).returning();
  const [outro] = await db.insert(schema.fornecedor).values({ nome: `Outra ${Date.now()}`, origem: "simulado" }).returning();
  const ped = await m!.abrirPedido({ compradorId: comprador!.id, canalOrigem: "web", textoOriginal: "50 resmas de papel A4" });
  const [item] = await m!.definirItens(db, ped.id, [{ descricao: "Papel A4 75 g", quantidade: 50, unidade: "resma" }]);
  await db.update(schema.itemPedido).set({ estado: "cotando", prazoRespostasEm: new Date(Date.now() + 15 * 60_000), aceitaSimilar: true }).where(eq(schema.itemPedido.id, item!.id));
  const [c] = await db.insert(schema.cotacao).values({ itemPedidoId: item!.id, fornecedorId: f!.id, situacao: p.ofertaTexto ? "respondeu" : "aguardando", enviadaEm: new Date(Date.now() - 60_000) }).returning();
  await db.insert(schema.cotacao).values({ itemPedidoId: item!.id, fornecedorId: outro!.id, situacao: "aguardando", enviadaEm: new Date(Date.now() - 60_000) });
  if (p.ofertaTexto) {
    await db.insert(schema.oferta).values({ itemPedidoId: item!.id, fornecedorId: f!.id, cotacaoId: c!.id, itemOferecido: "Papel A4 75 g", itemExato: true, precoUnitario: "30", frete: "50", prazoDias: 2, validadeDias: 7, pagamento: "boleto 28 dias", prazoPagamentoDias: 28, formato: "texto", extraido: p.extraido ?? {} });
  }
  return { cotacaoId: c!.id, item: item!, fornecedorId: f!.id, pedidoId: ped.id };
}

const ofertas = async (cotacaoId: string) => m!.db.query.oferta.findMany({ where: (t, { eq }) => eq(t.cotacaoId, cotacaoId) });
const eventosVoz = async (itemId: number) => m!.db.query.evento.findMany({ where: (t, { and, eq }) => and(eq(t.itemPedidoId, itemId), eq(t.agente, "Voz")) });

const completa = { preco_unitario: 28.9, leitura_preco: "unitario", frete: 40, prazo_dias: 2, pagamento: "boleto 28 dias", prazo_pagamento_dias: 28, validade_dias: 10, entrega_no_local: true };

test("Q1 a confirmar, depois confirmado: uma oferta só, na forma do Extrator; chamada repetida não grava de novo", { skip: pular }, async () => {
  const { cotacaoId, item } = await cenario();
  const r1 = await m!.registrarCotacaoPorVoz(cotacaoId, { preco_total: 300, leitura_preco: "ambiguo", prazo_dias: 2 }, "[fornecedor] fica trezentos");
  assert.equal(r1.ok, true);
  assert.match(r1.resposta, /é o preço por resma ou o total para 50 resmas/);
  let [o] = await ofertas(cotacaoId);
  assert.equal(o!.precoUnitario, null); // preço ambíguo não vira número em silêncio
  const ex = o!.extraido as { aConfirmar?: string[]; leituraPreco: string; alertas: string[]; divergencias: string[]; perguntaPendente?: string };
  assert.deepEqual(ex.aConfirmar, ["preco"]);
  assert.equal(ex.leituraPreco, "ambiguo");
  assert.deepEqual(ex.alertas, []);
  assert.ok(ex.perguntaPendente);
  assert.equal(o!.formato, "voz");

  const r2 = await m!.registrarCotacaoPorVoz(cotacaoId, { preco_unitario: 6, leitura_preco: "unitario", prazo_dias: 2 }, "[fornecedor] seis cada");
  assert.equal(r2.ok, true);
  const todas = await ofertas(cotacaoId);
  assert.equal(todas.length, 1);
  o = todas[0];
  assert.equal(Number(o!.precoUnitario), 6);
  assert.equal(o!.totalProduto, null);
  assert.equal((o!.extraido as { aConfirmar?: string[] }).aConfirmar, undefined);
  assert.match(r2.resposta, /Ainda falta: o frete, a condição de pagamento, a validade da proposta/);

  // O Live repete a mesma chamada: mesma resposta, nada gravado de novo.
  const n = (await eventosVoz(item.id)).length;
  const r3 = await m!.registrarCotacaoPorVoz(cotacaoId, { prazo_dias: 2, leitura_preco: "unitario", preco_unitario: 6 }, "[fornecedor] seis cada");
  assert.deepEqual(r3, r2);
  assert.equal((await eventosVoz(item.id)).length, n);
  assert.equal((await ofertas(cotacaoId)).length, 1);
});

test("I1: proposta completa pede desconto uma vez; a mesma proposta de novo não fecha como 'manteve'; a resposta fecha", { skip: pular }, async () => {
  const { cotacaoId, item, fornecedorId } = await cenario();
  const r = await m!.registrarCotacaoPorVoz(cotacaoId, completa, "[fornecedor] vinte e oito e noventa a resma");
  assert.match(r.resposta, /peça desconto uma única vez/);
  assert.match(r.resposta, /Por gentileza, conseguiria desconto na cotação\?/);
  assert.doesNotMatch(r.resposta, /Respondo ao comprador/);
  let [o] = await ofertas(cotacaoId);
  const marca = (o!.extraido as { negociacao?: { pedidaEm: string; respondidaEm?: string; antes: { precoUnitario: number } } }).negociacao;
  assert.ok(marca?.pedidaEm);
  assert.equal(marca!.antes.precoUnitario, 28.9);
  // Reserva no rastro: o texto não pede de novo.
  const neg = await import("../src/agentes/negociador/index.ts");
  assert.equal(await neg.reservarPedidoDeDesconto(fornecedorId, item.id, (await m!.db.query.itemPedido.findFirst({ where: (t, { eq }) => eq(t.id, item.id) }))!.pedidoId), false);

  // Mesma proposta, com outro campo (chamada nova): a marca continua aberta.
  await m!.registrarCotacaoPorVoz(cotacaoId, { ...completa, entrega_no_local: true, impostos: "inclusos" }, "");
  [o] = await ofertas(cotacaoId);
  assert.equal((o!.extraido as { negociacao?: { respondidaEm?: string } }).negociacao?.respondidaEm, undefined);

  // Ele baixa o preço: fecha como desconto, calculado em código.
  const r2 = await m!.registrarCotacaoPorVoz(cotacaoId, { ...completa, preco_unitario: 27.5, resposta_desconto: "deu_desconto" }, "[fornecedor] faço vinte e sete e cinquenta");
  assert.doesNotMatch(r2.resposta, /peça desconto/);
  [o] = await ofertas(cotacaoId);
  const fechada = (o!.extraido as { negociacao: { resultado: string; descontoProduto: number } }).negociacao;
  assert.equal(fechada.resultado, "desconto");
  assert.equal(fechada.descontoProduto, 70);
  assert.equal((await ofertas(cotacaoId)).length, 1);
});

test("marca do desconto pedido por texto passa para a proposta da ligação e fecha com 'manteve' dito", { skip: pular }, async () => {
  const antes = { precoUnitario: 30, totalProduto: null, frete: 50, prazoDias: 2, pagamento: "boleto 28 dias", prazoPagamentoDias: 28, impostosValor: null };
  const marca = { pedidaEm: new Date().toISOString(), janelaAte: new Date(Date.now() + 3 * 60_000).toISOString(), rodadaAuto: 1, alavancas: ["volume"], referenciaCitada: null, antes };
  const { cotacaoId } = await cenario({ ofertaTexto: true, extraido: { negociacao: marca } });
  const d = await m!.dadosDaLigacao(cotacaoId);
  assert.equal(d!.desconto, "aberto");
  assert.equal(d!.anterior?.precoUnitario, 30);
  const r = await m!.registrarCotacaoPorVoz(cotacaoId, { resposta_desconto: "manteve", preco_no_limite: true }, "[fornecedor] não consigo, é o limite");
  assert.equal(r.ok, true);
  const [o] = await ofertas(cotacaoId);
  assert.equal(Number(o!.precoUnitario), 30); // completou com a proposta de texto
  assert.equal(o!.validadeDias, 7);
  const n = (o!.extraido as { negociacao: { resultado: string; firme?: boolean } }).negociacao;
  assert.equal(n.resultado, "manteve");
  assert.equal(n.firme, true);
});

test("alerta que barra (sem nota) não grava oferta e avisa uma vez; propina grava marcada", { skip: pular }, async () => {
  const { cotacaoId, item } = await cenario();
  const r = await m!.registrarCotacaoPorVoz(cotacaoId, { ...completa, alertas: ["sem_nota"] }, "[fornecedor] sem nota sai mais barato");
  assert.equal(r.ok, false);
  assert.match(r.resposta, /Só compramos com nota fiscal/);
  assert.equal((await ofertas(cotacaoId)).length, 0);
  await m!.registrarCotacaoPorVoz(cotacaoId, { ...completa, alertas: ["sem_nota"], frete: 41 }, "");
  const alertas = (await eventosVoz(item.id)).filter((e) => (e.dados as { alerta?: string } | null)?.alerta === "sem_nota");
  assert.equal(alertas.length, 1);

  const r2 = await m!.registrarCotacaoPorVoz(cotacaoId, { ...completa, alertas: ["propina"] }, "[fornecedor] tem um agrado pra você");
  assert.equal(r2.ok, true);
  assert.match(r2.resposta, /Não aceitamos comissão/);
  assert.doesNotMatch(r2.resposta, /peça desconto/); // com alerta, não negocia
  const [o] = await ofertas(cotacaoId);
  assert.deepEqual((o!.extraido as { alertas: string[] }).alertas, ["propina"]);
});

test("rodada velha, falta de preço e fim da ligação sem proposta no rastro", { skip: pular }, async () => {
  const { db, schema } = m!;
  const { eq } = await import("drizzle-orm");
  const { cotacaoId, item } = await cenario();
  const sem = await m!.registrarCotacaoPorVoz(cotacaoId, { prazo_dias: 3 }, "");
  assert.equal(sem.ok, false);
  assert.match(sem.resposta, /Falta o preço/);

  const fim = await m!.registrarFimDaLigacao(cotacaoId, { motivo: "queda", transcricao: "[agente] Bom dia\n[fornecedor] alô", duracaoSeg: 12 });
  assert.equal(fim.ok, true);
  const ev = (await eventosVoz(item.id)).find((e) => /sem proposta/.test(e.acao));
  assert.ok(ev);
  assert.match((ev!.dados as { transcricao: string }).transcricao, /\[fornecedor\] alô/);

  await db.update(schema.itemPedido).set({ rodada: 2 }).where(eq(schema.itemPedido.id, item.id));
  const velha = await m!.registrarCotacaoPorVoz(cotacaoId, completa, "");
  assert.equal(velha.ok, false);
  assert.match(velha.resposta, /já foi encerrada/);
});
