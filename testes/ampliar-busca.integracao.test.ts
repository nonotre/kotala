// I3: buscar mais fornecedores quando faltam propostas válidas. Usa DATABASE_URL_TESTE.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { and, eq } from "drizzle-orm";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;
process.env.MAX_FORNECEDORES = "2";
process.env.PRAZO_MODO = "demo";
process.env.PRAZO_RESPOSTAS_SEG = "900";

const mod = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
      ...(await import("../src/agentes/cotador/index.ts")),
      ...(await import("../src/agentes/busca/index.ts")),
    }
  : null;

before(async () => {
  if (!mod) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(mod.db, { migrationsFolder: "drizzle" });
  const { adaptador } = mod.canalEmMemoria("web");
  mod.registrarCanal(adaptador);
});
// Cada teste começa sem fornecedores de outro: eles entram como candidatos.
beforeEach(async () => {
  if (mod) await mod.conexao`truncate item_catalogo, auditoria, arquivo, evento, uso_ia, mensagem, mapa_cotacao, referencia_preco, oferta, cotacao, historico_compra, item_pedido, pedido, contato, usuario, fornecedor restart identity cascade`;
});
after(async () => {
  if (mod) await mod.conexao.end();
});

async function fornecedores(n: number) {
  const m = mod!;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [f] = await m.db.insert(m.schema.fornecedor).values({ nome: `Forn ${crypto.randomUUID().slice(0, 6)}`, origem: "real" }).returning();
    await m.db.insert(m.schema.contato).values({ canal: "web", endereco: `f-${crypto.randomUUID()}`, papel: "fornecedor", fornecedorId: f!.id });
    ids.push(f!.id);
  }
  return ids;
}

/** Item em `cotando` com prazo vencido e cotação aguardando para os fornecedores dados. */
async function itemCotando(consultados: string[], opcoes: { urgencia?: "normal" | "urgente" } = {}) {
  const m = mod!;
  const r = await m.receber({ canal: "web", endereco: `c-${crypto.randomUUID()}`, texto: "oi" });
  assert.equal(r.tipo, "recebida");
  const c = r.tipo === "recebida" ? r.contato : assert.fail();
  const p = await m.orquestrador.abrirPedido({ compradorId: c.id, canalOrigem: "web", textoOriginal: "40 cp2" });
  if (opcoes.urgencia) await m.db.update(m.schema.pedido).set({ urgencia: opcoes.urgencia }).where(eq(m.schema.pedido.id, p.id));
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

async function proposta(itemId: number, fornecedorId: string, extra: { prazoDias?: number | null } = {}) {
  const m = mod!;
  const [c] = await m.db.select().from(m.schema.cotacao).where(and(eq(m.schema.cotacao.itemPedidoId, itemId), eq(m.schema.cotacao.fornecedorId, fornecedorId)));
  await m.db.insert(m.schema.oferta).values({
    itemPedidoId: itemId, fornecedorId, cotacaoId: c!.id, rodada: 1, itemOferecido: "Cimento CP II 50 kg", itemExato: true,
    precoUnitario: "40", frete: "50", prazoDias: extra.prazoDias === undefined ? 2 : extra.prazoDias, validadeDias: 7,
    pagamento: "boleto", prazoPagamentoDias: 28, entregaNoLocal: true, formato: "texto",
  });
  await m.db.update(m.schema.cotacao).set({ situacao: "respondeu" }).where(eq(m.schema.cotacao.id, c!.id));
}

const cotacoesDo = (id: number) => mod!.db.select().from(mod!.schema.cotacao).where(eq(mod!.schema.cotacao.itemPedidoId, id));
const itemDe = async (id: number) => (await mod!.db.query.itemPedido.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!;

test("caminho feliz: amplia na mesma rodada, prorroga o prazo e avisa o comprador", { skip: pular }, async () => {
  const [a, b, ...resto] = await fornecedores(6);
  const id = await itemCotando([a!, b!]);
  await proposta(id, a!);
  // Quem parou sem receber a cotação não é reenviado.
  await mod!.db.update(mod!.schema.cotacao).set({ situacao: "sem_resposta", enviadaEm: null }).where(eq(mod!.schema.cotacao.fornecedorId, b!));

  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "ampliou");
  const item = await itemDe(id);
  assert.equal(item.estado, "cotando");
  assert.equal(item.rodada, 1);
  assert.ok(item.prazoRespostasEm!.getTime() > Date.now() + 800_000);
  const cs = await cotacoesDo(id);
  assert.equal(cs.length, 4); // 2 antigas + MAX_FORNECEDORES=2 novas
  assert.equal(cs.find((c) => c.fornecedorId === b!)!.enviadaEm, null);
  const novas = cs.filter((c) => resto.includes(c.fornecedorId));
  assert.equal(novas.length, 2);
  assert.ok(novas.every((c) => c.rodada === 1 && c.enviadaEm && c.situacao === "aguardando"));
  const eventos = await mod!.db.query.evento.findMany({ where: (t, { eq }) => eq(t.itemPedidoId, id) });
  assert.equal(eventos.filter((e) => e.acao.startsWith("Ampliou a busca")).length, 1);
  const avisos = await mod!.db.query.mensagem.findMany({ where: (t, { and, eq }) => and(eq(t.itemPedidoId, id), eq(t.direcao, "saida")) });
  assert.ok(avisos.some((x) => /Consultei mais 2 fornecedores e prorroguei até/.test(x.texto)));
});

test("duas chamadas ao mesmo tempo: uma só ampliação", { skip: pular }, async () => {
  const [a, ...resto] = await fornecedores(5);
  void resto;
  const id = await itemCotando([a!]);
  const r = await Promise.all([mod!.ampliarSeFaltarPropostas(id), mod!.ampliarSeFaltarPropostas(id)]);
  assert.equal(r.filter((x) => x === "ampliou").length, 1);
  assert.ok(!r.includes("pular") || r.includes("ampliou"));
  const eventos = await mod!.db.query.evento.findMany({ where: (t, { eq }) => eq(t.itemPedidoId, id) });
  assert.equal(eventos.filter((e) => e.acao.startsWith("Ampliou a busca")).length, 1);
  assert.equal((await cotacoesDo(id)).length, 3);
});

test("já tem 3 propostas válidas: encerra sem ampliar", { skip: pular }, async () => {
  const [a, b, c] = await fornecedores(4);
  const id = await itemCotando([a!, b!, c!]);
  for (const f of [a!, b!, c!]) await proposta(id, f);
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "encerrar");
  assert.equal((await cotacoesDo(id)).length, 3);
});

test("conta proposta válida, não resposta com preço: 3 sem prazo ainda ampliam", { skip: pular }, async () => {
  const [a, b, c] = await fornecedores(5);
  const id = await itemCotando([a!, b!, c!]);
  for (const f of [a!, b!, c!]) await proposta(id, f, { prazoDias: null });
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "ampliou");
});

test("teto de 2 ampliações por rodada, e urgente com 1", { skip: pular }, async () => {
  const todos = await fornecedores(9);
  const id = await itemCotando([todos[0]!]);
  const vencer = () => mod!.db.update(mod!.schema.itemPedido).set({ prazoRespostasEm: new Date(Date.now() - 1000) }).where(eq(mod!.schema.itemPedido.id, id));
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "ampliou");
  await vencer();
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "ampliou");
  await vencer();
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "encerrar"); // há candidatos, mas o teto vale
  assert.equal((await cotacoesDo(id)).length, 5);

  const [u0, ...outros] = await fornecedores(5);
  void outros;
  const idU = await itemCotando([u0!], { urgencia: "urgente" });
  assert.equal(await mod!.ampliarSeFaltarPropostas(idU), "ampliou");
  await mod!.db.update(mod!.schema.itemPedido).set({ prazoRespostasEm: new Date(Date.now() - 1000) }).where(eq(mod!.schema.itemPedido.id, idU));
  assert.equal(await mod!.ampliarSeFaltarPropostas(idU), "encerrar");
});

test("sem candidatos novos, encerra", { skip: pular }, async () => {
  const todos = await fornecedores(2);
  const id = await itemCotando(todos);
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "encerrar");
});

test("rodada de negociação não amplia", { skip: pular }, async () => {
  const [a] = await fornecedores(4);
  const id = await itemCotando([a!]);
  await mod!.db.update(mod!.schema.itemPedido).set({ negociacao: { rodada: 1, alvos: [a!], melhorCusto: null, referencia: null, motivo: "teste" } }).where(eq(mod!.schema.itemPedido.id, id));
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "encerrar");
  assert.equal((await cotacoesDo(id)).length, 1);
});

test("fora do estado cotando: pula", { skip: pular }, async () => {
  const [a] = await fornecedores(3);
  const id = await itemCotando([a!]);
  await mod!.orquestrador.avancarItem(id, "encerrar_cotacao", { agente: "Cotador", motivo: "teste" });
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "pular");
});

test("candidatosNovos: fora quem já foi consultado (qualquer situação) e quem o comprador excluiu", { skip: pular }, async () => {
  const [a, b, c, d] = await fornecedores(4);
  const id = await itemCotando([a!, b!]);
  await mod!.db.update(mod!.schema.cotacao).set({ situacao: "parou" }).where(eq(mod!.schema.cotacao.fornecedorId, b!));
  await mod!.db.update(mod!.schema.itemPedido).set({ excluidos: [c!] }).where(eq(mod!.schema.itemPedido.id, id));
  const novos = await mod!.candidatosNovos(await itemDe(id));
  assert.deepEqual(novos.map((x) => x.fornecedorId), [d!]);
});

test("todos responderam antes do prazo, com menos de 3 válidas: amplia em vez de fechar", { skip: pular }, async () => {
  const [a, ...resto] = await fornecedores(3);
  const id = await itemCotando([a!]);
  // Prazo ainda aberto: é o fechamento antecipado, não o varredor.
  await mod!.db.update(mod!.schema.itemPedido).set({ prazoRespostasEm: new Date(Date.now() + 600_000) }).where(eq(mod!.schema.itemPedido.id, id));
  await proposta(id, a!);

  await mod!.encerrarSeTodosResponderam(id);
  const item = await itemDe(id);
  assert.equal(item.estado, "cotando");
  const novas = (await cotacoesDo(id)).filter((c) => resto.includes(c.fornecedorId));
  assert.equal(novas.length, 2);

  // As novas respondem sem completar 3 válidas e acabaram os candidatos: agora fecha.
  for (const f of resto) await proposta(id, f, { prazoDias: null });
  await mod!.db.update(mod!.schema.itemPedido).set({ prazoRespostasEm: new Date(Date.now() - 1000) }).where(eq(mod!.schema.itemPedido.id, id));
  await mod!.encerrarSeTodosResponderam(id);
  assert.equal((await itemDe(id)).estado, "comparando");
});
