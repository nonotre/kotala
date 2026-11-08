// Conferir o dono nos cenários (docs/perfil-login.md): pedido feito pelo chat web de um
// usuário aparece com o nome dele no Quadro, na Lista e no detalhe (consultas de web/lib/).
// Usa DATABASE_URL_TESTE; sem IA.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;

const mod = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
      contas: await import("../src/contas.ts"),
      telas: await import("../web/lib/dados.ts"),
    }
  : null;

before(async () => {
  if (!mod) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(mod.db, { migrationsFolder: "drizzle" });
  const { adaptador } = mod.canalEmMemoria("web");
  mod.registrarCanal(adaptador);
});
beforeEach(async () => {
  if (mod) await mod.conexao`truncate item_catalogo, auditoria, arquivo, evento, uso_ia, mensagem, mapa_cotacao, referencia_preco, oferta, cotacao, historico_compra, item_pedido, pedido, contato, usuario, fornecedor restart identity cascade`;
});
after(async () => {
  if (mod) await mod.conexao.end();
});

/** O que o chat web faz: a mensagem entra com o id do usuário como endereço; o pedido é aberto para esse contato. */
async function pedidoPeloChat(endereco: string, texto = "40 sacos de cimento cp2") {
  const m = mod!;
  const r = await m.receber({ canal: "web", endereco, idExterno: crypto.randomUUID(), texto: "oi" });
  const c = r.tipo === "recebida" ? r.contato : assert.fail(`mensagem não recebida: ${r.tipo}`);
  const p = await m.orquestrador.abrirPedido({ compradorId: c.id, canalOrigem: "web", textoOriginal: texto });
  await m.orquestrador.definirItens(m.db, p.id, [{ descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco" }]);
  return p.id;
}

const login = () => `harness-${crypto.randomUUID().slice(0, 8)}`;

test("pedido do chat web de um usuário aparece com o nome dele no Quadro, na Lista e no detalhe", { skip: pular }, async () => {
  const r = await mod!.contas.criarConta({ login: login(), nome: "Compradora Harness", senha: "senha-forte-123" });
  assert.ok(r.ok);
  const id = await pedidoPeloChat(r.sessao.id);

  const quadro = await mod!.telas.quadro();
  const cartoes = Object.values(quadro).flat().filter((c) => c.pedidoId === id);
  assert.ok(cartoes.length > 0);
  assert.ok(cartoes.every((c) => c.dono === "Compradora Harness"), JSON.stringify(cartoes.map((c) => c.dono)));
  const lista = await mod!.telas.listaPedidos();
  assert.equal(lista.find((p) => p.id === id)?.dono, "Compradora Harness");
  assert.equal((await mod!.telas.detalhePedido(id))?.dono, "Compradora Harness");
});

test("dois usuários: cada pedido com o seu dono; contato sem conta fica sem dono", { skip: pular }, async () => {
  const a = await mod!.contas.criarConta({ login: login(), nome: "Ana Harness", senha: "senha-forte-123" });
  const b = await mod!.contas.criarConta({ login: login(), nome: "Bia Harness", senha: "senha-forte-123" });
  assert.ok(a.ok && b.ok);
  const pa = await pedidoPeloChat(a.sessao.id);
  const pb = await pedidoPeloChat(b.sessao.id);
  const anonimo = await pedidoPeloChat(`terminal-${crypto.randomUUID()}`);
  const lista = await mod!.telas.listaPedidos();
  const dono = (id: number) => lista.find((p) => p.id === id)?.dono;
  assert.equal(dono(pa), "Ana Harness");
  assert.equal(dono(pb), "Bia Harness");
  assert.equal(dono(anonimo), null);
});

test("mensagem que chega antes do login: ao entrar, o contato é ligado e o pedido ganha o dono", { skip: pular }, async () => {
  // A conta existe, mas o contato web ainda não (criada à mão, sem senha, como a das usuárias da demo).
  const [u] = await mod!.db.insert(mod!.schema.usuario).values({ login: login(), nome: "Carla Harness" }).returning();
  const id = await pedidoPeloChat(u!.id);
  assert.equal((await mod!.telas.listaPedidos()).find((p) => p.id === id)?.dono, null);
  const r = await mod!.contas.entrar({ login: u!.login, senha: "senha-forte-123" });
  assert.ok(r.ok);
  assert.equal((await mod!.telas.listaPedidos()).find((p) => p.id === id)?.dono, "Carla Harness");
});
