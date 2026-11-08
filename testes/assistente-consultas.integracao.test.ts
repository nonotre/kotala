// Consultas do Assistente (src/assistente/consultas.ts) contra o Postgres. Usa DATABASE_URL_TESTE, apagado a cada rodada.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { comparar, type OfertaComparavel } from "../src/agentes/comparador/calculo.ts";
import { rotaPermitida, type ContextoAssistente } from "../src/assistente/tipos.ts";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;

const { db, conexao, schema: s } = urlTeste ? await import("../src/nucleo/index.ts") : ({} as typeof import("../src/nucleo/index.ts"));
const { consultasDoBanco: q, numeroDoPedido, palavrasDaBusca, somarEconomia } = urlTeste
  ? await import("../src/assistente/consultas.ts")
  : ({} as typeof import("../src/assistente/consultas.ts"));

const MIN = 60_000;
const agora = new Date();
const antes = (minutos: number) => new Date(agora.getTime() - minutos * MIN);

type Cena = {
  A: ContextoAssistente;
  B: ContextoAssistente;
  /** Contato sem nenhum pedido. */
  C: ContextoAssistente;
  p: Record<"confirmaA" | "decisaoB" | "cotandoA" | "concluidoB" | "canceladoA" | "confirmaB" | "semPropostaB" | "recompraA", number>;
  itens: Record<"decisaoB" | "cotandoA" | "concluidoB" | "semPropostaB" | "recompraA", number>;
  fornecedorSimulado: string;
  mapa: ReturnType<typeof comparar>;
  mapaConcluido: ReturnType<typeof comparar>;
};
let cena: Cena;

before(async () => {
  if (pular) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(db, { migrationsFolder: "drizzle" });
  await conexao`truncate item_catalogo, auditoria, arquivo, evento, uso_ia, mensagem, mapa_cotacao, referencia_preco, oferta, cotacao, historico_compra, item_pedido, pedido, contato, fornecedor restart identity cascade`;
  cena = await montarCena();
});
after(async () => {
  if (!pular) await conexao.end();
});

// ---------- Cenário ----------

async function novoContato(nome: string) {
  const [c] = await db.insert(s.contato).values({ canal: "web", endereco: `c-${crypto.randomUUID()}`, papel: "comprador", nome }).returning();
  return c!;
}

async function novoFornecedor(nome: string, extra: Partial<typeof s.fornecedor.$inferInsert> = {}) {
  const [f] = await db.insert(s.fornecedor).values({ nome, origem: "simulado", ...extra }).returning();
  return f!;
}

function ofertaDe(f: { id: string; nome: string }, preco: number, prazoDias: number): OfertaComparavel {
  return {
    id: crypto.randomUUID(),
    fornecedorId: f.id,
    fornecedorNome: f.nome,
    simulado: true,
    verificado: false,
    homologado: false,
    conhecido: false,
    itemOferecido: "Item",
    itemExato: true,
    precoUnitario: preco,
    totalProduto: null,
    frete: 50,
    impostosValor: null,
    impostosNaoInclusos: "não há",
    prazoDias,
    validadeDias: 7,
    pagamento: "28 dias",
    prazoPagamentoDias: 28,
    entregaNoLocal: true,
    precoConfirmado: false,
    rodada: 1,
  };
}

async function montarCena(): Promise<Cena> {
  const [a, b, c] = [await novoContato("Ana"), await novoContato("Bruno"), await novoContato("Sem pedidos")];
  const ctx = (x: { id: string }): ContextoAssistente => ({ contatoId: x.id, agora });

  type Estado = (typeof s.pedido.$inferInsert)["estado"];
  const pedidoDe = async (compradorId: string, estado: Estado, minutosAtras: number, extra: Partial<typeof s.pedido.$inferInsert> = {}) => {
    const [p] = await db
      .insert(s.pedido)
      .values({ compradorId, estado, canalOrigem: "web", textoOriginal: "pedido de teste", criadoEm: antes(minutosAtras + 5), atualizadoEm: antes(minutosAtras), ...extra })
      .returning();
    return p!.id;
  };
  type EstadoItem = (typeof s.itemPedido.$inferInsert)["estado"];
  const itemDe = async (pedidoId: number, estado: EstadoItem, descricao: string, quantidade: string, unidade: string, minutosAtras: number, extra: Partial<typeof s.itemPedido.$inferInsert> = {}) => {
    const [i] = await db.insert(s.itemPedido).values({ pedidoId, ordem: 1, estado, descricao, quantidade, unidade, atualizadoEm: antes(minutosAtras), ...extra }).returning();
    return i!.id;
  };

  // Ana: pedido em "confirma?", mais antigo que o de Bruno
  const confirmaA = await pedidoDe(a.id, "aguardando_confirmacao", 50, { setor: "Comunicação", textoOriginal: "40 sacos de cimento para a obra" });
  await itemDe(confirmaA, "na_fila", "Cimento CP II 50 kg", "40", "saco", 50);
  const confirmaB = await pedidoDe(b.id, "aguardando_confirmacao", 40, { textoOriginal: "preciso de cal" });
  await itemDe(confirmaB, "na_fila", "Cal hidratada 20 kg", "10", "saco", 40);

  // Bruno: obra parada com mapa pronto para decidir
  const decisaoB = await pedidoDe(b.id, "em_andamento", 20, { urgencia: "obra_parada", setor: "Obra Beta", textoOriginal: "areia urgente, a obra parou" });
  const itemDecisaoB = await itemDe(decisaoB, "aguardando_decisao", "Areia média", "20", "m³", 20);
  const fornecedoresMapa = [await novoFornecedor("Areal Perto"), await novoFornecedor("Areal Longe"), await novoFornecedor("Depósito Central")];
  const mapa = comparar(
    { quantidade: 20, aceitaSimilar: false, prazoMaxDias: null, modoEntrega: "entrega", urgencia: "obra_parada" },
    [ofertaDe(fornecedoresMapa[0]!, 100, 2), ofertaDe(fornecedoresMapa[1]!, 120, 1), ofertaDe(fornecedoresMapa[2]!, 90, 5)],
  );
  await db.insert(s.mapaCotacao).values({ itemPedidoId: itemDecisaoB, rodada: 1, dados: mapa, recomendacao: "Areal Perto ficou na frente pelo prazo.", ofertaRecomendadaId: mapa.vencedora!.oferta.id });
  for (const f of fornecedoresMapa) await db.insert(s.cotacao).values({ itemPedidoId: itemDecisaoB, fornecedorId: f.id, situacao: "respondeu", rodada: 1 });
  await db.insert(s.referenciaPreco).values({
    itemPedidoId: itemDecisaoB, loja: "Loja Web", titulo: "Areia média 1 m³", url: "https://loja.exemplo/areia", metodo: "vtex_api", precoFonte: "95.00",
    precoUnitario: "95.00", aceita: true, confianca: 80, coletadoEm: antes(30),
  });

  // Ana: cotando, com cotação para um fornecedor e uma dúvida dele esperando resposta
  const cotandoA = await pedidoDe(a.id, "em_andamento", 15, { setor: "Almoxarifado" });
  const alfa = await novoFornecedor("Cerâmica Alfa", { email: "vendas@alfa.exemplo", cnpj: "00.000.000/0001-00" });
  const itemCotandoA = await itemDe(cotandoA, "cotando", "Tijolo furado 9x19x19", "1000", "un", 15, {
    duvidaPendente: { cotacaoId: crypto.randomUUID(), fornecedorId: alfa.id, contatoId: b.id, fornecedor: "Cerâmica Alfa", pergunta: "O tijolo pode ser de segunda linha?", em: antes(5).toISOString() },
  });
  await db.insert(s.cotacao).values({ itemPedidoId: itemCotandoA, fornecedorId: alfa.id, situacao: "aguardando", rodada: 1 });

  // Bruno: pedido concluído, com compra confirmada, mapa e histórico
  const concluidoB = await pedidoDe(b.id, "concluido", 10, { textoOriginal: "vergalhão" });
  const itemConcluidoB = await itemDe(concluidoB, "confirmado", "Vergalhão CA-50 10 mm", "100", "barra", 10);
  const fornecedoresAco = [await novoFornecedor("Aço Forte"), await novoFornecedor("Aço Barato"), await novoFornecedor("Ferro & Cia")];
  const mapaConcluido = comparar(
    { quantidade: 100, aceitaSimilar: false, prazoMaxDias: null, modoEntrega: "entrega", urgencia: "normal" },
    [ofertaDe(fornecedoresAco[0]!, 60, 3), ofertaDe(fornecedoresAco[1]!, 55, 6), ofertaDe(fornecedoresAco[2]!, 70, 3)],
  );
  await db.insert(s.mapaCotacao).values({ itemPedidoId: itemConcluidoB, rodada: 1, dados: mapaConcluido, recomendacao: "Teste.", ofertaRecomendadaId: mapaConcluido.vencedora!.oferta.id });
  await db.update(s.itemPedido).set({ ofertaEscolhidaId: mapaConcluido.vencedora!.oferta.id, fornecedorEscolhidoId: mapaConcluido.vencedora!.oferta.fornecedorId }).where(eq(s.itemPedido.id, itemConcluidoB));
  await db.insert(s.referenciaPreco).values({
    itemPedidoId: itemConcluidoB, loja: "Loja Aço", titulo: "Vergalhão 10 mm", url: "https://loja.exemplo/vergalhao", metodo: "vtex_api", precoFonte: "65.00",
    precoUnitario: "65.00", aceita: true, confianca: 70, coletadoEm: antes(30),
  });
  await db.insert(s.historicoCompra).values([
    { fornecedorId: fornecedoresAco[0]!.id, itemChave: "vergalhao-ca-50-10-mm", descricao: "Vergalhão CA-50 10 mm", precoUnitario: "60.00", quantidade: "100", data: antes(10), prazoCumprido: true, simulado: false, itemPedidoId: itemConcluidoB },
    // Histórico inicial da base fictícia: sem pedido, não tem tela para citar.
    { fornecedorId: fornecedoresAco[1]!.id, itemChave: "vergalhao-ca-50-8-mm", descricao: "Vergalhão CA-50 8 mm", precoUnitario: "40.00", quantidade: "50", data: antes(90_000), simulado: true },
  ]);

  const canceladoA = await pedidoDe(a.id, "cancelado", 100, { motivoCancelamento: "Pedido errado" });
  await itemDe(canceladoA, "cancelado", "Tinta acrílica 18 L", "2", "lata", 100);

  // Bruno: urgente, sem proposta válida (e um item antigo que já não avisa)
  const semPropostaB = await pedidoDe(b.id, "em_andamento", 60, { urgencia: "urgente" });
  const itemSemPropostaB = await itemDe(semPropostaB, "sem_proposta", "Telha ondulada", "30", "un", 60);
  await itemDe(semPropostaB, "sem_proposta", "Brita 1", "5", "m³", 8 * 24 * 60, { ordem: 2 });

  // Ana: repetir compra
  const recompraA = await pedidoDe(a.id, "em_andamento", 30);
  const itemRecompraA = await itemDe(recompraA, "aguardando_recompra", "Cimento CP III 50 kg", "20", "saco", 30);

  // Eventos do pedido do Bruno em obra parada: 20 em ordem, o último ligado só pelo item
  for (let n = 1; n <= 20; n++) {
    await db.insert(s.evento).values({
      pedidoId: n === 20 ? null : decisaoB,
      itemPedidoId: n === 20 ? itemDecisaoB : null,
      agente: "Comparador",
      acao: `Passo ${n}`,
      motivo: n === 19 ? "x".repeat(1000) : `Motivo ${n}`,
      criadoEm: antes(100 - n),
    });
  }

  return {
    A: ctx(a),
    B: ctx(b),
    C: ctx(c),
    p: { confirmaA, decisaoB, cotandoA, concluidoB, canceladoA, confirmaB, semPropostaB, recompraA },
    itens: { decisaoB: itemDecisaoB, cotandoA: itemCotandoA, concluidoB: itemConcluidoB, semPropostaB: itemSemPropostaB, recompraA: itemRecompraA },
    fornecedorSimulado: fornecedoresMapa[0]!.id,
    mapa,
    mapaConcluido,
  };
}

const ids = (l: { pedidoId: number }[]) => l.map((x) => x.pedidoId).sort((x, y) => x - y);
const todosHrefs = (x: unknown): string[] => {
  if (Array.isArray(x)) return x.flatMap(todosHrefs);
  if (x && typeof x === "object") return Object.entries(x).flatMap(([k, v]) => (k === "href" && typeof v === "string" ? [v] : todosHrefs(v)));
  return [];
};

// ---------- Funções puras ----------

test("palavras da busca e número do pedido", () => {
  assert.deepEqual(palavrasDaBusca("  Cimento  CP-II 50%  "), ["cimento", "cp-ii", "50\\%"]);
  assert.deepEqual(palavrasDaBusca("Comunicação"), ["comunicacao"]);
  assert.equal(numeroDoPedido("12"), 12);
  assert.equal(numeroDoPedido("#12"), 12);
  assert.equal(numeroDoPedido("Pedido 12"), 12);
  assert.equal(numeroDoPedido("12 sacos"), null);
  assert.equal(numeroDoPedido("99999999999"), null);
});

test("soma da economia: sem referência ou negociação, o número é nulo e não zero", () => {
  const compra = { custo: 110, produto: 100, produtoAntesNegociar: null, maisCaraCusto: 130, validas: 3, referenciaProduto: null, simulado: true };
  const r = somarEconomia([compra]);
  assert.equal(r.totalPago, 110);
  assert.equal(r.economiaVsMaisCara, 20);
  assert.equal(r.economiaVsReferencia, null);
  assert.equal(r.economiaNegociacao, null);
  assert.equal(r.simuladas, 1);
  // Só uma proposta válida: não há faixa de preço para comparar.
  assert.equal(somarEconomia([{ ...compra, validas: 1 }]).economiaVsMaisCara, null);
});

// ---------- Pendências ----------

test("pendências: obra parada, depois urgente, depois o mais novo; daConversa marca só as da conversa", { skip: pular }, async () => {
  const { p, itens, A } = cena;
  const lista = await q.pendencias(A);
  assert.deepEqual(
    lista.map((x) => [x.tipo, x.pedidoId]),
    [
      ["decidir", p.decisaoB],
      ["sem_proposta", p.semPropostaB],
      ["recompra", p.recompraA],
      ["confirmar_pedido", p.confirmaB],
      ["confirmar_pedido", p.confirmaA],
    ],
  );
  // Sem proposta de mais de 7 dias não avisa mais; o item antigo (Brita) fica de fora.
  assert.equal(lista.filter((x) => x.tipo === "sem_proposta").length, 1);
  assert.equal(lista[0]!.urgencia, "obra_parada");
  assert.equal(lista[0]!.href, `/pedidos/${p.decisaoB}/decisao#item-${itens.decisaoB}`);
  assert.equal(lista[1]!.href, `/pedidos/${p.semPropostaB}/cotacoes#item-${itens.semPropostaB}`);
  assert.equal(lista[0]!.itemId, itens.decisaoB);
  assert.equal(lista[4]!.itemId, null);
  // Visão da empresa inteira: Ana vê o que é do Bruno, marcado como de fora da conversa.
  assert.deepEqual(lista.map((x) => x.daConversa), [false, false, true, false, true]);
  // Quem não fez pedido nenhum vê a mesma lista, nada é da conversa dele.
  const deC = await q.pendencias(cena.C);
  assert.equal(deC.length, lista.length);
  assert.ok(deC.every((x) => !x.daConversa));
  assert.ok(lista.every((x) => rotaPermitida(x.href)));
});

// ---------- Busca de pedidos ----------

test("buscarPedidos: sem filtro, mais recentes primeiro, com daConversa e itens", { skip: pular }, async () => {
  const { p, A } = cena;
  const todos = await q.buscarPedidos(A, {});
  assert.equal(todos.length, 8);
  assert.deepEqual(todos.map((x) => x.pedidoId), Object.values(p).sort((x, y) => y - x));
  const meu = todos.find((x) => x.pedidoId === p.confirmaA)!;
  const dele = todos.find((x) => x.pedidoId === p.decisaoB)!;
  assert.equal(meu.daConversa, true);
  assert.equal(dele.daConversa, false);
  assert.equal(dele.urgencia, "obra_parada");
  assert.equal(dele.href, `/pedidos/${p.decisaoB}`);
  assert.match(dele.nome, new RegExp(`^Pedido ${p.decisaoB} · Areia média · setor Obra Beta$`));
  assert.equal(dele.itens[0]!.quantidade, 20);
  assert.equal(dele.itens[0]!.coluna, "Comparando");
  assert.equal(meu.itens[0]!.coluna, "Solicitado");
  // Item do pedido cancelado aparece como Cancelado, não como Decidido.
  assert.equal(todos.find((x) => x.pedidoId === p.canceladoA)!.itens[0]!.coluna, "Cancelado");
  assert.ok(Number.isFinite(Date.parse(dele.criadoEm)));
});

test("buscarPedidos: limite padrão, mínimo e máximo", { skip: pular }, async () => {
  const { A } = cena;
  assert.equal((await q.buscarPedidos(A, { limite: 3 })).length, 3);
  assert.equal((await q.buscarPedidos(A, { limite: 0 })).length, 1);
  assert.equal((await q.buscarPedidos(A, { limite: -5 })).length, 1);
  assert.equal((await q.buscarPedidos(A, { limite: 1000 })).length, 8);
  // Padrão 10: com 12 pedidos a mais, a lista pararia em 10 e o teto em 20.
  const [c] = await db.select().from(s.contato).limit(1);
  const novos = await db
    .insert(s.pedido)
    .values(Array.from({ length: 14 }, (_, n) => ({ compradorId: c!.id, canalOrigem: "web" as const, textoOriginal: `extra ${n}`, estado: "cancelado" as const })))
    .returning({ id: s.pedido.id });
  try {
    assert.equal((await q.buscarPedidos(A, {})).length, 10);
    assert.equal((await q.buscarPedidos(A, { limite: 1000 })).length, 20);
  } finally {
    await db.delete(s.pedido).where(inArray(s.pedido.id, novos.map((n) => n.id)));
  }
});

test("buscarPedidos: número casa com o id; texto casa sem acento em item, setor, texto original e fornecedor", { skip: pular }, async () => {
  const { p, A } = cena;
  const achar = async (texto: string, estado?: "aberto") => ids(await q.buscarPedidos(A, { texto, estado }));
  assert.deepEqual(await achar(String(p.concluidoB)), [p.concluidoB]);
  assert.deepEqual(await achar(`Pedido ${p.cotandoA}`), [p.cotandoA]);
  assert.deepEqual(await achar("99999"), []);
  assert.deepEqual(await achar("99999999999999"), []);
  // item
  assert.deepEqual(await achar("cimento"), [p.confirmaA, p.recompraA]);
  // setor, sem acento nos dois lados
  assert.deepEqual(await achar("comunicacao"), [p.confirmaA]);
  assert.deepEqual(await achar("COMUNICAÇÃO"), [p.confirmaA]);
  assert.deepEqual(await achar("AREIA media"), [p.decisaoB]);
  // texto original do pedido
  assert.deepEqual(await achar("a obra parou"), [p.decisaoB]);
  // nome de fornecedor das cotações (Cerâmica Alfa cotou o tijolo)
  assert.deepEqual(await achar("ceramica alfa"), [p.cotandoA]);
  assert.deepEqual(await achar("areal perto"), [p.decisaoB]);
  // várias palavras: todas, cada uma em qualquer campo
  assert.deepEqual(await achar("cimento comunicacao"), [p.confirmaA]);
  assert.deepEqual(await achar("cimento tijolo"), []);
  // curinga do usuário não vira "casa com tudo"
  assert.deepEqual(await achar("%"), []);
  assert.deepEqual(await achar("_"), []);
  assert.deepEqual(await achar("' or 1=1 --"), []);
  // texto vazio é sem texto
  assert.equal((await q.buscarPedidos(A, { texto: "   " })).length, 8);
  // texto e estado juntos
  assert.deepEqual(await achar("cimento", "aberto"), [p.confirmaA, p.recompraA]);
});

test("buscarPedidos: filtro de estado", { skip: pular }, async () => {
  const { p, A } = cena;
  const com = async (estado: Parameters<typeof q.buscarPedidos>[1]["estado"]) => ids(await q.buscarPedidos(A, { estado }));
  const ord = (...x: number[]) => x.sort((a, b) => a - b);
  assert.deepEqual(await com("aberto"), ord(p.confirmaA, p.confirmaB, p.decisaoB, p.cotandoA, p.semPropostaB, p.recompraA));
  assert.deepEqual(await com("aguardando_voce"), ord(p.confirmaA, p.confirmaB, p.decisaoB, p.recompraA));
  assert.deepEqual(await com("cotando"), ord(p.cotandoA));
  assert.deepEqual(await com("concluido"), ord(p.concluidoB));
  assert.deepEqual(await com("cancelado"), ord(p.canceladoA));
  assert.equal((await com("todos")).length, 8);
  assert.equal((await com(undefined)).length, 8);
});

// ---------- Cartão de estado ----------

test("cartão: pedidoEmConfirmacao e dúvida só da conversa; pendências e abertos de todos", { skip: pular }, async () => {
  const { p, itens, A, B, C } = cena;
  const a = await q.cartaoDeEstado(A);
  assert.deepEqual(a.pedidoEmConfirmacao, { pedidoId: p.confirmaA, nome: `Pedido ${p.confirmaA} · Cimento CP II 50 kg · setor Comunicação` });
  assert.deepEqual(a.duvidaFornecedorPendente, { itemId: itens.cotandoA, fornecedor: "Cerâmica Alfa", pergunta: "O tijolo pode ser de segunda linha?" });
  assert.ok(a.pendencias.length <= 8 && a.pendencias.length === 5);
  assert.ok(a.pedidosAbertos.length <= 10);
  assert.deepEqual(ids(a.pedidosAbertos), [p.confirmaA, p.confirmaB, p.decisaoB, p.cotandoA, p.semPropostaB, p.recompraA].sort((x, y) => x - y));
  // Obra parada abre a lista de abertos.
  assert.equal(a.pedidosAbertos[0]!.pedidoId, p.decisaoB);
  assert.equal(a.pedidosAbertos[1]!.pedidoId, p.semPropostaB);
  // Concluído e cancelado não são abertos.
  assert.ok(!a.pedidosAbertos.some((x) => x.pedidoId === p.concluidoB || x.pedidoId === p.canceladoA));

  const b = await q.cartaoDeEstado(B);
  assert.equal(b.pedidoEmConfirmacao?.pedidoId, p.confirmaB, "o pedido em confirmação de Ana não vira o de Bruno");
  assert.equal(b.duvidaFornecedorPendente, null, "a dúvida é do comprador do item, não do contato do fornecedor");
  assert.equal(b.pendencias.length, a.pendencias.length);

  const c = await q.cartaoDeEstado(C);
  assert.equal(c.pedidoEmConfirmacao, null);
  assert.equal(c.duvidaFornecedorPendente, null);
  assert.equal(c.pedidosAbertos.length, 6, "a visão é da empresa inteira");
  assert.ok(c.pedidosAbertos.every((x) => !x.daConversa));
});

test("cartão: dúvida de fornecedor vencida não aparece e a leitura não limpa nada", { skip: pular }, async () => {
  const { A, itens } = cena;
  const depois = { ...A, agora: new Date(agora.getTime() + 60 * MIN) };
  assert.equal((await q.cartaoDeEstado(depois)).duvidaFornecedorPendente, null);
  const [i] = await db.select().from(s.itemPedido).where(eq(s.itemPedido.id, itens.cotandoA));
  assert.ok(i!.duvidaPendente, "a consulta não pode limpar a dúvida");
  assert.ok((await q.cartaoDeEstado(A)).duvidaFornecedorPendente);
});

// ---------- Detalhe, mapa e linha do tempo ----------

test("detalhePedido: itens, cotações da rodada e campos do pedido; inexistente é nulo", { skip: pular }, async () => {
  const { p, itens, A } = cena;
  const d = (await q.detalhePedido(A, p.decisaoB))!;
  assert.equal(d.pedidoId, p.decisaoB);
  assert.equal(d.daConversa, false);
  assert.equal(d.itens.length, 1);
  assert.equal(d.itens[0]!.itemId, itens.decisaoB);
  assert.deepEqual(d.itens[0]!.cotacoes.map((c) => c.fornecedor), ["Areal Longe", "Areal Perto", "Depósito Central"]);
  assert.ok(d.itens[0]!.cotacoes.every((c) => c.simulado && c.situacao === "respondeu" && c.rodada === 1));
  assert.equal(d.motivoCancelamento, null);
  assert.deepEqual(d.suposicoes, []);

  const cancelado = (await q.detalhePedido(A, p.canceladoA))!;
  assert.equal(cancelado.motivoCancelamento, "Pedido errado");
  assert.equal(cancelado.daConversa, true);

  assert.equal(await q.detalhePedido(A, 987_654), null);
  assert.equal(await q.detalhePedido(A, 99_999_999_999), null);
  assert.equal(await q.detalhePedido(A, -1), null);
  assert.equal(await q.detalhePedido(A, 1.5), null);
});

test("mapaCotacao: propostas em reais, recomendada, cortadas e referência; sem mapa é nulo", { skip: pular }, async () => {
  const { p, itens, A, mapa } = cena;
  const m = (await q.mapaCotacao(A, itens.decisaoB))!;
  assert.equal(m.pedidoId, p.decisaoB);
  assert.equal(m.daConversa, false);
  assert.equal(m.href, `/pedidos/${p.decisaoB}/comparacao#item-${itens.decisaoB}`);
  assert.equal(m.validas.length, 3);
  assert.deepEqual(m.validas.map((v) => v.custoTotal), mapa.validas.map((l) => l.custo));
  assert.deepEqual(m.validas.map((v) => v.nota), mapa.validas.map((l) => l.nota));
  assert.ok(m.validas.every((v) => v.simulado && typeof v.custoTotal === "number" && v.confianca === "simulado" && v.validade === "7 dias"));
  // Com 3 válidas o mapa pode dizer qual é a melhor.
  assert.equal(m.recomendada, mapa.vencedora!.oferta.id);
  assert.equal(m.justificativa, "Areal Perto ficou na frente pelo prazo.");
  assert.equal(m.pesos?.prazo, 50, "obra parada: prazo pesa o dobro");
  assert.deepEqual(m.referenciaPublica.map((r) => [r.loja, r.preco, r.unidade, r.link]), [["Loja Web", 95, "m³", "https://loja.exemplo/areia"]]);
  assert.equal(m.cortadas.length, 0);

  // Item cotando ainda não tem mapa.
  assert.equal(await q.mapaCotacao(A, itens.cotandoA), null);
  assert.equal(await q.mapaCotacao(A, 987_654), null);
});

test("mapaCotacao: com menos de 3 válidas nunca há recomendada", { skip: pular }, async () => {
  const { A } = cena;
  const duas = comparar({ quantidade: 20, aceitaSimilar: false, prazoMaxDias: null, modoEntrega: "entrega", urgencia: "normal" }, cena.mapa.validas.slice(0, 2).map((l) => ({ ...l.oferta, id: crypto.randomUUID() })));
  assert.equal(duas.validas.length, 2);
  const [pedidoNovo] = await db.select({ id: s.pedido.id, c: s.pedido.compradorId }).from(s.pedido).limit(1);
  const [i] = await db.insert(s.itemPedido).values({ pedidoId: pedidoNovo!.id, ordem: 99, estado: "aguardando_decisao", descricao: "Item com duas", quantidade: "20", unidade: "un" }).returning();
  try {
    await db.insert(s.mapaCotacao).values({ itemPedidoId: i!.id, rodada: 1, dados: duas, recomendacao: "Teste.", ofertaRecomendadaId: duas.vencedora!.oferta.id });
    const m = (await q.mapaCotacao(A, i!.id))!;
    assert.equal(m.validas.length, 2);
    assert.equal(m.recomendada, null);
  } finally {
    await db.delete(s.mapaCotacao).where(eq(s.mapaCotacao.itemPedidoId, i!.id));
    await db.delete(s.itemPedido).where(eq(s.itemPedido.id, i!.id));
  }
});

test("linhaDoTempo: 15 mais recentes em ordem cronológica, com limite e motivo cortado", { skip: pular }, async () => {
  const { p, itens, A } = cena;
  const padrao = (await q.linhaDoTempo(A, p.decisaoB))!;
  assert.equal(padrao.length, 15);
  assert.deepEqual(padrao.map((e) => e.acao), Array.from({ length: 15 }, (_, n) => `Passo ${n + 6}`));
  assert.equal(padrao.at(-1)!.itemId, itens.decisaoB, "o evento ligado só pelo item também entra");
  assert.equal(padrao[0]!.itemId, null);
  assert.ok(padrao.every((e, n) => n === 0 || padrao[n - 1]!.em <= e.em));
  const longo = padrao.find((e) => e.acao === "Passo 19")!;
  assert.ok(longo.motivo.length <= 401 && longo.motivo.endsWith("…"));
  assert.deepEqual((await q.linhaDoTempo(A, p.decisaoB, 3))!.map((e) => e.acao), ["Passo 18", "Passo 19", "Passo 20"]);
  assert.equal((await q.linhaDoTempo(A, p.decisaoB, 500))!.length, 20);
  assert.deepEqual(await q.linhaDoTempo(A, p.confirmaA), [], "pedido sem eventos tem lista vazia, não nulo");
  assert.equal(await q.linhaDoTempo(A, 987_654), null);
});

// ---------- Fornecedores, compras e economia ----------

test("fornecedores: por id e por nome sem acento; nada de e-mail ou CNPJ; simulado marcado", { skip: pular }, async () => {
  const { A } = cena;
  const [alfa] = await q.fornecedores(A, { nome: "ceramica" });
  assert.equal(alfa!.nome, "Cerâmica Alfa");
  assert.equal(alfa!.origem, "simulado");
  assert.equal(alfa!.href, `/fornecedores/${alfa!.id}`);
  assert.equal(alfa!.confianca.nivel, "simulado");
  assert.equal(alfa!.bloqueado, false);
  assert.equal(alfa!.compras, 0);
  const json = JSON.stringify(await q.fornecedores(A, { nome: "ceramica" }));
  assert.ok(!json.includes("@") && !json.includes("alfa.exemplo") && !json.includes("00.000.000"), "dados pessoais não saem");

  const porId = await q.fornecedores(A, { id: alfa!.id });
  assert.equal(porId.length, 1);
  assert.equal(porId[0]!.id, alfa!.id);
  assert.deepEqual(await q.fornecedores(A, { id: "não-é-uuid" }), []);
  assert.deepEqual(await q.fornecedores(A, { id: "00000000-0000-0000-0000-000000000000" }), []);
  assert.deepEqual(await q.fornecedores(A, { nome: "nada disso existe" }), []);
  // Compras confirmadas contam pelo histórico.
  const [aco] = await q.fornecedores(A, { nome: "aço forte" });
  assert.equal(aco!.compras, 1);
  assert.ok((await q.fornecedores(A, {})).length >= 7, "sem filtro devolve os primeiros");
});

test("item resumo traz a categoria da base; fora da base fica null", { skip: pular }, async () => {
  const { p, A, B } = cena;
  // Sem carregarCatalogo() neste processo: só a base fixa conhece os itens.
  const categoriaDe = async (ctx: ContextoAssistente, pedidoId: number) => (await q.detalhePedido(ctx, pedidoId))!.itens.map((i) => i.categoria);
  assert.deepEqual(await categoriaDe(A, p.confirmaA), ["Cimentícios"]);
  assert.deepEqual(await categoriaDe(B, p.decisaoB), ["Agregados"]);
  assert.deepEqual(await categoriaDe(B, p.concluidoB), ["Aço e ferragens estruturais"]);
  assert.deepEqual(await categoriaDe(A, p.cotandoA), [null], "tijolo não está na base");
  // Mesma categoria nos resumos de lista e do cartão.
  const lista = await q.buscarPedidos(A, { texto: "cimento", estado: "todos" });
  assert.ok(lista.length > 0 && lista.every((r) => r.itens.every((i) => "categoria" in i)));
  assert.equal(lista.find((r) => r.pedidoId === p.confirmaA)!.itens[0]!.categoria, "Cimentícios");
});

test("fornecedores por categoria: várias categorias, sem acento, sem bloqueado nem PARAR, confiança primeiro", { skip: pular }, async () => {
  const { A } = cena;
  const mk = (nome: string, categorias: string[], extra: Partial<typeof s.fornecedor.$inferInsert> = {}) => novoFornecedor(nome, { categorias, ...extra });
  const nota = (pontos: number) => ({ verificacao: { pontos, nivel: "media" } });
  const tubos = await mk("Tubos Sul", ["Hidráulica", "Elétrico"], { origem: "real", ...nota(80) });
  const fios = await mk("Fios Norte", ["elétrico"], { origem: "real", ...nota(60) });
  const simulado = await mk("Hidro Demo", ["Hidráulica"], nota(80));
  await mk("Tubos Bloqueados", ["Hidráulica"], { origem: "real", bloqueadoEm: new Date(), motivoBloqueio: "atraso", ...nota(99) });
  await mk("Tubos Parou", ["Hidráulica"], { origem: "real", parouEm: new Date(), ...nota(99) });
  await mk("Só Madeira", ["Madeira"], { origem: "real", ...nota(90) });

  // Com duas categorias, aparece nas duas; acento e caixa não importam.
  const hidraulica = await q.fornecedores(A, { categoria: "hidraulica" });
  assert.deepEqual(hidraulica.map((f) => f.nome), ["Tubos Sul", "Hidro Demo"], "real antes de simulado no empate; sem bloqueado nem PARAR");
  const eletrico = await q.fornecedores(A, { categoria: "ELÉTRICO" });
  assert.deepEqual(eletrico.map((f) => f.nome), ["Tubos Sul", "Fios Norte"], "ordem pelos pontos");
  assert.deepEqual(hidraulica[0]!.categorias, ["Hidráulica", "Elétrico"]);
  assert.equal(hidraulica[0]!.id, tubos.id);
  assert.equal(eletrico[1]!.id, fios.id);
  assert.equal(hidraulica[1]!.id, simulado.id);
  assert.equal(hidraulica[1]!.origem, "simulado");

  // Combina com o nome, e categoria sem fornecedor devolve vazio.
  assert.deepEqual((await q.fornecedores(A, { categoria: "Hidráulica", nome: "demo" })).map((f) => f.nome), ["Hidro Demo"]);
  assert.deepEqual(await q.fornecedores(A, { categoria: "Hidráulica", nome: "madeira" }), []);
  assert.deepEqual(await q.fornecedores(A, { categoria: "Categoria que não existe" }), []);
  // Categoria em branco é sem filtro.
  assert.ok((await q.fornecedores(A, { categoria: "  " })).length >= 7);
});

test("categorias: da base e dos fornecedores, com itens, fornecedores ativos e simulados, em ordem alfabética", { skip: pular }, async () => {
  const { A } = cena;
  // Uma categoria que só aparece no fornecedor (não existe na base).
  await novoFornecedor("Vidraçaria Exemplo", { origem: "real", categorias: ["Vidros"] });
  const lista = await q.categorias(A);
  const por = (nome: string) => lista.find((c) => c.categoria === nome);
  const nomes = lista.map((c) => c.categoria);
  assert.deepEqual(nomes, [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")));
  assert.ok(!nomes.includes("Cadastrado pelo agente"));
  assert.equal(new Set(nomes.map((n) => n.toLowerCase())).size, nomes.length, "sem categoria repetida por caixa");

  const base = JSON.parse(readFileSync("src/dados/itens.json", "utf8")).itens as { categoria: string }[];
  const itensDaBase = (c: string) => base.filter((i) => i.categoria === c).length;
  // Hidráulica: Tubos Sul (real) e Hidro Demo (simulado); bloqueado e PARAR não contam.
  assert.deepEqual(por("Hidráulica"), { categoria: "Hidráulica", itens: itensDaBase("Hidráulica"), fornecedores: 2, simulados: 1 });
  // "elétrico" minúsculo do fornecedor entra em "Elétrico" da base.
  assert.deepEqual(por("Elétrico"), { categoria: "Elétrico", itens: itensDaBase("Elétrico"), fornecedores: 2, simulados: 0 });
  assert.deepEqual(por("Vidros"), { categoria: "Vidros", itens: 0, fornecedores: 1, simulados: 0 });
  // Categoria da base sem fornecedor aparece com zero.
  assert.deepEqual(por("Iluminação"), { categoria: "Iluminação", itens: itensDaBase("Iluminação"), fornecedores: 0, simulados: 0 });
  assert.ok(nomes.includes("Cimentícios") && nomes.includes("Agregados"));
});

test("historicoCompras: acha por palavra do item, com pedido e link; compra sem pedido fica de fora", { skip: pular }, async () => {
  const { p, itens, A } = cena;
  const achadas = await q.historicoCompras(A, "vergalhao");
  assert.equal(achadas.length, 1, "a compra do histórico inicial não tem pedido para linkar");
  const c = achadas[0]!;
  assert.equal(c.pedidoId, p.concluidoB);
  assert.equal(c.itemId, itens.concluidoB);
  assert.equal(c.fornecedor, "Aço Forte");
  assert.equal(c.simulado, true);
  assert.equal(c.precoUnitario, 60);
  assert.equal(c.quantidade, 100);
  assert.equal(c.unidade, "barra");
  assert.equal(c.prazoCumprido, true);
  assert.equal(c.href, `/pedidos/${p.concluidoB}`);
  assert.deepEqual(await q.historicoCompras(A, "tijolo"), []);
  assert.equal((await q.historicoCompras(A, "")).length, 1);
  assert.equal((await q.historicoCompras(A, "CA-50 10")).length, 1);
});

test("economia: totais da compra confirmada com a referência declarada; período sem compras", { skip: pular }, async () => {
  const { A, mapaConcluido: m } = cena;
  const e = await q.economia(A);
  const escolhida = m.vencedora!;
  const maisCara = m.validas.reduce((x, y) => (y.custo! > x.custo! ? y : x));
  assert.equal(e.href, "/economia");
  assert.equal(e.periodoDias, 30);
  assert.equal(e.comprasConfirmadas, 1);
  assert.equal(e.totalPago, escolhida.custo);
  assert.equal(e.economiaVsMaisCara, Math.round((maisCara.custo! - escolhida.custo!) * 100) / 100);
  assert.equal(e.economiaVsReferencia, Math.round((65 * 100 - escolhida.produto!) * 100) / 100);
  assert.equal(e.economiaNegociacao, null);
  assert.match(e.observacao, /referência/);
  assert.match(e.observacao, /1 de 1 compras foram com fornecedores simulados/);

  assert.equal((await q.economia(A, 5000)).periodoDias, 365);
  assert.equal((await q.economia(A, 0)).periodoDias, 1);
  const futuro = await q.economia({ ...A, agora: new Date(agora.getTime() + 90 * 86_400_000) }, 30);
  assert.equal(futuro.comprasConfirmadas, 0);
  assert.equal(futuro.totalPago, 0);
  assert.equal(futuro.economiaVsReferencia, null);
});

// ---------- Links ----------

test("todo href devolvido está nas rotas permitidas", { skip: pular }, async () => {
  const { p, itens, A, B } = cena;
  const respostas: unknown[] = [];
  for (const ctx of [A, B]) {
    respostas.push(await q.cartaoDeEstado(ctx), await q.pendencias(ctx), await q.buscarPedidos(ctx, { estado: "todos", limite: 20 }), await q.economia(ctx));
  }
  for (const id of Object.values(p)) respostas.push(await q.detalhePedido(A, id));
  for (const id of Object.values(itens)) respostas.push(await q.mapaCotacao(A, id));
  respostas.push(await q.fornecedores(A, {}), await q.fornecedores(A, { categoria: "Hidráulica" }), await q.historicoCompras(A, "vergalhao"));
  const hrefs = todosHrefs(respostas);
  assert.ok(hrefs.length > 60, `esperava muitos links, vieram ${hrefs.length}`);
  const invalidos = [...new Set(hrefs.filter((h) => !rotaPermitida(h)))];
  assert.deepEqual(invalidos, []);
});
