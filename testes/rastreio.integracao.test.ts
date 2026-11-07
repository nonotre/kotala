// Rastreio: auditoria por gatilho, estado em qualquer instante e linha do tempo. Usa DATABASE_URL_TESTE.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;

const m = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/rastreio.ts")),
      ...(await import("../src/nucleo/orquestrador/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
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

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("toda mudança fica na auditoria e o estado de qualquer instante pode ser reconstruído", { skip: pular }, async () => {
  const { eq } = await import("drizzle-orm");
  const r = await m!.receber({ canal: "simulado", endereco: `rastro-${crypto.randomUUID()}`, texto: "oi", idExterno: "1" });
  assert.equal(r.tipo, "recebida");
  const contatoId = r.tipo === "recebida" ? r.contato.id : "";
  const p = await m!.abrirPedido({ compradorId: contatoId, canalOrigem: "simulado", textoOriginal: "40 cp2" });
  const [item] = await m!.definirItens(m!.db, p.id, [{ descricao: "Cimento CP II", quantidade: 40, unidade: "saco" }]);

  await espera(20);
  const antesDaCorrecao = new Date();
  await espera(20);
  await m!.db.update(m!.schema.itemPedido).set({ quantidade: "50" }).where(eq(m!.schema.itemPedido.id, item!.id));
  await m!.avancarPedido(p.id, "interpretado", { agente: "Interpretador", motivo: "teste" }, { destino: "Obra Beta" });

  // Estado exato antes e depois
  assert.equal((await m!.estadoEm("item_pedido", item!.id, antesDaCorrecao))!.quantidade, 40);
  assert.equal((await m!.estadoEm("item_pedido", item!.id, new Date()))!.quantidade, 50);
  assert.equal((await m!.estadoEm("pedido", p.id, antesDaCorrecao))!.estado, "interpretando");
  assert.equal((await m!.estadoEm("pedido", p.id, new Date()))!.destino, "Obra Beta");

  // Linha apagada não se perde
  const [f] = await m!.db.insert(m!.schema.fornecedor).values({ nome: "Teste", origem: "simulado" }).returning();
  const [o] = await m!.db
    .insert(m!.schema.oferta)
    .values({ itemPedidoId: item!.id, fornecedorId: f!.id, itemOferecido: "Cimento", itemExato: true, precoUnitario: "39.90", formato: "texto" })
    .returning();
  await m!.db.delete(m!.schema.oferta).where(eq(m!.schema.oferta.id, o!.id));
  const hist = await m!.historicoDaLinha("oferta", o!.id);
  assert.deepEqual(hist.map((h) => h.operacao), ["INSERT", "DELETE"]);
  assert.equal((hist[1]!.antes as Record<string, unknown>).preco_unitario, 39.9);

  // A transição e a mudança de dados que ela fez dividem a mesma transação
  const linhas = await m!.linhaDoTempo(p.id);
  const ev = linhas.find((l) => l.tipo === "evento" && l.paraEstado === "aguardando_confirmacao");
  assert.ok(ev && ev.tipo === "evento");
  const dado = linhas.find((l) => l.tipo === "dado" && l.tabela === "pedido" && l.txid === ev.txid);
  assert.ok(dado && dado.tipo === "dado" && dado.mudancas.some((x) => x.campo === "estado" && x.para === "aguardando_confirmacao"));
  assert.ok(linhas.some((l) => l.tipo === "dado" && l.tabela === "oferta" && l.operacao === "DELETE"));
});
