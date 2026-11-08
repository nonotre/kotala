// I3 e Q6, casos do harness (Frente 3): dois varredores, fornecedor com dois contatos,
// teto pela coluna item_pedido.ampliacoes, fornecedor antigo respondendo na leva 2 e
// um mapa só por item e rodada. Usa DATABASE_URL_TESTE; sem IA (as chaves são apagadas
// aqui, e a justificativa do mapa cai no texto padrão).
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { and, eq } from "drizzle-orm";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;
process.env.MAX_FORNECEDORES = "2";
process.env.PRAZO_MODO = "demo";
process.env.PRAZO_RESPOSTAS_SEG = "900";
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_API_KEY_RESERVA;

const mod = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
      ...(await import("../src/agentes/cotador/index.ts")),
      ...(await import("../src/agentes/busca/index.ts")),
      ...(await import("../src/agentes/comparador/index.ts")),
    }
  : null;

before(async () => {
  if (!mod) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(mod.db, { migrationsFolder: "drizzle" });
  const { adaptador } = mod.canalEmMemoria("web");
  mod.registrarCanal(adaptador);
  mod.ligarComparador();
});
beforeEach(async () => {
  if (mod) await mod.conexao`truncate item_catalogo, auditoria, arquivo, evento, uso_ia, mensagem, mapa_cotacao, referencia_preco, oferta, cotacao, historico_compra, item_pedido, pedido, contato, usuario, fornecedor restart identity cascade`;
});
after(async () => {
  if (mod) await mod.conexao.end();
});

async function fornecedores(n: number, contatosPorFornecedor = 1) {
  const m = mod!;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [f] = await m.db.insert(m.schema.fornecedor).values({ nome: `Forn ${i} ${crypto.randomUUID().slice(0, 4)}`, origem: "real" }).returning();
    for (let k = 0; k < contatosPorFornecedor; k++) {
      await m.db.insert(m.schema.contato).values({ canal: "web", endereco: `f-${crypto.randomUUID()}`, papel: "fornecedor", fornecedorId: f!.id });
    }
    ids.push(f!.id);
  }
  return ids;
}

async function itemCotando(consultados: string[]) {
  const m = mod!;
  const r = await m.receber({ canal: "web", endereco: `c-${crypto.randomUUID()}`, texto: "oi" });
  const c = r.tipo === "recebida" ? r.contato : assert.fail();
  const p = await m.orquestrador.abrirPedido({ compradorId: c.id, canalOrigem: "web", textoOriginal: "40 cp2" });
  const [item] = await m.orquestrador.definirItens(m.db, p.id, [{ descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco" }]);
  const motivo = { agente: "Interpretador" as const, motivo: "teste" };
  await m.orquestrador.avancarPedido(p.id, "interpretado", motivo);
  await m.orquestrador.avancarPedido(p.id, "comprador_confirmou", { agente: "Comprador", motivo: "teste" });
  await m.orquestrador.avancarItem(item!.id, "busca_concluida", motivo, { prazoRespostasEm: new Date(Date.now() - 1000) });
  if (consultados.length) {
    await m.db.insert(m.schema.cotacao).values(consultados.map((fornecedorId) => ({ itemPedidoId: item!.id, fornecedorId, rodada: 1, enviadaEm: new Date() })));
  }
  return item!.id;
}

async function proposta(itemId: number, fornecedorId: string, preco = "40") {
  const m = mod!;
  const [c] = await m.db.select().from(m.schema.cotacao).where(and(eq(m.schema.cotacao.itemPedidoId, itemId), eq(m.schema.cotacao.fornecedorId, fornecedorId)));
  await m.db.insert(m.schema.oferta).values({
    itemPedidoId: itemId, fornecedorId, cotacaoId: c!.id, rodada: 1, itemOferecido: "Cimento CP II 50 kg", itemExato: true,
    precoUnitario: preco, frete: "50", prazoDias: 2, validadeDias: 7, pagamento: "boleto", prazoPagamentoDias: 28, entregaNoLocal: true, formato: "texto",
  });
  await m.db.update(m.schema.cotacao).set({ situacao: "respondeu", respondeuEm: new Date() }).where(eq(m.schema.cotacao.id, c!.id));
}

const cotacoesDo = (id: number) => mod!.db.select().from(mod!.schema.cotacao).where(eq(mod!.schema.cotacao.itemPedidoId, id));
const itemDe = async (id: number) => (await mod!.db.query.itemPedido.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!;
const eventosDo = (id: number) => mod!.db.query.evento.findMany({ where: (t, { eq }) => eq(t.itemPedidoId, id) });

test(
  "dois varredores: o que leu a lista de vencidos antes da prorrogação não amplia de novo",
  { skip: pular },
  async () => {
    await fornecedores(6);
    const [a] = (await mod!.db.select({ id: mod!.schema.fornecedor.id }).from(mod!.schema.fornecedor).limit(1)).map((f) => f.id);
    const id = await itemCotando([a!]);
    // Varredor A e varredor B leem a mesma lista de vencidos no mesmo instante...
    const vencidosB = await mod!.db.select({ id: mod!.schema.itemPedido.id }).from(mod!.schema.itemPedido).where(eq(mod!.schema.itemPedido.estado, "cotando"));
    // ...A amplia e prorroga; B roda logo depois com a lista velha.
    assert.equal(await mod!.ampliarSeFaltarPropostas(id), "ampliou");
    const resultadosB = [];
    for (const { id: v } of vencidosB) resultadosB.push(await mod!.ampliarSeFaltarPropostas(v));
    assert.notEqual(resultadosB[0], "ampliou");
    assert.equal((await itemDe(id)).ampliacoes, 1);
    assert.equal((await cotacoesDo(id)).length, 3);
  },
);

test("dois varredores ao mesmo tempo, com o fechamento: uma ampliação e o item continua cotando", { skip: pular }, async () => {
  const [a] = await fornecedores(5);
  const id = await itemCotando([a!]);
  const r = await Promise.all([mod!.ampliarSeFaltarPropostas(id), mod!.ampliarSeFaltarPropostas(id), mod!.encerrarSeTodosResponderam(id)]);
  assert.equal(r.filter((x) => x === "ampliou").length, 1);
  const item = await itemDe(id);
  assert.equal(item.estado, "cotando");
  assert.equal(item.ampliacoes, 1);
  assert.equal((await eventosDo(id)).filter((e) => e.acao.startsWith("Ampliou a busca")).length, 1);
});

test("dedupe: fornecedor com dois contatos é um candidato só e recebe uma cotação", { skip: pular }, async () => {
  const [a] = await fornecedores(1);
  const [dois] = await fornecedores(1, 2);
  const id = await itemCotando([a!]);
  const novos = await mod!.candidatosNovos(await itemDe(id));
  assert.deepEqual(novos.map((c) => c.fornecedorId), [dois!]);
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "ampliou");
  const cs = (await cotacoesDo(id)).filter((c) => c.fornecedorId === dois);
  assert.equal(cs.length, 1);
});

test("teto: vale a coluna item_pedido.ampliacoes, não a contagem de eventos", { skip: pular }, async () => {
  await fornecedores(6);
  const [a] = (await mod!.db.select({ id: mod!.schema.fornecedor.id }).from(mod!.schema.fornecedor).limit(1)).map((f) => f.id);
  const id = await itemCotando([a!]);
  // Sem nenhum evento de ampliação, mas a coluna diz que o teto (2) já foi usado.
  await mod!.db.update(mod!.schema.itemPedido).set({ ampliacoes: 2 }).where(eq(mod!.schema.itemPedido.id, id));
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "encerrar");
  // Zerada (rodada nova do botão faz isso), volta a ampliar e conta 1.
  await mod!.db.update(mod!.schema.itemPedido).set({ ampliacoes: 0 }).where(eq(mod!.schema.itemPedido.id, id));
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "ampliou");
  assert.equal((await itemDe(id)).ampliacoes, 1);
});

test("fornecedor antigo responde na leva 2: a proposta dele conta e o mapa sai com as três", { skip: pular }, async () => {
  const [a, ...resto] = await fornecedores(3);
  const id = await itemCotando([a!]);
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "ampliou");
  // O da leva 1 responde depois da prorrogação; os novos ainda devem resposta.
  await proposta(id, a!, "41");
  await mod!.encerrarSeTodosResponderam(id);
  assert.equal((await itemDe(id)).estado, "cotando");
  for (const f of resto) await proposta(id, f, "40");
  await mod!.encerrarSeTodosResponderam(id);
  const item = await itemDe(id);
  assert.ok(["comparando", "aguardando_decisao"].includes(item.estado), item.estado);
  for (let i = 0; i < 50 && (await itemDe(id)).estado === "comparando"; i++) await new Promise((r) => setTimeout(r, 100));
  const mapa = await mod!.ultimoMapa(id);
  assert.ok(mapa);
  assert.equal(mapa.comparacao.validas.length, 3);
  assert.ok(mapa.comparacao.validas.some((l) => l.oferta.fornecedorId === a));
});

test("Q6: um mapa só por item e rodada, mesmo com fechamento e varredor ao mesmo tempo", { skip: pular }, async () => {
  const fs = await fornecedores(3);
  const id = await itemCotando(fs);
  for (const f of fs) await proposta(id, f);
  await Promise.all([mod!.encerrarSeTodosResponderam(id), mod!.encerrarSeTodosResponderam(id), mod!.orquestrador.varrerPrazos()]);
  for (let i = 0; i < 50 && (await itemDe(id)).estado !== "aguardando_decisao"; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await itemDe(id)).estado, "aguardando_decisao");
  const mapas = await mod!.db.select().from(mod!.schema.mapaCotacao).where(eq(mod!.schema.mapaCotacao.itemPedidoId, id));
  assert.equal(mapas.length, 1);
  assert.equal((await eventosDo(id)).filter((e) => /→ comparando/.test(e.acao)).length, 1);
});
