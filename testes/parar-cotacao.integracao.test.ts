// PARAR do fornecedor (Liria, erros_chat.md): com cotação aberta, sai só dela e continua recebendo
// as próximas; "encerrar contato" sai de vez; sem cotação aberta, PARAR sai de vez, como antes.
// Usa DATABASE_URL_TESTE e nenhuma IA.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;
else process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x";

const { ehEncerrarContato, ehPedidoDeParar } = await import("../src/nucleo/mensagens/parar.ts");

test("palavras: PARAR é pedido de parar; só as definitivas encerram o contato", () => {
  assert.ok(ehPedidoDeParar("PARAR"));
  assert.ok(!ehEncerrarContato("PARAR"));
  for (const t of ["Encerrar contato", "encerrar o contato", "descadastrar", "não quero mais receber"]) {
    assert.ok(ehPedidoDeParar(t), t);
    assert.ok(ehEncerrarContato(t), t);
  }
});

const m = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
      ...(await import("../src/fluxo/index.ts")),
      o: await import("../src/nucleo/orquestrador/index.ts"),
    }
  : null;

before(async () => {
  if (!m) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(m.db, { migrationsFolder: "drizzle" });
  m.registrarCanal(m.canalEmMemoria("simulado").adaptador);
  m.ligarFluxos();
});
after(async () => {
  if (m) await m.conexao.end();
});

async function fornecedorComCotacao(aberta: boolean) {
  const { db, schema } = m!;
  const { eq } = await import("drizzle-orm");
  const [f] = await db.insert(schema.fornecedor).values({ nome: `Parar ${crypto.randomUUID().slice(0, 6)}`, origem: "real" }).returning();
  const endereco = `forn-${crypto.randomUUID()}`;
  const [ct] = await db.insert(schema.contato).values({ canal: "simulado", endereco, papel: "fornecedor", fornecedorId: f!.id }).returning();
  const [comp] = await db.insert(schema.contato).values({ canal: "web", endereco: `comp-${crypto.randomUUID()}`, papel: "comprador" }).returning();
  const ped = await m!.o.abrirPedido({ compradorId: comp!.id, canalOrigem: "web", textoOriginal: "40 cp2" });
  const [item] = await m!.o.definirItens(db, ped.id, [{ descricao: "Cimento CP II", quantidade: 40, unidade: "saco" }]);
  if (aberta) await db.update(schema.itemPedido).set({ estado: "cotando", prazoRespostasEm: new Date(Date.now() + 15 * 60_000) }).where(eq(schema.itemPedido.id, item!.id));
  const [c] = await db.insert(schema.cotacao).values({ itemPedidoId: item!.id, fornecedorId: f!.id, contatoId: ct!.id, enviadaEm: new Date(), situacao: aberta ? "aguardando" : "encerrada" }).returning();
  return { f: f!, ct: ct!, endereco, cotacaoId: c!.id };
}

test("PARAR com cotação aberta: sai só dela, o contato continua ativo", { skip: pular }, async () => {
  const { db, schema } = m!;
  const { eq } = await import("drizzle-orm");
  const x = await fornecedorComCotacao(true);
  await m!.receber({ canal: "simulado", endereco: x.endereco, texto: "PARAR" });
  const [ct] = await db.select().from(schema.contato).where(eq(schema.contato.id, x.ct.id));
  assert.equal(ct!.parouEm, null);
  const [c] = await db.select().from(schema.cotacao).where(eq(schema.cotacao.id, x.cotacaoId));
  assert.equal(c!.situacao, "desistiu");
});

test("ENCERRAR CONTATO sai de vez, mesmo com cotação aberta; PARAR sem cotação aberta também", { skip: pular }, async () => {
  const { db, schema } = m!;
  const { eq } = await import("drizzle-orm");
  const a = await fornecedorComCotacao(true);
  await m!.receber({ canal: "simulado", endereco: a.endereco, texto: "Encerrar contato" });
  const [ca] = await db.select().from(schema.contato).where(eq(schema.contato.id, a.ct.id));
  assert.ok(ca!.parouEm);
  const b = await fornecedorComCotacao(false);
  await m!.receber({ canal: "simulado", endereco: b.endereco, texto: "PARAR" });
  const [cb] = await db.select().from(schema.contato).where(eq(schema.contato.id, b.ct.id));
  assert.ok(cb!.parouEm);
});

test("U1: o botão da forma de pagamento grava a preferência e mostra a confirmação de novo", { skip: pular }, async () => {
  const { db, schema } = m!;
  const { eq } = await import("drizzle-orm");
  const { adaptador, enviadas } = m!.canalEmMemoria("web");
  m!.registrarCanal(adaptador);
  const endereco = `pag-${crypto.randomUUID()}`;
  const [comp] = await db.insert(schema.contato).values({ canal: "web", endereco, papel: "comprador", avisoPrivacidadeEm: new Date() }).returning();
  const ped = await m!.o.abrirPedido({ compradorId: comp!.id, canalOrigem: "web", textoOriginal: "40 cp2" });
  await m!.o.definirItens(db, ped.id, [{ descricao: "Cimento CP II", quantidade: 40, unidade: "saco" }]);
  await m!.o.avancarPedido(ped.id, "interpretado", { agente: "Interpretador", motivo: "teste" });
  await m!.receber({ canal: "web", endereco, texto: "", botao: `pedido:${ped.id}:pag:2` });
  const [p] = await db.select().from(schema.pedido).where(eq(schema.pedido.id, ped.id));
  assert.equal(p!.pagamentoPreferido, "boleto 28 dias");
  const ultima = enviadas.filter((e) => e.endereco === endereco).at(-1)!;
  assert.match(ultima.texto, /Pagamento preferido: boleto 28 dias/);
  assert.ok(!ultima.opcoes.botoes?.some((b) => b.dado.includes(":pag:")), "com a forma escolhida, não pergunta de novo");
});

test("escolher atributo antes de confirmar e depois corrigir: a correção recria os itens sem travar", { skip: pular }, async () => {
  const { db, schema } = m!;
  const [comp] = await db.insert(schema.contato).values({ canal: "web", endereco: `fk-${crypto.randomUUID()}`, papel: "comprador" }).returning();
  const ped = await m!.o.abrirPedido({ compradorId: comp!.id, canalOrigem: "web", textoOriginal: "extintor" });
  await m!.o.definirItens(db, ped.id, [{ descricao: "Extintor", quantidade: 2, unidade: "unidade" }]);
  const { registrar } = await import("../src/nucleo/registro.ts");
  // O que escolherAtributo grava agora: só o pedido, com a ordem nos dados.
  await registrar(db, { agente: "Comprador", acao: "Informou Carga: 6 kg no item 1.", motivo: "teste", pedidoId: ped.id, dados: { ordem: 1 } });
  await m!.o.definirItens(db, ped.id, [{ descricao: "Extintor ABC 6 kg", quantidade: 2, unidade: "unidade" }]);
});
