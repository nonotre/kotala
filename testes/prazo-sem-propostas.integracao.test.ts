// R14b (regra de 08/11): prazo vencido com menos de 3 propostas válidas. O Cotador pergunta
// ao comprador se encerra ou estende; estendendo, dá prioridade, pergunta o motivo a quem não
// respondeu e amplia a busca. Usa DATABASE_URL_TESTE.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { and, eq, sql } from "drizzle-orm";

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
      ...(await import("../src/agentes/cotador/prazo.ts")),
    }
  : null;

let enviadas: { endereco: string; texto: string; opcoes: { botoes?: { rotulo: string; dado: string }[]; tipo?: string } }[] = [];

before(async () => {
  if (!mod) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(mod.db, { migrationsFolder: "drizzle" });
  const canal = mod.canalEmMemoria("web");
  enviadas = canal.enviadas;
  mod.registrarCanal(canal.adaptador);
});
beforeEach(async () => {
  if (!mod) return;
  await mod.conexao`truncate item_catalogo, auditoria, arquivo, evento, uso_ia, mensagem, mapa_cotacao, referencia_preco, oferta, cotacao, historico_compra, item_pedido, pedido, contato, usuario, fornecedor restart identity cascade`;
  enviadas.length = 0;
});
after(async () => {
  if (mod) await mod.conexao.end();
});

/** Fornecedores com contato no canal web; devolve id do fornecedor e endereço do contato. */
async function fornecedores(n: number) {
  const m = mod!;
  const out: { id: string; contatoId: string; endereco: string }[] = [];
  for (let i = 0; i < n; i++) {
    const [f] = await m.db.insert(m.schema.fornecedor).values({ nome: `Forn ${crypto.randomUUID().slice(0, 6)}`, origem: "real" }).returning();
    const endereco = `f-${crypto.randomUUID()}`;
    const [c] = await m.db.insert(m.schema.contato).values({ canal: "web", endereco, papel: "fornecedor", fornecedorId: f!.id }).returning();
    out.push({ id: f!.id, contatoId: c!.id, endereco });
  }
  return out;
}

/** Item em `cotando` com prazo vencido; cotação enviada (com contato) a cada fornecedor dado. */
async function itemCotando(consultados: { id: string; contatoId: string }[], opcoes: { prazo?: Date; urgencia?: "normal" | "urgente" } = {}) {
  const m = mod!;
  const r = await m.receber({ canal: "web", endereco: `c-${crypto.randomUUID()}`, texto: "oi" });
  const c = r.tipo === "recebida" ? r.contato : assert.fail();
  const p = await m.orquestrador.abrirPedido({ compradorId: c.id, canalOrigem: "web", textoOriginal: "40 cp2" });
  if (opcoes.urgencia) await m.db.update(m.schema.pedido).set({ urgencia: opcoes.urgencia }).where(eq(m.schema.pedido.id, p.id));
  const [item] = await m.orquestrador.definirItens(m.db, p.id, [{ descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco" }]);
  const motivo = { agente: "Interpretador" as const, motivo: "teste" };
  await m.orquestrador.avancarPedido(p.id, "interpretado", motivo);
  await m.orquestrador.avancarPedido(p.id, "comprador_confirmou", { agente: "Comprador", motivo: "teste" });
  await m.orquestrador.avancarItem(item!.id, "busca_concluida", motivo, { prazoRespostasEm: opcoes.prazo ?? new Date(Date.now() - 1000) });
  if (consultados.length) {
    await m.db.insert(m.schema.cotacao).values(consultados.map((f) => ({ itemPedidoId: item!.id, fornecedorId: f.id, contatoId: f.contatoId, rodada: 1, enviadaEm: new Date() })));
  }
  return { id: item!.id, compradorId: c.id, endereco: c.endereco };
}

async function proposta(itemId: number, fornecedorId: string) {
  const m = mod!;
  const [c] = await m.db.select().from(m.schema.cotacao).where(and(eq(m.schema.cotacao.itemPedidoId, itemId), eq(m.schema.cotacao.fornecedorId, fornecedorId)));
  await m.db.insert(m.schema.oferta).values({
    itemPedidoId: itemId, fornecedorId, cotacaoId: c!.id, rodada: 1, itemOferecido: "Cimento CP II 50 kg", itemExato: true,
    precoUnitario: "40", frete: "50", prazoDias: 2, validadeDias: 7, pagamento: "à vista", prazoPagamentoDias: 0, entregaNoLocal: true, formato: "texto",
  });
  await m.db.update(m.schema.cotacao).set({ situacao: "respondeu" }).where(eq(m.schema.cotacao.id, c!.id));
}

const itemDe = async (id: number) => (await mod!.db.query.itemPedido.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!;
const cotacoesDo = (id: number) => mod!.db.select().from(mod!.schema.cotacao).where(eq(mod!.schema.cotacao.itemPedidoId, id));
const eventosDo = async (id: number, tipo: string) =>
  (await mod!.db.query.evento.findMany({ where: (t, { eq }) => eq(t.itemPedidoId, id) })).filter((e) => (e.dados as { tipo?: string } | null)?.tipo === tipo);
const paraO = (endereco: string) => enviadas.filter((e) => e.endereco === endereco);

/** Simula o fim da espera pela resposta do comprador: prazo do item e da pergunta no passado. */
async function vencerEspera(id: number) {
  const passado = new Date(Date.now() - 1000);
  await mod!.db.update(mod!.schema.itemPedido).set({ prazoRespostasEm: passado }).where(eq(mod!.schema.itemPedido.id, id));
  await mod!.db
    .update(mod!.schema.evento)
    .set({ dados: sql`jsonb_set(${mod!.schema.evento.dados}, '{ate}', to_jsonb(${passado.toISOString()}::text))` })
    .where(and(eq(mod!.schema.evento.itemPedidoId, id), sql`${mod!.schema.evento.dados}->>'tipo' = 'prazo_pergunta'`));
}

test("prazo vencido com menos de 3: pergunta ao comprador uma vez, com botões, e o item não fecha", { skip: pular }, async () => {
  const [a, b, ...outros] = await fornecedores(4);
  void outros;
  const it = await itemCotando([a!, b!]);
  await proposta(it.id, a!.id);

  await mod!.verificarVencidos(new Date());
  await mod!.verificarVencidos(new Date()); // outra volta do varredor: não repete
  await mod!.orquestrador.varrerPrazos(new Date());

  const item = await itemDe(it.id);
  assert.equal(item.estado, "cotando");
  assert.ok(item.prazoRespostasEm!.getTime() > Date.now());
  assert.equal((await eventosDo(it.id, "prazo_pergunta")).length, 1);
  // Sem busca automática antes da escolha (I3 só depois de "estender").
  assert.equal((await cotacoesDo(it.id)).length, 2);
  const perguntas = paraO(it.endereco).filter((e) => e.opcoes.botoes?.some((x) => x.dado.endsWith(":prazo_estender")));
  assert.equal(perguntas.length, 1);
  assert.match(perguntas[0]!.texto, /venceu com só 1 proposta válida \(o mínimo para comparar é 3\); 1 fornecedor não respondeu/);
  assert.deepEqual(perguntas[0]!.opcoes.botoes, [
    { rotulo: "Encerrar e ver as opções", dado: `item:${it.id}:prazo_encerrar` },
    { rotulo: "Estender o prazo", dado: `item:${it.id}:prazo_estender` },
  ]);
});

test("encerrar: segue o fechamento com o que houver; botão repetido avisa que já foi resolvido", { skip: pular }, async () => {
  const [a, b] = await fornecedores(3);
  const it = await itemCotando([a!, b!]);
  await proposta(it.id, a!.id);
  await mod!.verificarVencidos(new Date());

  assert.ok(await mod!.aoBotaoDoPrazo({ id: it.compradorId }, `item:${it.id}:prazo_encerrar`));
  assert.equal((await itemDe(it.id)).estado, "comparando");
  const resp = await eventosDo(it.id, "prazo_resposta");
  assert.equal((resp[0]!.dados as { escolha: string }).escolha, "encerrar");
  assert.equal(resp[0]!.agente, "Comprador");

  await mod!.aoBotaoDoPrazo({ id: it.compradorId }, `item:${it.id}:prazo_estender`);
  assert.match(paraO(it.endereco).at(-1)!.texto, /já foi encerrada/);
  // Botão de item de outra pessoa: ignorado, sem resposta.
  const antes = enviadas.length;
  assert.ok(await mod!.aoBotaoDoPrazo({ id: crypto.randomUUID() }, `item:${it.id}:prazo_encerrar`));
  assert.equal(enviadas.length, antes);
});

test("estender: prorroga, dá prioridade, pergunta o motivo a quem não respondeu e amplia a busca", { skip: pular }, async () => {
  const [a, b, ...resto] = await fornecedores(5);
  const it = await itemCotando([a!, b!], { urgencia: "urgente" });
  await proposta(it.id, a!.id);
  await mod!.verificarVencidos(new Date());
  assert.equal(await mod!.prioridadeDoItem(it.id), false);

  assert.ok(await mod!.aoBotaoDoPrazo({ id: it.compradorId }, `item:${it.id}:prazo_estender`));
  const item = await itemDe(it.id);
  assert.equal(item.estado, "cotando");
  assert.equal(item.rodada, 1);
  assert.ok(item.prazoRespostasEm!.getTime() > Date.now() + 800_000);
  assert.equal(await mod!.prioridadeDoItem(it.id), true);
  const resp = (await eventosDo(it.id, "prazo_resposta"))[0]!.dados as { escolha: string; prioridade: boolean; prorrogacao: number };
  assert.deepEqual([resp.escolha, resp.prioridade, resp.prorrogacao], ["estender", true, 1]);

  // Motivo: só para quem não respondeu, curto, neutro, como lembrete (conta como o lembrete dele).
  const motivo = paraO(b!.endereco);
  assert.equal(motivo.length, 1);
  assert.match(motivo[0]!.texto, /ainda não recebi sua proposta, e o prazo foi estendido até/);
  assert.match(motivo[0]!.texto, /Se não for atender, é só avisar\./);
  assert.equal(motivo[0]!.opcoes.tipo, "lembrete");
  assert.equal(paraO(a!.endereco).length, 0);
  assert.ok((await cotacoesDo(it.id)).find((c) => c.fornecedorId === b!.id)!.lembreteEm);

  // Busca (I3) com prioridade: o teto normal vale mesmo em pedido urgente.
  const novas = (await cotacoesDo(it.id)).filter((c) => resto.some((r) => r.id === c.fornecedorId));
  assert.equal(novas.length, 2);
  const aviso = paraO(it.endereco).at(-1)!.texto;
  assert.match(aviso, /estendi o prazo de Cimento CP II 50 kg até .* e dei prioridade à cotação/);
  assert.match(aviso, /Perguntei a 1 fornecedor que não respondeu o que aconteceu/);
  assert.match(aviso, /Consultei mais 2 fornecedores/);

  // O motivo que o fornecedor der vai ao comprador.
  const [cb] = (await cotacoesDo(it.id)).filter((c) => c.fornecedorId === b!.id);
  assert.ok(await mod!.repassarMotivoAoComprador(cb!, "Estamos sem estoque até o fim do mês."));
  assert.match(paraO(it.endereco).at(-1)!.texto, /respondeu sobre a falta de proposta de Cimento CP II 50 kg: "Estamos sem estoque/);

  // Vence de novo: com prioridade, a busca roda sozinha (sem nova pergunta) enquanto houver levas.
  await mod!.db.update(mod!.schema.itemPedido).set({ prazoRespostasEm: new Date(Date.now() - 1000) }).where(eq(mod!.schema.itemPedido.id, it.id));
  await mod!.verificarVencidos(new Date());
  assert.equal((await eventosDo(it.id, "prazo_pergunta")).length, 1);
  assert.equal((await cotacoesDo(it.id)).length, 5);
});

test("sem prioridade, o motivo não é repassado", { skip: pular }, async () => {
  const [a, b] = await fornecedores(2);
  const it = await itemCotando([a!, b!]);
  const [cb] = (await cotacoesDo(it.id)).filter((c) => c.fornecedorId === b!.id);
  assert.equal(await mod!.repassarMotivoAoComprador(cb!, "sem estoque"), false);
});

test("comprador não responde: encerra com o que houver", { skip: pular }, async () => {
  const [a, b] = await fornecedores(3);
  const it = await itemCotando([a!, b!]);
  await proposta(it.id, a!.id);
  await mod!.verificarVencidos(new Date());
  await vencerEspera(it.id);

  await mod!.verificarVencidos(new Date());
  await mod!.orquestrador.varrerPrazos(new Date());
  assert.equal((await itemDe(it.id)).estado, "comparando");
  assert.equal(((await eventosDo(it.id, "prazo_resposta"))[0]!.dados as { escolha: string }).escolha, "sem_resposta");
  assert.match(paraO(it.endereco).at(-1)!.texto, /sem resposta sobre o prazo de Cimento CP II 50 kg, encerrei com a única proposta válida que havia/);
});

test("limite de prorrogações: depois dele, encerra com aviso", { skip: pular }, async () => {
  const anterior = process.env.MAX_PRORROGACOES;
  process.env.MAX_PRORROGACOES = "1";
  try {
    const [a, b] = await fornecedores(2); // sem candidatos novos
    const it = await itemCotando([a!, b!]);
    await proposta(it.id, a!.id);
    await mod!.verificarVencidos(new Date());
    await mod!.aoBotaoDoPrazo({ id: it.compradorId }, `item:${it.id}:prazo_estender`);
    await mod!.db.update(mod!.schema.itemPedido).set({ prazoRespostasEm: new Date(Date.now() - 1000) }).where(eq(mod!.schema.itemPedido.id, it.id));

    assert.equal(await mod!.verificarFaltaDePropostas(it.id, "venceu"), "encerrar");
    assert.equal((await eventosDo(it.id, "prazo_pergunta")).length, 1);
    assert.equal((await eventosDo(it.id, "prazo_limite")).length, 1);
    assert.match(paraO(it.endereco).at(-1)!.texto, /Já estendi 1 vez, que é o limite; encerro com o que tenho/);
  } finally {
    if (anterior === undefined) delete process.env.MAX_PRORROGACOES;
    else process.env.MAX_PRORROGACOES = anterior;
  }
});

test("já tem 3 válidas, ou ninguém para esperar e nenhum fornecedor novo: encerra sem perguntar", { skip: pular }, async () => {
  const [a, b, c] = await fornecedores(3);
  const it = await itemCotando([a!, b!, c!]);
  for (const f of [a!, b!, c!]) await proposta(it.id, f.id);
  assert.equal(await mod!.verificarFaltaDePropostas(it.id, "venceu"), "encerrar");

  const [d, e] = await fornecedores(2);
  const it2 = await itemCotando([d!, e!]);
  await proposta(it2.id, d!.id);
  await mod!.db.update(mod!.schema.cotacao).set({ situacao: "sem_resposta" }).where(eq(mod!.schema.cotacao.fornecedorId, e!.id));
  // Os 3 primeiros já são de outro item, mas são candidatos novos para este: tira-os de cena.
  await mod!.db.update(mod!.schema.itemPedido).set({ excluidos: [a!.id, b!.id, c!.id] }).where(eq(mod!.schema.itemPedido.id, it2.id));
  assert.equal(await mod!.verificarFaltaDePropostas(it2.id, "venceu"), "encerrar");
  assert.equal((await eventosDo(it2.id, "prazo_pergunta")).length, 0);
});

test("rodada de negociação do botão fecha no prazo sem perguntar", { skip: pular }, async () => {
  const [a] = await fornecedores(3);
  const it = await itemCotando([a!]);
  await mod!.db.update(mod!.schema.itemPedido).set({ negociacao: { rodada: 1, alvos: [a!.id], melhorCusto: null, referencia: null, motivo: "teste" } }).where(eq(mod!.schema.itemPedido.id, it.id));
  assert.equal(await mod!.verificarFaltaDePropostas(it.id, "venceu"), "encerrar");
});

test("textos: pergunta sem proposta válida e motivo", () => {
  const ate = new Date(Date.now() + 60_000);
  const t = mod
    ? mod.textoPerguntaPrazo({ pedidoId: 7, descricao: "Areia média", validas: 0, devendo: 0, origem: "todos_responderam", ate })
    : "";
  if (!mod) return;
  assert.match(t, /^Pedido 7: todos os fornecedores consultados para Areia média já responderam, mas nenhuma proposta é válida/);
  assert.match(t, /Quer encerrar \(o item fica sem proposta\) ou estender o prazo\?/);
  assert.doesNotMatch(t, /pergunto a quem não respondeu/);
  const m = mod.textoMotivo({ id: 3, quantidade: "2", unidade: "m³", descricao: "Areia média" }, ate);
  assert.match(m, /^Sobre a cotação 3 \(2 m³ de Areia média\)/);
  assert.doesNotMatch(m, /R\$/);
});

test("o botão entra pela mesma receber() do Telegram, do chat web e das telas", { skip: pular }, async () => {
  const { aoMensagemDoComprador } = await import("../src/fluxo/comprador.ts");
  const [a, b] = await fornecedores(3);
  const it = await itemCotando([a!, b!]);
  await proposta(it.id, a!.id);
  await mod!.verificarVencidos(new Date());
  mod!.aoReceber((m) => aoMensagemDoComprador(m));
  try {
    // Mesmo formato da rota /acoes/botao das telas e do clique no Telegram.
    const r = await mod!.receber({ canal: "web", endereco: it.endereco, idExterno: `tela-${crypto.randomUUID()}`, texto: "", botao: `item:${it.id}:prazo_encerrar` });
    assert.equal(r.tipo, "recebida");
    assert.equal((await itemDe(it.id)).estado, "comparando");
  } finally {
    mod!.aoReceber(() => {});
  }
});
