// X2: contrato anual. Item confirmado com contrato vigente não vai à cotação: o comprador
// escolhe em dois toques pedir direto (o pedido de compra sai ao fornecedor do contrato)
// ou cotar mesmo assim. Usa DATABASE_URL_TESTE, sem IA e sem rede (busca em snapshot).
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;
process.env.GEMINI_API_KEY = "";
process.env.GEMINI_API_KEY_RESERVA = "";
process.env.SERPER_API_KEY = "";
process.env.BUSCA_MODO = "snapshot";

const mod = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
      ...(await import("../src/agentes/busca/index.ts")),
      ...(await import("../src/agentes/memoria/contrato.ts")),
      ...(await import("../src/fluxo/decisao.ts")),
    }
  : null;

type Enviada = { endereco: string; texto: string; opcoes: { botoes?: { rotulo: string; dado: string }[]; tipo?: string } };
let doComprador: Enviada[] = [];
let doFornecedor: Enviada[] = [];

before(async () => {
  if (!mod) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(mod.db, { migrationsFolder: "drizzle" });
  const tg = mod.canalEmMemoria("telegram");
  const sim = mod.canalEmMemoria("simulado");
  doComprador = tg.enviadas;
  doFornecedor = sim.enviadas;
  mod.registrarCanal(tg.adaptador);
  mod.registrarCanal(sim.adaptador);
  mod.ligarBusca();
  mod.ligarDecisao();
});
beforeEach(async () => {
  if (!mod) return;
  doComprador.length = 0;
  doFornecedor.length = 0;
  await mod.conexao`truncate contrato, item_catalogo, auditoria, arquivo, evento, uso_ia, mensagem, mapa_cotacao, referencia_preco, oferta, cotacao, historico_compra, item_pedido, pedido, contato, usuario, fornecedor restart identity cascade`;
});
after(async () => {
  if (mod) await mod.conexao.end();
});

const DIA = 24 * 3600_000;

async function fornecedorComCanal(nome: string, extra: Record<string, unknown> = {}) {
  const m = mod!;
  const [f] = await m.db.insert(m.schema.fornecedor).values({ nome, origem: "simulado", ...extra }).returning();
  const [c] = await m.db.insert(m.schema.contato).values({ canal: "simulado", endereco: `f-${crypto.randomUUID()}`, papel: "fornecedor", fornecedorId: f!.id }).returning();
  return { fornecedor: f!, contato: c! };
}

/** Pedido confirmado: o item entra em "buscando" e a busca (com o contrato) roda. */
async function pedidoConfirmado(item: { descricao: string; quantidade: number; unidade: string; itemChave?: string }) {
  const m = mod!;
  const r = await m.receber({ canal: "telegram", endereco: `c-${crypto.randomUUID()}`, texto: "oi" });
  const comprador = r.tipo === "recebida" ? r.contato : assert.fail();
  const p = await m.orquestrador.abrirPedido({ compradorId: comprador.id, canalOrigem: "telegram", textoOriginal: item.descricao });
  await m.db.update(m.schema.pedido).set({ destino: "Rua das Obras, 100", cep: "01310-100", modoEntrega: "entrega" }).where(eq(m.schema.pedido.id, p.id));
  const [i] = await m.orquestrador.definirItens(m.db, p.id, [item]);
  await m.orquestrador.avancarPedido(p.id, "interpretado", { agente: "Interpretador", motivo: "teste" });
  await m.orquestrador.avancarPedido(p.id, "comprador_confirmou", { agente: "Comprador", motivo: "teste" });
  return { comprador, pedidoId: p.id, itemId: i!.id };
}

const estado = async (itemId: number) => (await mod!.db.query.itemPedido.findFirst({ where: (t, { eq }) => eq(t.id, itemId) }))!.estado;
const eventos = (itemId: number) => mod!.db.query.evento.findMany({ where: (t, { eq }) => eq(t.itemPedidoId, itemId), orderBy: (t, { asc }) => [asc(t.criadoEm)] });

async function contratoVigente(fornecedorId: string, extra: Record<string, unknown> = {}) {
  const r = await mod!.criarContrato({
    itemChave: "ITM-0001",
    descricao: "Cimento CP II 50 kg",
    fornecedorId,
    precoUnitario: 36.5,
    unidade: "saco",
    inicio: new Date(Date.now() - 30 * DIA),
    fim: new Date(Date.now() + 300 * DIA),
    observacao: "boleto 28 dias, frete incluso",
    ...extra,
  });
  assert.ok(r.ok, r.ok ? "" : r.erro);
  return r.id;
}

test("contrato vigente: pergunta com dois toques e o pedido de compra vai ao fornecedor do contrato", { skip: pular }, async () => {
  const m = mod!;
  const { fornecedor: f, contato: cf } = await fornecedorComCanal("Cimenteira Contrato");
  const contratoId = await contratoVigente(f.id);
  const { comprador, pedidoId, itemId } = await pedidoConfirmado({ descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco", itemChave: "ITM-0001" });

  // Não foi à cotação: espera a escolha, sem cotação nem busca.
  assert.equal(await estado(itemId), "aguardando_recompra");
  assert.equal((await m.db.select().from(m.schema.cotacao).where(eq(m.schema.cotacao.itemPedidoId, itemId))).length, 0);
  const pergunta = doComprador.at(-1)!;
  assert.match(pergunta.texto, /Este item tem contrato com Cimenteira Contrato \(simulado\) até \d{2}\/\d{2}\/\d{4}, a R\$\s36,50 por saco: pedir direto\?/);
  assert.match(pergunta.texto, /40 sacos pelo preço do contrato: R\$\s1\.460,00 de produto/);
  assert.deepEqual(pergunta.opcoes.botoes?.map((b) => b.dado), [`item:${itemId}:contrato:${contratoId}`, `item:${itemId}:cotar_novo`]);
  assert.equal(await m.contratoPropostoAoItem(itemId), contratoId);

  // Primeiro toque: só pede a confirmação.
  await m.aoBotaoDoComprador(comprador, `item:${itemId}:contrato:${contratoId}`);
  assert.equal(await estado(itemId), "aguardando_recompra");
  assert.match(doComprador.at(-1)!.texto, /^Confirma pedir direto 40 sacos de Cimento CP II 50 kg a Cimenteira Contrato \(simulado\), pelo contrato vigente até/);
  assert.equal(doComprador.at(-1)!.opcoes.botoes?.[0]?.dado, `item:${itemId}:contrato_ok:${contratoId}`);

  // Segundo toque: aprova e o pedido de compra sai ao fornecedor do contrato.
  await m.aoBotaoDoComprador(comprador, `item:${itemId}:contrato_ok:${contratoId}`);
  assert.equal(await estado(itemId), "pedido_enviado");
  const pc = doFornecedor.at(-1)!;
  assert.equal(pc.endereco, cf.endereco);
  assert.equal(pc.opcoes.tipo, "pedido_compra");
  assert.match(pc.texto, /Pelo nosso contrato vigente até \d{2}\/\d{2}\/\d{4}: R\$\s36,50 por saco, total do produto R\$\s1\.460,00\./);
  assert.match(pc.texto, /Pagamento e frete: conforme o contrato \(boleto 28 dias, frete incluso\)\./);
  assert.doesNotMatch(pc.texto, /Mesmo preço da última compra/);
  assert.match(doComprador.at(-1)!.texto, new RegExp(`Pedido ${pedidoId}: mandei o pedido de compra a Cimenteira Contrato`));

  const [item] = await m.db.select().from(m.schema.itemPedido).where(eq(m.schema.itemPedido.id, itemId));
  const [o] = await m.db.select().from(m.schema.oferta).where(eq(m.schema.oferta.id, item!.ofertaEscolhidaId!));
  assert.equal(o!.precoUnitario, "36.50");
  assert.deepEqual(m.contratoDaOferta(o!)?.id, contratoId);

  // Confirmação do fornecedor fecha o item e entra no histórico.
  const contatoF = (await m.db.query.contato.findFirst({ where: (t, { eq }) => eq(t.id, cf.id) }))!;
  await m.aoRespostaDoVencedor({ ...contatoF, fornecedorId: f.id } as never, itemId, true);
  assert.equal(await estado(itemId), "confirmado");

  // Rastro: a proposta do contrato e o pedido direto.
  const ev = await eventos(itemId);
  assert.ok(ev.some((e) => e.paraEstado === "aguardando_recompra" && (e.dados as { tipo?: string }).tipo === "contrato" && /Achou contrato vigente/.test(e.acao)));
  assert.ok(ev.some((e) => (e.dados as { tipo?: string } | null)?.tipo === "contrato_pedido" && e.acao === "Pediu direto pelo contrato com Cimenteira Contrato."));
});

test("cotar mesmo assim segue a cotação normal, sem propor o contrato de novo", { skip: pular }, async () => {
  const m = mod!;
  const { fornecedor: f } = await fornecedorComCanal("Cimenteira Contrato");
  await fornecedorComCanal("Outro Depósito");
  await contratoVigente(f.id);
  const { comprador, itemId } = await pedidoConfirmado({ descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco", itemChave: "ITM-0001" });
  assert.equal(await estado(itemId), "aguardando_recompra");

  await m.aoBotaoDoComprador(comprador, `item:${itemId}:cotar_novo`);
  assert.equal(await estado(itemId), "cotando");
  const cotacoes = await m.db.select().from(m.schema.cotacao).where(eq(m.schema.cotacao.itemPedidoId, itemId));
  assert.equal(cotacoes.length, 2, "cota com todos, inclusive o do contrato");
  const ev = await eventos(itemId);
  assert.ok(ev.some((e) => e.acao === "Preferiu cotar mesmo com contrato vigente." && (e.dados as { tipo?: string }).tipo === "contrato_recusado"));
  assert.equal(ev.filter((e) => (e.dados as { tipo?: string } | null)?.tipo === "contrato").length, 1);
});

test("fornecedor do contrato não atende: o item volta a ser cotado e o contrato continua", { skip: pular }, async () => {
  const m = mod!;
  const { fornecedor: f, contato: cf } = await fornecedorComCanal("Cimenteira Contrato");
  const contratoId = await contratoVigente(f.id);
  const { comprador, itemId } = await pedidoConfirmado({ descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco", itemChave: "ITM-0001" });
  await m.aoBotaoDoComprador(comprador, `item:${itemId}:contrato_ok:${contratoId}`);
  assert.equal(await estado(itemId), "pedido_enviado");

  const contatoF = (await m.db.query.contato.findFirst({ where: (t, { eq }) => eq(t.id, cf.id) }))!;
  await m.aoRespostaDoVencedor({ ...contatoF, fornecedorId: f.id } as never, itemId, false);
  assert.equal(await estado(itemId), "cotando");
  assert.ok(doComprador.some((x) => /não atende este pedido pelo contrato\. Vou cotar de novo/.test(x.texto)));
  const [c] = await m.db.select().from(m.schema.contrato).where(eq(m.schema.contrato.id, contratoId));
  assert.equal(c!.ativo, true);
});

test("contrato que não serve (fornecedor bloqueado ou outra unidade) fica no rastro e a cotação segue", { skip: pular }, async () => {
  const m = mod!;
  const { fornecedor: f } = await fornecedorComCanal("Cimenteira Contrato");
  await contratoVigente(f.id);
  await m.db.update(m.schema.fornecedor).set({ bloqueadoEm: new Date(), motivoBloqueio: "atrasou sem avisar" }).where(eq(m.schema.fornecedor.id, f.id));
  await fornecedorComCanal("Outro Depósito");
  const { itemId } = await pedidoConfirmado({ descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco", itemChave: "ITM-0001" });
  assert.equal(await estado(itemId), "cotando");
  assert.ok(doComprador.some((x) => /tem contrato com Cimenteira Contrato até .*, mas Cimenteira Contrato está bloqueado pela empresa \(atrasou sem avisar\)\. Vou cotar normalmente\./.test(x.texto)));
  const ev = await eventos(itemId);
  assert.ok(ev.some((e) => (e.dados as { tipo?: string } | null)?.tipo === "contrato_indisponivel"));

  // Outra unidade (tonelada contra saco): também não serve.
  const { fornecedor: g } = await fornecedorComCanal("Areal Contrato");
  await m.criarContrato({ itemChave: "ITM-0002", descricao: "Areia média", fornecedorId: g.id, precoUnitario: 120, unidade: "tonelada", inicio: new Date(Date.now() - DIA), fim: new Date(Date.now() + 100 * DIA) });
  const outro = await pedidoConfirmado({ descricao: "Areia média", quantidade: 2, unidade: "m³", itemChave: "ITM-0002" });
  assert.notEqual(await estado(outro.itemId), "aguardando_recompra");
  assert.ok(doComprador.some((x) => /o contrato é por tonelada e o pedido, por m³/.test(x.texto)));
});

test("tela Contratos: cria com as conferências, lista pela situação e encerra", { skip: pular }, async () => {
  const m = mod!;
  const { fornecedor: f } = await fornecedorComCanal("Cimenteira Contrato");
  const [u] = await m.db.insert(m.schema.usuario).values({ nome: "Ester", login: `ester-${crypto.randomUUID().slice(0, 8)}`, senhaHash: "x" }).returning();
  const base = { itemChave: "ITM-0001", descricao: "Cimento CP II 50 kg", fornecedorId: f.id, precoUnitario: 36.5, unidade: "saco", inicio: new Date(Date.now() - DIA), fim: new Date(Date.now() + 300 * DIA), criadoPor: u!.id };

  assert.deepEqual(await m.criarContrato({ ...base, precoUnitario: 0 }), { ok: false, erro: "O preço unitário precisa ser maior que zero." });
  assert.deepEqual(await m.criarContrato({ ...base, fim: base.inicio }), { ok: false, erro: "O fim do contrato precisa ser depois do início." });
  assert.deepEqual(await m.criarContrato({ ...base, itemChave: " " }), { ok: false, erro: "Escolha o item do contrato." });
  const r = await m.criarContrato(base);
  assert.ok(r.ok);
  // Mesmo item com período que se sobrepõe: recusado.
  const dup = await m.criarContrato({ ...base, inicio: new Date(Date.now() + 100 * DIA), fim: new Date(Date.now() + 400 * DIA) });
  assert.ok(!dup.ok && /Já há contrato ativo de Cimento CP II 50 kg com Cimenteira Contrato/.test(dup.erro));
  // Outro item da base (outro código): pode.
  assert.ok((await m.criarContrato({ ...base, itemChave: "ITM-0003", descricao: "Cimento CP III 50 kg" })).ok);
  // Agendado (começa depois).
  assert.ok((await m.criarContrato({ ...base, itemChave: "ITM-0004", descricao: "Argamassa AC II 20 kg", inicio: new Date(Date.now() + 10 * DIA) })).ok);

  const lista = await m.listarContratos();
  assert.deepEqual(lista.map((c) => c.situacao), ["vigente", "vigente", "agendado"]);
  assert.equal(lista[0]!.criadoPor, "Ester");

  assert.ok((await m.encerrarContrato(r.ok ? r.id : "", u!.id, "renegociado")).ok);
  const depois = await m.listarContratos();
  assert.equal(depois.find((c) => c.id === (r.ok ? r.id : ""))!.situacao, "encerrado");
  const ev = await m.db.query.evento.findMany({ where: (t, { like }) => like(t.acao, "Encerrou o contrato%") });
  assert.equal(ev[0]!.motivo, "Encerrado na tela por Ester. Motivo: renegociado.");
  // Encerrado não vale mais para o item.
  const ver = await m.conferirContrato(r.ok ? r.id : "", { itemChave: "ITM-0001", descricao: "Cimento CP II 50 kg", unidade: "saco" });
  assert.deepEqual(ver, { tipo: "nao_vale", motivo: "o contrato foi encerrado" });
});
