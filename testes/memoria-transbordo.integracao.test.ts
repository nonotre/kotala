// I5 (memória na conversa) e transbordo inteligente, com banco e sem IA. Usa DATABASE_URL_TESTE.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;
else process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta sem o banco de teste
// Nenhuma chamada de IA aqui.
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_API_KEY_RESERVA;

const m = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
      ...(await import("../src/nucleo/orquestrador/index.ts")),
      memoria: await import("../src/agentes/interpretador/memoria-conversa.ts"),
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

test("I5: memória junta as conversas da mesma conta, traz a compra fechada e nunca a de outra pessoa", { skip: pular }, async () => {
  const { db, schema } = m!;
  const { eq } = await import("drizzle-orm");
  const sufixo = crypto.randomUUID().slice(0, 8);
  const [conta] = await db.insert(schema.usuario).values({ login: `mem-${sufixo}`, nome: "Ana Memória" }).returning();
  const [web1] = await db.insert(schema.contato).values({ canal: "web", endereco: `w1-${sufixo}`, papel: "comprador", usuarioId: conta!.id }).returning();
  const [web2] = await db.insert(schema.contato).values({ canal: "web", endereco: `w2-${sufixo}`, papel: "comprador", usuarioId: conta!.id }).returning();
  const [outra] = await db.insert(schema.contato).values({ canal: "web", endereco: `o-${sufixo}`, papel: "comprador" }).returning();
  const [f] = await db.insert(schema.fornecedor).values({ nome: `Depósito Memória ${sufixo}`, origem: "simulado" }).returning();

  const antigo = await m!.abrirPedido({ compradorId: web1!.id, canalOrigem: "web", textoOriginal: "40 sacos de cimento" });
  const [it] = await m!.definirItens(db, antigo.id, [{ descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco" }]);
  await db.update(schema.pedido).set({ destino: "Obra Augusta", setor: "estrutura" }).where(eq(schema.pedido.id, antigo.id));
  await db.insert(schema.historicoCompra).values({ fornecedorId: f!.id, itemChave: "cimento-cp-ii-50-kg", descricao: "Cimento CP II 50 kg", precoUnitario: "38.50", quantidade: "40", data: new Date(), simulado: true, itemPedidoId: it!.id });
  const deOutra = await m!.abrirPedido({ compradorId: outra!.id, canalOrigem: "web", textoOriginal: "papel" });
  const atual = await m!.abrirPedido({ compradorId: web2!.id, canalOrigem: "web", textoOriginal: "manda o mesmo de ontem" });

  const mem = await m!.memoria.memoriaDoComprador(web2!.id, { excetoPedidoId: atual.id });
  const ids = mem.pedidos.map((p) => p.id);
  assert.ok(ids.includes(antigo.id), "o pedido da outra conversa da mesma conta entra");
  assert.ok(!ids.includes(atual.id), "o pedido atual fica de fora");
  assert.ok(!ids.includes(deOutra.id), "pedido de outra pessoa nunca entra");
  const p = mem.pedidos.find((x) => x.id === antigo.id)!;
  assert.equal(p.destino, "Obra Augusta");
  assert.deepEqual(p.itens.map((i) => [i.descricao, i.quantidade, i.unidade]), [["Cimento CP II 50 kg", 40, "saco"]]);
  assert.equal(p.compras[0]!.fornecedor, f!.nome);
});
