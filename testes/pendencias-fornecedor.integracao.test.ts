// Pendências do lado do fornecedor (junção da rodada 2), com banco: quem compra no pedido
// de compra; conferência de saída no convite; confirmação de preço pela cadência;
// resposta ao desconto depois do fechamento.
// Usa DATABASE_URL_TESTE.
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
      ...(await import("../src/nucleo/orquestrador/index.ts")),
      ...(await import("../src/fluxo/decisao.ts")),
      ...(await import("../src/fluxo/fornecedor.ts")),
      ...(await import("../src/agentes/cotador/index.ts")),
      ...(await import("../src/agentes/cotador/confirmar-preco.ts")),
      cad: await import("../src/agentes/cotador/cadencia.ts"),
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

test("convite: nome com dado pessoal não sai, e nada fica gravado", { skip: pular }, async () => {
  const { db } = m!;
  const email = `teste-${crypto.randomUUID()}@exemplo.com`;
  await assert.rejects(m!.convidarPorEmail({ email, nome: "Loja do João CPF 123.456.789-09", usuarioBot: "bot_teste" }), /Convite não enviado: o texto tinha dado pessoal/);
  assert.equal(await db.query.fornecedor.findFirst({ where: (t, { eq }) => eq(t.email, email) }), undefined);
  const ev = await db.query.evento.findFirst({ where: (t, { and, eq, sql }) => and(eq(t.agente, "Guardrail"), sql`${t.dados}->>'email' = ${email}`) });
  assert.match(ev!.motivo, /Conferência de saída/);
});

/** Fornecedor com contato no canal web, um item esperando decisão com a proposta dele retida no mapa. */
async function retida() {
  const { db, schema } = m!;
  const { eq } = await import("drizzle-orm");
  const [comprador] = await db.insert(schema.contato).values({ canal: "web", endereco: `comp-${crypto.randomUUID()}`, papel: "comprador" }).returning();
  const [f] = await db.insert(schema.fornecedor).values({ nome: `Barateiro ${Date.now()}`, origem: "real", categorias: ["Cimentícios"] }).returning();
  const [ct] = await db.insert(schema.contato).values({ canal: "web", endereco: `forn-${crypto.randomUUID()}`, papel: "fornecedor", fornecedorId: f!.id }).returning();
  const ped = await m!.abrirPedido({ compradorId: comprador!.id, canalOrigem: "web", textoOriginal: "40 cp2" });
  const [item, outro] = await m!.definirItens(db, ped.id, [
    { descricao: "Cimento CP II", quantidade: 40, unidade: "saco" },
    { descricao: "Areia média", quantidade: 2, unidade: "m³" },
  ]);
  await db.update(schema.itemPedido).set({ estado: "aguardando_decisao" }).where(eq(schema.itemPedido.id, item!.id));
  const [o] = await db
    .insert(schema.oferta)
    .values({ itemPedidoId: item!.id, fornecedorId: f!.id, itemOferecido: "Cimento CP II", itemExato: true, precoUnitario: "10", frete: "0", prazoDias: 3, validadeDias: 10, pagamento: "boleto", formato: "texto" })
    .returning();
  const linha = { oferta: { id: o!.id, fornecedorId: f!.id, fornecedorNome: f!.nome, online: false }, portoes: { naoRetida: false }, precoUnitarioEfetivo: 10, produto: 400, abaixoDaReferencia: 0.7 };
  await db.insert(schema.mapaCotacao).values({ itemPedidoId: item!.id, rodada: 1, dados: { validas: [], cortadas: [linha] }, recomendacao: "teste" });
  return { ct: ct!, f: f!, item: item!, outro: outro!, oferta: o! };
}

test("R8 pela cadência: a confirmação de preço espera a pergunta pendente e sai depois", { skip: pular }, async () => {
  const { db, schema } = m!;
  const { eq } = await import("drizzle-orm");
  const { adaptador, enviadas } = m!.canalEmMemoria("web");
  m!.registrarCanal(adaptador);
  m!.ligarCotador();
  const { ct, f, item, outro, oferta } = await retida();

  // Outra cotação ao mesmo fornecedor está aberta e sem resposta: é a pergunta pendente.
  await db.update(schema.itemPedido).set({ estado: "cotando" }).where(eq(schema.itemPedido.id, outro.id));
  await db.insert(schema.cotacao).values({ itemPedidoId: outro.id, fornecedorId: f.id, contatoId: ct.id, enviadaEm: new Date() });
  const n0 = enviadas.length;
  assert.deepEqual(await m!.pedirConfirmacoesDePreco(item.id), { enviadas: 0, naFila: 1 });
  assert.equal(enviadas.length, n0);
  assert.equal((await db.query.oferta.findFirst({ where: (t, { eq }) => eq(t.id, oferta.id) }))!.confirmacaoPedidaEm, null);

  // O fornecedor responde: a fila anda e a confirmação sai, uma vez.
  await db.insert(schema.mensagem).values({ canal: "web", direcao: "entrada", contatoId: ct.id, texto: "segue a proposta", situacao: "recebida" });
  assert.equal(await m!.cad.despacharPerguntas(ct.id), true);
  const t = enviadas.at(-1)!;
  assert.equal(t.endereco, ct.endereco);
  assert.match(t.texto, new RegExp(`Sobre a cotação ${item.id} \\(40 sacos de Cimento CP II\\): o seu preço de R\\$\\s10,00 por saco ficou bem abaixo`));
  assert.ok((await db.query.oferta.findFirst({ where: (t, { eq }) => eq(t.id, oferta.id) }))!.confirmacaoPedidaEm);
  assert.equal((await m!.cad.perguntaPendente(ct.id))?.tipo, "confirmar_preco");
  assert.deepEqual(await m!.pedirConfirmacoesDePreco(item.id), { enviadas: 0, naFila: 0 });
});

test("R8 pela cadência: sem pergunta pendente, sai na hora", { skip: pular }, async () => {
  const { adaptador, enviadas } = m!.canalEmMemoria("web");
  m!.registrarCanal(adaptador);
  const { item, ct } = await retida();
  assert.deepEqual(await m!.pedirConfirmacoesDePreco(item.id), { enviadas: 1, naFila: 0 });
  assert.equal(enviadas.at(-1)!.endereco, ct.endereco);
  const ev = await m!.db.query.evento.findFirst({ where: (t, { and, eq }) => and(eq(t.itemPedidoId, item.id), eq(t.agente, "Comparador")) });
  assert.match(ev!.acao, /Pediu a .* para confirmar o preço/);
});

// ---------- I1: resposta ao desconto depois do fechamento ----------

const leitura = (extra: Record<string, unknown> = {}) =>
  ({
    classificacao: "outro", duvida: null, itemOferecido: null, itemExato: true, aderencia: "exato", divergencias: [], leituraPreco: "unitario", trechoPreco: null,
    alertas: [], descontoPercentual: null, descontoValor: null, descontoCondicao: null, precoUnitario: null, quantidadeOfertada: null, unidadeOfertada: null,
    embalagem: null, totalProduto: null, frete: null, impostosValor: null, impostosNaoInclusos: null, prazoDias: null, validadeDias: null, pagamento: null,
    prazoPagamentoDias: null, entregaNoLocal: null, cnpj: null, ...extra,
  }) as never;

/** Proposta de 40 sacos a R$ 40 com o pedido de desconto que ficou sem resposta (a janela venceu). */
async function descontoSemResposta(estado: string) {
  const { db, schema } = m!;
  const { eq } = await import("drizzle-orm");
  const [comprador] = await db.insert(schema.contato).values({ canal: "web", endereco: `comp-${crypto.randomUUID()}`, papel: "comprador" }).returning();
  const [f] = await db.insert(schema.fornecedor).values({ nome: `Depósito Tardio ${Date.now()}`, origem: "real", categorias: ["Cimentícios"] }).returning();
  const [ct] = await db.insert(schema.contato).values({ canal: "web", endereco: `forn-${crypto.randomUUID()}`, papel: "fornecedor", fornecedorId: f!.id }).returning();
  const ped = await m!.abrirPedido({ compradorId: comprador!.id, canalOrigem: "web", textoOriginal: "40 cp2" });
  const [item] = await m!.definirItens(db, ped.id, [{ descricao: "Cimento CP II", quantidade: 40, unidade: "saco" }]);
  const antes = { precoUnitario: 40, totalProduto: null, frete: 60, prazoDias: 3, pagamento: "boleto 28 dias", prazoPagamentoDias: 28, impostosValor: null };
  const marca = { pedidaEm: new Date(Date.now() - 600_000).toISOString(), janelaAte: new Date(Date.now() - 60_000).toISOString(), rodadaAuto: 1, alavancas: ["volume"], referenciaCitada: null, antes, resultado: "sem_resposta" };
  const [c] = await db.insert(schema.cotacao).values({ itemPedidoId: item!.id, fornecedorId: f!.id, contatoId: ct!.id, situacao: "respondeu", enviadaEm: new Date(), respondeuEm: new Date() }).returning();
  const [o] = await db
    .insert(schema.oferta)
    .values({ itemPedidoId: item!.id, fornecedorId: f!.id, cotacaoId: c!.id, itemOferecido: "Cimento CP II", itemExato: true, precoUnitario: "40", frete: "60", prazoDias: 3, validadeDias: 10, pagamento: "boleto 28 dias", prazoPagamentoDias: 28, formato: "texto", extraido: { negociacao: marca } })
    .returning();
  await db.update(schema.itemPedido).set({ estado: estado as never, ...(estado === "pedido_enviado" ? { fornecedorEscolhidoId: f!.id, ofertaEscolhidaId: o!.id } : {}) }).where(eq(schema.itemPedido.id, item!.id));
  const atual = async () => ({
    item: (await db.query.itemPedido.findFirst({ where: (t, { eq }) => eq(t.id, item!.id) }))!,
    pedido: (await db.query.pedido.findFirst({ where: (t, { eq }) => eq(t.id, ped.id) }))!,
    oferta: (await db.query.oferta.findFirst({ where: (t, { eq }) => eq(t.id, o!.id) }))!,
  });
  const aplicar = async (e: never, texto: string) => {
    const a = await atual();
    return m!.aplicarDescontoTardio(e, { contatoId: ct!.id, fornecedorId: f!.id, mensagemId: null, texto, oferta: a.oferta, item: a.item, pedido: a.pedido, marca: marca as never });
  };
  return { ct: ct!, comprador: comprador!, item: item!, atual, aplicar };
}

test("desconto depois do fechamento, mapa aberto: entra na proposta, com antes e depois, e o mapa é refeito", { skip: pular }, async () => {
  const { adaptador, enviadas } = m!.canalEmMemoria("web");
  m!.registrarCanal(adaptador);
  const { ct, aplicar, atual } = await descontoSemResposta("aguardando_decisao");
  assert.equal(await aplicar(leitura({ descontoPercentual: 5 }), "consigo 5% de desconto"), true);
  const { oferta, item } = await atual();
  assert.equal(Number(oferta.precoUnitario), 38);
  const n = (oferta.extraido as { negociacao: Record<string, unknown> }).negociacao;
  assert.equal(n.resultado, "desconto");
  assert.equal(n.tardia, true);
  assert.equal(n.produtoAntes, 1600);
  assert.equal(n.produtoDepois, 1520);
  assert.ok(n.respondidaEm);
  assert.equal(item.estado, "comparando"); // "reavaliar": o Comparador refaz o mapa
  const resposta = enviadas.filter((x) => x.endereco === ct.endereco).at(-1)!;
  assert.match(resposta.texto, /Obrigado pelo desconto! Registrei na sua proposta/);
  assert.ok(!enviadas.some((x) => /encerrad/.test(x.texto)));
});

test("desconto depois do fechamento, compra decidida: agradece sem 'encerrada' e avisa o comprador se é o escolhido", { skip: pular }, async () => {
  const { adaptador, enviadas } = m!.canalEmMemoria("web");
  m!.registrarCanal(adaptador);
  const { ct, comprador, aplicar, atual } = await descontoSemResposta("pedido_enviado");
  assert.equal(await aplicar(leitura({ descontoPercentual: 5 }), "faço 5%"), true);
  const { oferta, item } = await atual();
  assert.equal(Number(oferta.precoUnitario), 40); // nada muda depois de decidido
  assert.equal(item.estado, "pedido_enviado");
  const resposta = enviadas.filter((x) => x.endereco === ct.endereco).at(-1)!;
  assert.match(resposta.texto, /já foi decidida, então desta vez não consigo incluir o desconto\. Repassei ao comprador/);
  assert.doesNotMatch(resposta.texto, /encerrad/);
  assert.match(enviadas.filter((x) => x.endereco === comprador.endereco).at(-1)!.texto, /que você escolheu, ofereceu desconto depois de a compra ser decidida/);
});

test("depois do fechamento: 'não consigo' vira manteve; dúvida não é resposta ao desconto", { skip: pular }, async () => {
  const { adaptador, enviadas } = m!.canalEmMemoria("web");
  m!.registrarCanal(adaptador);
  const { ct, aplicar, atual } = await descontoSemResposta("aguardando_decisao");
  assert.equal(await aplicar(leitura({ classificacao: "duvida", duvida: "qual o CEP?" }), "qual o CEP?"), false);
  assert.equal(await aplicar(leitura({ classificacao: "recusa" }), "não consigo, já está no limite"), true);
  const { oferta, item } = await atual();
  const n = (oferta.extraido as { negociacao: Record<string, unknown> }).negociacao;
  assert.equal(n.resultado, "manteve");
  assert.equal(n.firme, true);
  assert.equal(item.estado, "aguardando_decisao"); // nada a refazer
  assert.equal(enviadas.filter((x) => x.endereco === ct.endereco).at(-1)!.texto, "Combinado, mantenho a proposta como está. Obrigado!");
});
