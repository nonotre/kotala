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
      ...(await import("../src/fluxo/index.ts")),
      memoria: await import("../src/agentes/interpretador/memoria-conversa.ts"),
      tb: await import("../src/fluxo/transbordo.ts"),
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

/** Comprador e fornecedor no canal web, um item cotando com a proposta do fornecedor. */
async function cenario() {
  const { db, schema } = m!;
  const { eq } = await import("drizzle-orm");
  const sufixo = crypto.randomUUID().slice(0, 8);
  const [comprador] = await db.insert(schema.contato).values({ canal: "web", endereco: `tb-c-${sufixo}`, papel: "comprador", avisoPrivacidadeEm: new Date() }).returning();
  const [f] = await db.insert(schema.fornecedor).values({ nome: `Cerâmica Transbordo ${sufixo}`, origem: "real", categorias: ["Cimentícios"] }).returning();
  const [ct] = await db.insert(schema.contato).values({ canal: "web", endereco: `tb-f-${sufixo}`, papel: "fornecedor", fornecedorId: f!.id, avisoPrivacidadeEm: new Date() }).returning();
  const ped = await m!.abrirPedido({ compradorId: comprador!.id, canalOrigem: "web", textoOriginal: "40 cp2" });
  const [item] = await m!.definirItens(db, ped.id, [{ descricao: "Cimento CP II", quantidade: 40, unidade: "saco" }]);
  await db.update(schema.itemPedido).set({ estado: "cotando", prazoRespostasEm: new Date(Date.now() + 3600_000) }).where(eq(schema.itemPedido.id, item!.id));
  const [c] = await db.insert(schema.cotacao).values({ itemPedidoId: item!.id, fornecedorId: f!.id, contatoId: ct!.id, enviadaEm: new Date(), situacao: "respondeu", respondeuEm: new Date() }).returning();
  await db.insert(schema.oferta).values({ itemPedidoId: item!.id, fornecedorId: f!.id, cotacaoId: c!.id, itemOferecido: "Cimento CP II", itemExato: true, precoUnitario: "10", frete: "60", prazoDias: 3, validadeDias: 10, pagamento: "boleto", formato: "texto" });
  return { comprador: comprador!, f: f!, ct: ct!, item: item!, ped, cotacao: c! };
}

test("transbordo comprador → fornecedor: tenta, pede a mensagem, repassa pela cadência e traz a resposta", { skip: pular }, async () => {
  const { adaptador, enviadas } = m!.canalEmMemoria("web");
  m!.registrarCanal(adaptador);
  m!.ligarFluxos();
  const { comprador, f, ct, item } = await cenario();
  const doComprador = (texto: string) => m!.receber({ canal: "web", endereco: comprador.endereco, papel: "comprador", texto, idExterno: crypto.randomUUID() });
  const para = (endereco: string) => enviadas.filter((e) => e.endereco === endereco).at(-1)?.texto ?? "";

  // 1. Tenta resolver com o que já sabe da proposta.
  await doComprador("Preciso falar com o fornecedor sobre entregas parciais");
  assert.match(para(comprador.endereco), new RegExp(`Sobre ${f.nome} na cotação ${item.id}`));
  assert.match(para(comprador.endereco), /R\$\s10,00 por saco; frete R\$\s60,00; entrega em 3 dias/);
  const antesDoRecado = enviadas.filter((e) => e.endereco === ct.endereco).length;

  // 2. Insiste: pede a mensagem.
  await doComprador("Não resolveu o problema, preciso falar direto com o fornecedor.");
  assert.match(para(comprador.endereco), /Me mande a mensagem para/);
  assert.equal(await m!.tb.esperandoRecadoDoComprador(comprador.id), true);

  // 3. Recado com valor de outro fornecedor não sai; o estado continua.
  await doComprador("Outro fornecedor fez por R$ 8,00, cobre?");
  assert.match(para(comprador.endereco), /Não repassei: o recado tinha/);
  assert.equal(enviadas.filter((e) => e.endereco === ct.endereco).length, antesDoRecado);

  // 4. Recado limpo: vai ao fornecedor (sem pergunta pendente, sai na hora).
  await doComprador("Seria possível entrega parcial em 20 e depois em 30 dias?");
  assert.match(para(ct.endereco), new RegExp(`^Recado do comprador sobre a cotação ${item.id} \\(Cimento CP II\\): "Seria possível entrega parcial em 20 e depois em 30 dias\\?"`));
  assert.match(para(comprador.endereco), /Repassei a .*Trago a resposta/);
  assert.equal(await m!.tb.esperandoRecadoDoComprador(comprador.id), false);

  // 5. A resposta do fornecedor volta ao comprador, sem passar pela leitura da proposta.
  await m!.receber({ canal: "web", endereco: ct.endereco, papel: "fornecedor", texto: "Consigo sim, sem custo a mais.", idExterno: crypto.randomUUID() });
  assert.match(para(comprador.endereco), new RegExp(`resposta de ${f.nome} ao seu recado \\(cotação ${item.id}\\): "Consigo sim, sem custo a mais\\."`));
  assert.equal(para(ct.endereco), "Obrigado! Repassei ao comprador.");
});

test("transbordo: recado com pergunta pendente ao fornecedor espera a fila e sai uma vez", { skip: pular }, async () => {
  const { db, schema } = m!;
  const { adaptador, enviadas } = m!.canalEmMemoria("web");
  m!.registrarCanal(adaptador);
  m!.ligarFluxos();
  const { comprador, ct, item, cotacao } = await cenario();
  const { eq } = await import("drizzle-orm");
  // A cotação deste fornecedor volta a "aguardando": é uma pergunta aberta sem resposta.
  await db.update(schema.cotacao).set({ situacao: "aguardando" }).where(eq(schema.cotacao.id, cotacao.id));
  const doComprador = (texto: string) => m!.receber({ canal: "web", endereco: comprador.endereco, papel: "comprador", texto, idExterno: crypto.randomUUID() });
  await m!.tb.aoTransbordoDoComprador(comprador.id, "quero falar com o fornecedor", { insistiu: true });
  const n0 = enviadas.filter((e) => e.endereco === ct.endereco).length;
  await doComprador("Pode mandar em caixas menores?");
  assert.match(enviadas.filter((e) => e.endereco === comprador.endereco).at(-1)!.texto, /ainda tem uma pergunta nossa em aberto/);
  assert.equal(enviadas.filter((e) => e.endereco === ct.endereco).length, n0);

  // O fornecedor responde algo: a fila anda e o recado sai, uma vez só.
  await db.insert(schema.mensagem).values({ canal: "web", direcao: "entrada", contatoId: ct.id, texto: "segue a proposta", situacao: "recebida" });
  assert.equal(await m!.cad.despacharPerguntas(ct.id), true);
  assert.match(enviadas.filter((e) => e.endereco === ct.endereco).at(-1)!.texto, new RegExp(`^Recado do comprador sobre a cotação ${item.id}`));
  await db.insert(schema.mensagem).values({ canal: "web", direcao: "entrada", contatoId: ct.id, texto: "ok", situacao: "recebida" });
  assert.equal(await m!.cad.despacharPerguntas(ct.id), false);
});

test("transbordo fornecedor → comprador: tenta, pede a mensagem, repassa como dúvida e a resposta volta", { skip: pular }, async () => {
  const { db, schema } = m!;
  const { adaptador, enviadas } = m!.canalEmMemoria("web");
  m!.registrarCanal(adaptador);
  m!.ligarFluxos();
  const { comprador, f, ct, item, ped, cotacao } = await cenario();
  const { eq } = await import("drizzle-orm");
  const [it] = await db.select().from(schema.itemPedido).where(eq(schema.itemPedido.id, item.id));
  const [p] = await db.select().from(schema.pedido).where(eq(schema.pedido.id, ped.id));
  const l = { item: it!, pedido: p! };
  const para = (endereco: string) => enviadas.filter((e) => e.endereco === endereco).at(-1)?.texto ?? "";
  const avisosAoComprador = () => enviadas.filter((e) => e.endereco === comprador.endereco).length;

  // 1. Sem assunto: pergunta qual é, sem incomodar o comprador.
  const n0 = avisosAoComprador();
  await m!.tb.aoFornecedorPedirPessoa(cotacao, ct.id, "quero falar com alguém", l);
  assert.equal(para(ct.endereco), m!.tb.TEXTO_TENTATIVA_FORNECEDOR);
  assert.equal(avisosAoComprador(), n0);

  // 2. Insiste: pede a mensagem.
  await m!.tb.aoFornecedorPedirPessoa(cotacao, ct.id, "preciso falar com o comprador mesmo", l);
  assert.equal(para(ct.endereco), m!.tb.TEXTO_PEDIR_MENSAGEM_FORNECEDOR);

  // 3. A mensagem vai ao comprador como dúvida pendente.
  await m!.receber({ canal: "web", endereco: ct.endereco, papel: "fornecedor", texto: "Posso entregar em duas partes, 20 e 30 dias?", idExterno: crypto.randomUUID() });
  assert.match(para(comprador.endereco), new RegExp(`${f.nome} mandou um recado para você sobre a cotação ${item.id}: "Posso entregar em duas partes, 20 e 30 dias\\?"`));
  assert.match(para(ct.endereco), /Repassei ao comprador/);
  const [depois] = await db.select().from(schema.itemPedido).where(eq(schema.itemPedido.id, item.id));
  assert.equal(depois!.duvidaPendente?.pergunta, "Posso entregar em duas partes, 20 e 30 dias?");

  // 4. A resposta do comprador volta ao fornecedor pelo mecanismo da dúvida.
  await m!.receber({ canal: "web", endereco: comprador.endereco, papel: "comprador", texto: "Pode sim, sem problema", idExterno: crypto.randomUUID() });
  assert.match(para(ct.endereco), new RegExp(`^Resposta do comprador sobre a cotação ${item.id}: Pode sim, sem problema`));
});
