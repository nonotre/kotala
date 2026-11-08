// Pendências do lado do fornecedor (junção da rodada 2), com banco: quem compra no pedido
// de compra; conferência de saída no convite; confirmação de preço pela cadência.
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
