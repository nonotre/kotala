// I3: a busca automática prorroga o prazo e o envio aos fornecedores novos falha: o
// varredor tenta de novo (retentarEnvios) e, sem tentativas, desiste. Usa DATABASE_URL_TESTE.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";

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
    }
  : null;

/** Canal dos fornecedores: falha enquanto `fora` for true. */
let fora = false;
const entregues: string[] = [];

before(async () => {
  if (!mod) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(mod.db, { migrationsFolder: "drizzle" });
  mod.registrarCanal(mod.canalEmMemoria("web").adaptador);
  mod.registrarCanal({
    canal: "email",
    async enviar(endereco) {
      if (fora) throw new Error("canal fora do ar");
      entregues.push(endereco);
      return { idExterno: `ok-${entregues.length}` };
    },
  });
});
beforeEach(async () => {
  fora = false;
  entregues.length = 0;
  if (mod) await mod.conexao`truncate item_catalogo, auditoria, arquivo, evento, uso_ia, mensagem, mapa_cotacao, referencia_preco, oferta, cotacao, historico_compra, item_pedido, pedido, contato, usuario, fornecedor restart identity cascade`;
});
after(async () => {
  if (mod) await mod.conexao.end();
});

async function fornecedores(n: number) {
  const m = mod!;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [f] = await m.db.insert(m.schema.fornecedor).values({ nome: `Forn ${crypto.randomUUID().slice(0, 6)}`, origem: "real" }).returning();
    await m.db.insert(m.schema.contato).values({ canal: "email", endereco: `f-${crypto.randomUUID()}@exemplo.com`, papel: "fornecedor", fornecedorId: f!.id });
    ids.push(f!.id);
  }
  return ids;
}

async function itemCotando(consultados: string[]) {
  const m = mod!;
  const r = await m.receber({ canal: "web", endereco: `c-${crypto.randomUUID()}`, texto: "oi" });
  const c = r.tipo === "recebida" ? r.contato : assert.fail();
  const p = await m.orquestrador.abrirPedido({ compradorId: c.id, canalOrigem: "web", textoOriginal: "40 cp2" });
  const [item] = await m.orquestrador.definirItens(m.db, p.id, [{ descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco" }]);
  const motivo = { agente: "Interpretador" as const, motivo: "teste" };
  await m.orquestrador.avancarPedido(p.id, "interpretado", motivo);
  await m.orquestrador.avancarPedido(p.id, "comprador_confirmou", { agente: "Comprador", motivo: "teste" });
  await m.orquestrador.avancarItem(item!.id, "busca_concluida", motivo, { prazoRespostasEm: new Date(Date.now() - 1000) });
  await m.db.insert(m.schema.cotacao).values(consultados.map((fornecedorId) => ({ itemPedidoId: item!.id, fornecedorId, rodada: 1, enviadaEm: new Date() })));
  return item!.id;
}

const novasDe = async (id: number, consultado: string) =>
  (await mod!.db.select().from(mod!.schema.cotacao).where(eq(mod!.schema.cotacao.itemPedidoId, id))).filter((c) => c.fornecedorId !== consultado);
const estado = async (id: number) => (await mod!.db.query.itemPedido.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!.estado;
const daqui = (ms: number) => new Date(Date.now() + ms);

test("prorrogou e o envio falhou: o fornecedor novo fica esperando e o varredor manda depois", { skip: pular }, async () => {
  const [a] = await fornecedores(3);
  const id = await itemCotando([a!]);

  fora = true;
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "ampliou");
  let novas = await novasDe(id, a!);
  assert.equal(novas.length, 2);
  // Sem contato gravado: nem lembrete nem "cotação encerrada" a quem nunca recebeu.
  assert.ok(novas.every((c) => c.situacao === "aguardando" && c.enviadaEm === null && c.contatoId === null));
  assert.equal(await estado(id), "cotando");
  const ev = await mod!.db.query.evento.findMany({ where: (t, { eq }) => eq(t.itemPedidoId, id) });
  assert.ok(ev.some((e) => /tenta de novo/.test(e.acao)));

  // Antes de 1 minuto o varredor não mexe (o envio normal ainda pode estar rodando).
  fora = false;
  await mod!.retentarEnvios(new Date());
  assert.equal(entregues.length, 0);

  await mod!.retentarEnvios(daqui(61_000));
  novas = await novasDe(id, a!);
  assert.ok(novas.every((c) => c.situacao === "aguardando" && c.enviadaEm && c.contatoId));
  assert.equal(entregues.length, 2);
  const avisos = await mod!.db.query.mensagem.findMany({ where: (t, { and, eq }) => and(eq(t.itemPedidoId, id), eq(t.canal, "web"), eq(t.direcao, "saida")) });
  assert.ok(avisos.some((x) => /consegui mandar a cotação de Cimento CP II 50 kg a mais 2 fornecedores/.test(x.texto)));

  // Varrer de novo não reenvia.
  await mod!.retentarEnvios(daqui(122_000));
  assert.equal(entregues.length, 2);
});

test("três falhas seguidas: desiste, marca sem resposta e a cotação fecha", { skip: pular }, async () => {
  const [a] = await fornecedores(3);
  const id = await itemCotando([a!]);
  fora = true;
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "ampliou"); // 1ª falha
  await mod!.retentarEnvios(daqui(61_000)); // 2ª
  assert.ok((await novasDe(id, a!)).every((c) => c.situacao === "aguardando"));
  await mod!.retentarEnvios(daqui(122_000)); // 3ª: desiste
  assert.ok((await novasDe(id, a!)).every((c) => c.situacao === "sem_resposta"));
  // O consultado antes também não responde: com o prazo vencido, o fluxo normal fecha.
  await mod!.db.update(mod!.schema.cotacao).set({ situacao: "sem_resposta" }).where(eq(mod!.schema.cotacao.fornecedorId, a!));
  await mod!.encerrarSeTodosResponderam(id);
  assert.equal(await estado(id), "comparando");
});

test("sem tempo para responder: não tenta mais e o fornecedor sai como sem resposta", { skip: pular }, async () => {
  const [a] = await fornecedores(3);
  const id = await itemCotando([a!]);
  fora = true;
  assert.equal(await mod!.ampliarSeFaltarPropostas(id), "ampliou");
  fora = false;
  // Faltam 2 minutos para o prazo de 15: menos que 25% do prazo.
  await mod!.db.update(mod!.schema.itemPedido).set({ prazoRespostasEm: daqui(120_000 + 61_000) }).where(eq(mod!.schema.itemPedido.id, id));
  await mod!.retentarEnvios(daqui(61_000));
  assert.equal(entregues.length, 0);
  assert.ok((await novasDe(id, a!)).every((c) => c.situacao === "sem_resposta"));
});
