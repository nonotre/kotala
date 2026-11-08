// Fronteira entre o Assistente (Frente 3) e os guardrails (Frente 4) no chat web: o que a triagem em
// código pega vai ao fluxo sem passar pelo modelo, e o dado pessoal do comprador não fica gravado.
// Nenhuma chamada de IA: os casos testados são os que a triagem resolve sozinha. Usa DATABASE_URL_TESTE.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;
else process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x";
process.env.GUARDRAIL_MODO_DEMO = "1";

const { paraCanalSemTelas } = await import("../src/assistente/roteador.ts");

test("fora do chat web, link relativo vira texto e botão de link sai; ação continua", () => {
  const r = paraCanalSemTelas("O [Pedido 12](/pedidos/12) está em cotação. Veja [o site](https://exemplo.com).", [
    { rotulo: "Abrir o pedido 12", dado: "link:/pedidos/12" },
    { rotulo: "Confirmar", dado: "pedido:12:confirmar" },
  ]);
  assert.equal(r.texto, 'O Pedido 12 está em cotação. Veja <a href="https://exemplo.com">o site</a>.');
  assert.equal(r.formato, "html");
  assert.equal(paraCanalSemTelas("**Total** R$ 10 <x>", []).texto, "<b>Total</b> R$ 10 &lt;x&gt;");
  assert.deepEqual(r.botoes, [{ rotulo: "Confirmar", dado: "pedido:12:confirmar" }]);
  assert.equal(paraCanalSemTelas("ok", [{ rotulo: "Ver", dado: "link:/avisos" }]).botoes, undefined);
});

const m = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
      ...(await import("../src/fluxo/index.ts")),
      ...(await import("../src/assistente/roteador.ts")),
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

test("chat web com o Assistente: lista dura vai ao guardrail do fluxo, e o CPF não fica gravado", { skip: pular }, async () => {
  const { db, schema } = m!;
  const { and, eq } = await import("drizzle-orm");
  const { adaptador, enviadas } = m!.canalEmMemoria("web");
  m!.registrarCanal(adaptador);
  m!.ligarFluxos();
  m!.ligarAssistente();

  const endereco = `fronteira-${crypto.randomUUID()}`;
  const r = await m!.receber({ canal: "web", endereco, texto: "meu cpf é 123.456.789-09, quero comprar cocaína" });
  assert.equal(r.tipo, "recebida");
  const minhas = enviadas.filter((e) => e.endereco === endereco);
  // Resposta do guardrail (com o botão de contestar), não do Assistente.
  assert.ok(minhas.some((e) => e.opcoes.botoes?.some((b) => b.dado.endsWith(":contestar"))), JSON.stringify(minhas));
  if (r.tipo !== "recebida") return;
  const [gravada] = await db.select().from(schema.mensagem).where(and(eq(schema.mensagem.contatoId, r.contato.id), eq(schema.mensagem.direcao, "entrada")));
  assert.ok(!gravada!.texto.includes("123.456.789-09"), gravada!.texto);
});

test("item fora da base ganha categoria pelas palavras; base vence a dedução; nada bate, null", async () => {
  const { categoriaDoItem } = await import("../src/agentes/busca/index.ts");
  assert.equal(categoriaDoItem({ itemChave: null, descricao: "Clips de papel nº 2/0" }), "Escritório e papelaria");
  assert.equal(categoriaDoItem({ itemChave: null, descricao: "Coisa estranha qualquer" }), null);
  assert.equal(categoriaDoItem({ itemChave: null, descricao: "Clips de papel", categoria: "Limpeza" }), "Limpeza", "a gravada vale mais");
});

test("aviso de conduta vai ao usuário gestor (Telegram antes do web), nunca ao próprio comprador", { skip: pular }, async () => {
  const { db, schema } = m!;
  const { contatosDosGestores } = await import("../src/agentes/guardrail/rastro.ts");
  const { eq } = await import("drizzle-orm");
  // Outros testes podem ter deixado gestores: começa sem nenhum.
  await db.update(schema.usuario).set({ papel: "comprador" }).where(eq(schema.usuario.papel, "gestor"));
  const antes = process.env.GESTOR_CONTATO_ID;
  process.env.GESTOR_CONTATO_ID = "";
  try {
    assert.deepEqual(await contatosDosGestores(), []);
    const [u] = await db.insert(schema.usuario).values({ login: `gestor-${crypto.randomUUID()}`, nome: "Gestora", papel: "gestor" }).returning();
    const [web] = await db.insert(schema.contato).values({ canal: "web", endereco: `g-web-${crypto.randomUUID()}`, papel: "comprador", usuarioId: u!.id }).returning();
    assert.deepEqual(await contatosDosGestores(), [web!.id]);
    const [tg] = await db.insert(schema.contato).values({ canal: "telegram", endereco: `g-tg-${crypto.randomUUID()}`, papel: "comprador", usuarioId: u!.id }).returning();
    assert.deepEqual(await contatosDosGestores(), [tg!.id]);
  } finally {
    process.env.GESTOR_CONTATO_ID = antes;
    await db.update(schema.usuario).set({ papel: "comprador" }).where(eq(schema.usuario.papel, "gestor"));
  }
});

test("pedido automático de desconto: duas mensagens juntas do mesmo fornecedor reservam uma vez só", { skip: pular }, async () => {
  const { db, schema } = m!;
  const { reservarPedidoDeDesconto } = await import("../src/agentes/negociador/index.ts");
  const o = await import("../src/nucleo/orquestrador/index.ts");
  const [comprador] = await db.insert(schema.contato).values({ canal: "web", endereco: `res-${crypto.randomUUID()}`, papel: "comprador" }).returning();
  const [f] = await db.insert(schema.fornecedor).values({ nome: `Reserva ${Date.now()}`, origem: "real" }).returning();
  const ped = await o.abrirPedido({ compradorId: comprador!.id, canalOrigem: "web", textoOriginal: "40 cp2" });
  const [item] = await o.definirItens(db, ped.id, [{ descricao: "Cimento CP II", quantidade: 40, unidade: "saco" }]);
  const r = await Promise.all([reservarPedidoDeDesconto(f!.id, item!.id, ped.id), reservarPedidoDeDesconto(f!.id, item!.id, ped.id), reservarPedidoDeDesconto(f!.id, item!.id, ped.id)]);
  assert.equal(r.filter(Boolean).length, 1);
  assert.equal(await reservarPedidoDeDesconto(f!.id, item!.id, ped.id), false);
});
