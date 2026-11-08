// U3 (cadência), I1 (fechamento espera a janela do desconto) e U5 (categoria no primeiro
// contato). As funções puras rodam sempre; o resto usa DATABASE_URL_TESTE.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;
else process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta sem o banco de teste

const cad = await import("../src/agentes/cotador/cadencia.ts");

const T0 = new Date("2026-11-08T13:00:00Z");
const min = (m: number) => new Date(T0.getTime() + m * 60_000);

// ---------- Puras ----------

test("pergunta pendente: aberta depois da última mensagem do contato e ainda não vencida", () => {
  const abertas = [
    { tipo: "cotacao" as const, desde: min(0) },
    { tipo: "desconto" as const, desde: min(5) },
  ];
  assert.equal(cad.pendenteEntre(abertas, null, min(6), 75_000)?.tipo, "desconto");
  // O fornecedor respondeu depois das duas: nada pendente.
  assert.equal(cad.pendenteEntre(abertas, min(5.5), min(6), 75_000), null);
  // Respondeu à cotação, mas o desconto saiu depois: pendente.
  assert.equal(cad.pendenteEntre(abertas, min(1), min(6), 75_000)?.tipo, "desconto");
  // Fornecedor mudo: a pendência vence e a fila anda.
  assert.equal(cad.pendenteEntre(abertas, min(1), min(7), 75_000), null);
  // Ester: o pedido de desconto segura a fila por pelo menos o mínimo (5 min), mesmo com espera menor.
  assert.equal(cad.pendenteEntre(abertas, min(1), min(7), 75_000, 300_000)?.tipo, "desconto");
  assert.equal(cad.pendenteEntre(abertas, min(1), min(10.5), 75_000, 300_000), null);
});

const p = (tipo: Parameters<typeof cad.escolherEnvio>[0][number]["tipo"], itemPedidoId: number | null, linha?: string) => ({ tipo, itemPedidoId, texto: `${tipo} ${itemPedidoId}`, linha });

test("junta só perguntas do mesmo item, na ordem completar, confirmar preço, desconto; no máximo 3", () => {
  const escolhidas = cad.escolherEnvio([p("desconto", 7, "c"), p("categoria", null), p("completar", 7, "a"), p("confirmar_preco", 7, "b"), p("negociacao", 9, "x")]);
  assert.deepEqual(escolhidas.map((e) => e.tipo), ["completar", "confirmar_preco", "desconto"]);
  const t = cad.juntarPerguntas("Sobre a cotação 7:", escolhidas.map((e) => e.linha!));
  assert.equal(t, "Sobre a cotação 7:\n1. a\n2. b\n3. c\nResponda por aqui, do seu jeito.");
  // Categoria só vai sozinha, quando não há pergunta de item.
  assert.deepEqual(cad.escolherEnvio([p("categoria", null)]).map((e) => e.tipo), ["categoria"]);
  // Item diferente espera: sai só a do item mais antigo.
  assert.deepEqual(cad.escolherEnvio([p("negociacao", 9), p("negociacao", 7)]).map((e) => e.itemPedidoId), [7]);
});

// ---------- Banco ----------

const m = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
      ...(await import("../src/nucleo/orquestrador/index.ts")),
      ...(await import("../src/agentes/cotador/index.ts")),
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

async function cenario(extraido: Record<string, unknown>) {
  const { db, schema } = m!;
  const { eq } = await import("drizzle-orm");
  const [comprador] = await db.insert(schema.contato).values({ canal: "web", endereco: `comp-${crypto.randomUUID()}`, papel: "comprador" }).returning();
  const [f] = await db.insert(schema.fornecedor).values({ nome: `Depósito Real ${Date.now()}`, origem: "real" }).returning();
  const [ct] = await db.insert(schema.contato).values({ canal: "web", endereco: `forn-${crypto.randomUUID()}`, papel: "fornecedor", fornecedorId: f!.id }).returning();
  const ped = await m!.abrirPedido({ compradorId: comprador!.id, canalOrigem: "web", textoOriginal: "40 cp2" });
  const [item] = await m!.definirItens(db, ped.id, [{ descricao: "Cimento CP II", quantidade: 40, unidade: "saco" }]);
  await db.update(schema.itemPedido).set({ estado: "cotando", prazoRespostasEm: new Date(Date.now() + 15 * 60_000) }).where(eq(schema.itemPedido.id, item!.id));
  const [c] = await db
    .insert(schema.cotacao)
    .values({ itemPedidoId: item!.id, fornecedorId: f!.id, contatoId: ct!.id, situacao: "respondeu", enviadaEm: new Date(Date.now() - 60_000), respondeuEm: new Date() })
    .returning();
  const [o] = await db
    .insert(schema.oferta)
    .values({ itemPedidoId: item!.id, fornecedorId: f!.id, cotacaoId: c!.id, itemOferecido: "Cimento CP II", itemExato: true, precoUnitario: "40", frete: "60", prazoDias: 3, validadeDias: 10, pagamento: "boleto 28 dias", formato: "texto", extraido })
    .returning();
  return { f: f!, ct: ct!, item: item!, oferta: o! };
}

const estado = async (id: number) => (await m!.db.query.itemPedido.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!.estado;

test("pedido de desconto aberto segura o fechamento e a fila; a janela vencida fecha e marca sem resposta", { skip: pular }, async () => {
  const { db, schema } = m!;
  const { eq } = await import("drizzle-orm");
  const { adaptador, enviadas } = m!.canalEmMemoria("web");
  m!.registrarCanal(adaptador);
  m!.ligarCotador();
  const antes = { precoUnitario: 40, totalProduto: null, frete: 60, prazoDias: 3, pagamento: "boleto 28 dias", prazoPagamentoDias: 28, impostosValor: null };
  const marca = { pedidaEm: new Date().toISOString(), janelaAte: new Date(Date.now() + 3 * 60_000).toISOString(), rodadaAuto: 1, alavancas: ["volume"], referenciaCitada: null, antes };
  const { f, ct, item, oferta } = await cenario({ negociacao: marca });

  // Todos responderam, mas a janela do desconto está aberta: não fecha.
  await m!.encerrarSeTodosResponderam(item.id);
  assert.equal(await estado(item.id), "cotando");

  // U3: o pedido de desconto é a pergunta pendente; nada mais sai ao fornecedor.
  assert.equal((await cad.perguntaPendente(ct.id))?.tipo, "desconto");
  const n0 = enviadas.length;
  assert.equal(await cad.despacharPerguntas(ct.id), false);
  assert.equal(enviadas.length, n0);

  // O fornecedor manda qualquer mensagem: a fila anda e sai a pergunta de categoria (U5), uma vez.
  await db.insert(schema.mensagem).values({ canal: "web", direcao: "entrada", contatoId: ct.id, texto: "vou ver", situacao: "recebida" });
  assert.equal(await cad.perguntaPendente(ct.id), null);
  assert.equal(await cad.despacharPerguntas(ct.id), true);
  const cat = enviadas.at(-1)!;
  assert.match(cat.texto, /o que vocês vendem/);
  assert.ok(cat.opcoes.botoes?.some((b) => b.dado === "cad:pronto"));
  assert.equal((await db.query.fornecedor.findFirst({ where: (t, { eq }) => eq(t.id, f.id) }))!.cadastroEtapa, cad.ETAPA_CATEGORIA_COTACAO);
  assert.equal((await cad.perguntaPendente(ct.id))?.tipo, "categoria");
  assert.equal(await cad.despacharPerguntas(ct.id), false);

  // A janela vence: fecha, e quem não respondeu ao desconto mantém a proposta como "sem_resposta".
  // Este teste é só da janela: o teto de ampliações (I3) já foi atingido, senão o fechamento
  // antecipado consultaria os fornecedores que outros testes deixaram no banco.
  await db.update(schema.itemPedido).set({ ampliacoes: 2 }).where(eq(schema.itemPedido.id, item.id));
  await db.update(schema.oferta).set({ extraido: { negociacao: { ...marca, janelaAte: new Date(Date.now() - 1000).toISOString() } } }).where(eq(schema.oferta.id, oferta.id));
  await m!.encerrarSeTodosResponderam(item.id);
  assert.equal(await estado(item.id), "comparando");
  const o = await db.query.oferta.findFirst({ where: (t, { eq }) => eq(t.id, oferta.id) });
  assert.equal((o!.extraido as { negociacao: { resultado: string } }).negociacao.resultado, "sem_resposta");
  // Quem já respondeu a proposta não recebe "cotação encerrada".
  assert.ok(!enviadas.slice(n0).some((e) => /encerrado/.test(e.texto) && e.endereco === ct.endereco));
});

test("preço ou item a confirmar segura o fechamento até o prazo", { skip: pular }, async () => {
  const { item } = await cenario({ aConfirmar: ["preco"] });
  await m!.encerrarSeTodosResponderam(item.id);
  assert.equal(await estado(item.id), "cotando");
});
