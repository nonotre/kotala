// Bloco 4: sessão no servidor (cookie), /vincular do Telegram, empresas e locais de entrega no banco,
// e "Só os meus" (quadro, lista e avisos por dono ou responsável). Usa DATABASE_URL_TESTE; sem IA.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;
else process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x";

const contas = await import("../src/contas.ts");
const { semSessao } = await import("../web/lib/sessao-cookie.ts");

const mod = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      comprador: await import("../src/fluxo/comprador.ts"),
      telas: await import("../web/lib/dados.ts"),
      avisos: await import("../web/lib/avisos.ts"),
      config: await import("../src/config.ts"),
    }
  : null;

before(async () => {
  if (!mod) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(mod.db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  if (mod) await mod.conexao`truncate local_entrega, empresa, sessao, item_catalogo, auditoria, arquivo, evento, uso_ia, mensagem, mapa_cotacao, referencia_preco, oferta, cotacao, historico_compra, item_pedido, pedido, contato, usuario, fornecedor restart identity cascade`;
});
after(async () => {
  if (mod) await mod.conexao.end();
});

const login = () => `b4-${crypto.randomUUID().slice(0, 8)}`;

async function conta(nome: string) {
  const r = await contas.criarConta({ login: login(), nome, senha: "senha-forte-123" });
  assert.ok(r.ok);
  return r.sessao;
}

// ---------- Sem banco ----------

test("proxy: sem sessão, tela vai para a entrada, API e ação recebem 401; /login segue", () => {
  assert.equal(semSessao("/login", "GET"), "seguir");
  assert.equal(semSessao("/login", "POST"), "seguir", "a ação de entrar é postada em /login");
  assert.equal(semSessao("/", "GET"), "entrar");
  assert.equal(semSessao("/pedidos/3", "HEAD"), "entrar");
  assert.equal(semSessao("/api/chat", "GET"), "recusar");
  assert.equal(semSessao("/chat", "POST"), "recusar", "ação de servidor sem sessão");
});

test("/vincular: lê o comando com ou sem @bot, normaliza o código e ignora o resto", () => {
  assert.equal(contas.lerComandoVincular("/vincular abcd-efgh"), "ABCDEFGH");
  assert.equal(contas.lerComandoVincular("  /vincular@kotala_bot  AB CD EF GH "), "ABCDEFGH");
  assert.equal(contas.lerComandoVincular("/vincular"), "");
  assert.equal(contas.lerComandoVincular("/VINCULAR x2"), "X2");
  assert.equal(contas.lerComandoVincular("quero vincular"), null);
  assert.equal(contas.lerComandoVincular("/vincularABC"), null);
  assert.equal(contas.lerComandoVincular("/start"), null);
});

test("validação de local e empresa: CEP com 8 números, nome e endereço obrigatórios", () => {
  assert.equal(contas.validarLocal({ apelido: "Sede", endereco: "Rua A, 1", cep: "01310-100" }).ok, true);
  assert.equal(contas.validarLocal({ apelido: " ", endereco: "Rua A, 1", cep: "01310-100" }).ok, false);
  assert.equal(contas.validarLocal({ apelido: "Sede", endereco: "", cep: "01310-100" }).ok, false);
  assert.equal(contas.validarLocal({ apelido: "Sede", endereco: "Rua A, 1", cep: "1310100" }).ok, false);
  assert.equal(contas.validarEmpresa({ nome: "" }).ok, false);
  assert.equal(contas.validarEmpresa({ nome: "Filial", cepFaturamento: "123" }).ok, false);
  const v = contas.validarEmpresa({ nome: " Filial ", cnpj: "" });
  assert.ok(v.ok && v.dados.nome === "Filial" && v.dados.cnpj === null, "vazio vira null");
});

// ---------- Sessão ----------

test("sessão: vale até vencer, é de quem entrou e some ao sair", { skip: pular }, async () => {
  const u = await conta("Sessão Teste");
  const s = await contas.criarSessao(u.id);
  assert.ok(s.expiraEm.getTime() > Date.now() + contas.DURACAO_SESSAO_MS - 60_000);
  assert.equal((await contas.usuarioDaSessao(s.id))?.id, u.id);
  assert.equal(await contas.usuarioDaSessao(crypto.randomUUID()), null, "id inventado não vale");
  assert.equal(await contas.usuarioDaSessao("não é uuid"), null);
  assert.equal(await contas.usuarioDaSessao(undefined), null);

  // Vencida: não vale, e a próxima entrada a apaga.
  const { db, schema } = mod!;
  const { eq } = await import("drizzle-orm");
  const velha = await contas.criarSessao(u.id);
  await db.update(schema.sessao).set({ expiraEm: new Date(Date.now() - 1000) }).where(eq(schema.sessao.id, velha.id));
  assert.equal(await contas.usuarioDaSessao(velha.id), null);
  await contas.criarSessao(u.id);
  assert.equal((await db.select().from(schema.sessao).where(eq(schema.sessao.id, velha.id))).length, 0, "vencida apagada");

  await contas.apagarSessao(s.id);
  assert.equal(await contas.usuarioDaSessao(s.id), null);
});

test("conversa só do dono: endereço web e contato de outra pessoa não passam", { skip: pular }, async () => {
  const ana = await conta("Ana");
  const beto = await conta("Beto");
  assert.equal(await contas.enderecoWebDoUsuario(ana.id, ana.id), true, "o chat principal da Ana é o id dela");
  assert.equal(await contas.enderecoWebDoUsuario(beto.id, ana.id), false);
  assert.equal(await contas.enderecoWebDoUsuario(`terminal-${crypto.randomUUID()}`, ana.id), false, "endereço sem dono");
  const nova = await contas.novaConversaWeb(ana);
  assert.equal(await contas.contatoDoUsuario(nova, ana.id), true);
  assert.equal(await contas.contatoDoUsuario(nova, beto.id), false);
});

// ---------- /vincular ----------

test("/vincular: o código liga o Telegram à conta, uma vez só, e o novo invalida o anterior", { skip: pular }, async () => {
  const u = await conta("Liga Telegram");
  const primeiro = await contas.gerarCodigoVinculo(u.id);
  assert.match(primeiro.codigo, /^[A-HJ-NP-Z2-9]{8}$/);
  const segundo = await contas.gerarCodigoVinculo(u.id);
  assert.equal((await contas.vincularTelegram({ endereco: "comprador:111", codigo: primeiro.codigo })).ok, false, "o anterior deixou de valer");

  // Primeira mensagem do chat: o contato nasce já ligado.
  const r = await contas.vincularTelegram({ endereco: "comprador:111", nome: "Fulana", codigo: segundo.codigo.toLowerCase() });
  assert.deepEqual(r, { ok: true, nome: "Liga Telegram" });
  const canais = await contas.contatosDoUsuario(u.id);
  assert.ok(canais.some((c) => c.canal === "telegram" && c.papel === "comprador"));
  assert.equal((await contas.vincularTelegram({ endereco: "comprador:222", codigo: segundo.codigo })).ok, false, "código gasto");
});

test("/vincular: contato que já existia ganha o dono; código vencido não liga", { skip: pular }, async () => {
  const { db, schema } = mod!;
  const { and, eq } = await import("drizzle-orm");
  const [c] = await db.insert(schema.contato).values({ canal: "telegram", endereco: "comprador:333", papel: "comprador", nome: "Antigo" }).returning();
  const u = await conta("Dona Nova");
  const vencido = await contas.gerarCodigoVinculo(u.id);
  await db.update(schema.usuario).set({ codigoVinculoExpiraEm: new Date(Date.now() - 1000) }).where(eq(schema.usuario.id, u.id));
  assert.equal((await contas.vincularTelegram({ endereco: "comprador:333", codigo: vencido.codigo })).ok, false);

  const valido = await contas.gerarCodigoVinculo(u.id);
  assert.ok((await contas.vincularTelegram({ endereco: "comprador:333", codigo: valido.codigo })).ok);
  const [depois] = await db.select().from(schema.contato).where(and(eq(schema.contato.canal, "telegram"), eq(schema.contato.endereco, "comprador:333")));
  assert.equal(depois?.id, c!.id, "mesmo contato, sem duplicar");
  assert.equal(depois?.usuarioId, u.id);
  assert.equal(depois?.nome, "Antigo", "o nome do contato fica");
});

test("primeiro contato de Telegram sem conta recebe a oferta do /vincular; com conta ou no site, não", { skip: pular }, () => {
  const { textoAvisoPrivacidade, AVISO_PRIVACIDADE } = mod!.comprador;
  assert.ok(textoAvisoPrivacidade({ canal: "telegram", usuarioId: null }).includes("/vincular"));
  assert.equal(textoAvisoPrivacidade({ canal: "telegram", usuarioId: crypto.randomUUID() }), AVISO_PRIVACIDADE);
  assert.equal(textoAvisoPrivacidade({ canal: "web", usuarioId: null }), AVISO_PRIVACIDADE);
});

// ---------- Empresas e locais ----------

test("banco vazio: a empresa padrão nasce de EMPRESA, com o endereço de antes como local padrão", { skip: pular }, async () => {
  const { EMPRESA } = mod!.config;
  const [id1, id2] = await Promise.all([contas.garantirEmpresaPadrao(), contas.garantirEmpresaPadrao()]);
  assert.equal(id1, id2, "duas chamadas juntas não criam duas empresas");
  const empresas = await contas.listarEmpresas();
  assert.equal(empresas.length, 1);
  assert.equal(empresas[0]!.nome, EMPRESA.nome);
  assert.equal(empresas[0]!.cnpj, EMPRESA.cnpj);
  const locais = await contas.listarLocais(id1);
  assert.equal(locais.length, 1);
  assert.equal(locais[0]!.endereco, EMPRESA.enderecoEntrega);
  assert.equal(locais[0]!.cep, EMPRESA.cep);
  assert.equal(locais[0]!.padrao, true);

  // Quem entra sem empresa fica com a padrão.
  const u = await conta("Sem Empresa");
  assert.equal(await contas.empresaAtivaDe(u.id), id1);
});

test("locais: o primeiro é padrão, só um padrão por empresa, e remover o padrão passa para o mais antigo", { skip: pular }, async () => {
  const e = await contas.salvarEmpresa({ nome: "Filial Teste" });
  assert.ok(e.ok);
  const empresaId = e.empresa.id;
  const a = await contas.salvarLocal(empresaId, { apelido: "Depósito", endereco: "Rua A, 1", cep: "01000-000" });
  const b = await contas.salvarLocal(empresaId, { apelido: "Loja", endereco: "Rua B, 2", cep: "02000-000", janelaRecebimento: "sábado de manhã" });
  const c = await contas.salvarLocal(empresaId, { apelido: "Obra", endereco: "Rua C, 3", cep: "03000-000" });
  assert.ok(a.ok && b.ok && c.ok);
  assert.deepEqual([a.local.padrao, b.local.padrao, c.local.padrao], [true, false, false]);

  assert.ok((await contas.tornarLocalPadrao(empresaId, b.local.id)).ok);
  let locais = await contas.listarLocais(empresaId);
  assert.deepEqual(locais.filter((l) => l.padrao).map((l) => l.apelido), ["Loja"]);

  const outra = await contas.salvarEmpresa({ nome: "Outra" });
  assert.ok(outra.ok);
  assert.equal((await contas.tornarLocalPadrao(outra.empresa.id, a.local.id)).ok, false, "local de outra empresa");
  assert.equal((await contas.removerLocal(outra.empresa.id, a.local.id)).ok, false);

  const r = await contas.removerLocal(empresaId, b.local.id);
  assert.ok(r.ok && r.herdeiro?.apelido === "Depósito");
  locais = await contas.listarLocais(empresaId);
  assert.deepEqual(locais.map((l) => [l.apelido, l.padrao]), [["Depósito", true], ["Obra", false]]);

  const corrigido = await contas.salvarLocal(empresaId, { apelido: "Depósito Centro", endereco: "Rua A, 10", cep: "01000-001" }, a.local.id);
  assert.ok(corrigido.ok && corrigido.local.padrao, "corrigir não tira o padrão");
});

test("pedido sem destino: local padrão da empresa de quem pediu; sem conta ou sem local, nada (fica EMPRESA)", { skip: pular }, async () => {
  const { db, schema } = mod!;
  const { eq } = await import("drizzle-orm");
  const u = await conta("Compradora Local");
  const e = await contas.salvarEmpresa({ nome: "Empresa Local" });
  assert.ok(e.ok);
  const [web] = await db.select().from(schema.contato).where(eq(schema.contato.endereco, u.id));

  // Na empresa sem local nenhum: sem destino próprio.
  assert.ok((await contas.trocarEmpresaAtiva(u.id, e.empresa.id)).ok);
  assert.equal(await contas.localPadraoDoContato(web!.id), null);

  await contas.salvarLocal(e.empresa.id, { apelido: "Galpão", endereco: "Av. Galpão, 500", cep: "04000-000", janelaRecebimento: "das 7h às 15h" });
  assert.deepEqual(await contas.localPadraoDoContato(web!.id), { apelido: "Galpão", endereco: "Av. Galpão, 500", cep: "04000-000", janelaRecebimento: "das 7h às 15h" });

  const [solto] = await db.insert(schema.contato).values({ canal: "telegram", endereco: "comprador:999", papel: "comprador" }).returning();
  assert.equal(await contas.localPadraoDoContato(solto!.id), null, "contato sem conta");
  assert.equal((await contas.trocarEmpresaAtiva(u.id, crypto.randomUUID())).ok, false);
});

// ---------- Só os meus ----------

async function pedido(compradorId: string, estado: "aguardando_confirmacao" | "em_andamento" = "aguardando_confirmacao", responsavelId: string | null = null) {
  const m = mod!;
  const p = await m.orquestrador.abrirPedido({ compradorId, canalOrigem: "web", textoOriginal: "10 sacos de cimento" });
  await m.orquestrador.definirItens(m.db, p.id, [{ descricao: "Cimento CP II 50 kg", quantidade: 10, unidade: "saco" }]);
  const { eq } = await import("drizzle-orm");
  await m.db.update(m.schema.pedido).set({ estado, responsavelId }).where(eq(m.schema.pedido.id, p.id));
  return p.id;
}

test("só os meus: quadro, lista e avisos pelo dono, e o responsável trocado conta como dono", { skip: pular }, async () => {
  const { db, schema, telas, avisos } = mod!;
  const { eq } = await import("drizzle-orm");
  const ana = await conta("Ana Dona");
  const beto = await conta("Beto Dono");
  const [webAna] = await db.select().from(schema.contato).where(eq(schema.contato.endereco, ana.id));
  const [webBeto] = await db.select().from(schema.contato).where(eq(schema.contato.endereco, beto.id));
  const daAna = await pedido(webAna!.id);
  const doBeto = await pedido(webBeto!.id);
  const passadoParaAna = await pedido(webBeto!.id, "aguardando_confirmacao", ana.id);

  const idsQuadro = async (donoId?: string) => [...new Set(Object.values(await telas.quadro(false, donoId)).flat().map((c) => c.pedidoId))].sort();
  assert.deepEqual(await idsQuadro(ana.id), [daAna, passadoParaAna].sort());
  assert.deepEqual(await idsQuadro(beto.id), [doBeto]);
  assert.deepEqual(await idsQuadro(), [daAna, doBeto, passadoParaAna].sort(), "sem filtro, todos");

  assert.deepEqual((await telas.listaPedidos(ana.id)).map((p) => p.id).sort(), [daAna, passadoParaAna].sort());

  const deAna = await avisos.listarAvisos(ana.id);
  assert.deepEqual(deAna.map((a) => a.pedidoId).sort(), [daAna, passadoParaAna].sort());
  assert.equal(await avisos.contarAvisos(beto.id), 1);
  assert.equal(await avisos.contarAvisos(), 3, "sem pessoa, os de todos");
});
