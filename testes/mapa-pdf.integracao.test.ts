// Q1: o mapa vai ao comprador com o PDF anexado, gerado do mapa gravado (o mesmo que a
// tela baixa). Usa DATABASE_URL_TESTE e nenhuma IA (a justificativa cai no template).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;
process.env.GEMINI_API_KEY = "";
process.env.GEMINI_API_KEY_RESERVA = "";
process.env.ARQUIVOS_DIR = mkdtempSync(join(tmpdir(), "kotala-mapa-pdf-"));

const mod = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
      ...(await import("../src/agentes/comparador/index.ts")),
      ...(await import("../src/agentes/comparador/pdf.ts")),
    }
  : null;

let enviadas: { endereco: string; texto: string; opcoes: { anexos?: { ref: string; nome?: string; mediaType: string }[]; botoes?: unknown[] } }[] = [];

before(async () => {
  if (!mod) return;
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(mod.db, { migrationsFolder: "drizzle" });
  const canal = mod.canalEmMemoria("telegram");
  enviadas = canal.enviadas;
  mod.registrarCanal(canal.adaptador);
  mod.ligarComparador();
});
beforeEach(async () => {
  if (!mod) return;
  enviadas.length = 0;
  await mod.conexao`truncate item_catalogo, auditoria, arquivo, evento, uso_ia, mensagem, mapa_cotacao, referencia_preco, oferta, cotacao, historico_compra, item_pedido, pedido, contato, usuario, fornecedor restart identity cascade`;
});
after(async () => {
  if (mod) await mod.conexao.end();
});

test("mapa pronto: o PDF vai anexado ao mapa, com as propostas e a recomendação", { skip: pular }, async () => {
  const m = mod!;
  const forn = [];
  for (const nome of ["Forn A", "Forn B", "Forn C", "Forn D"]) forn.push((await m.db.insert(m.schema.fornecedor).values({ nome, origem: "simulado" }).returning())[0]!.id);
  const r = await m.receber({ canal: "telegram", endereco: `c-${crypto.randomUUID()}`, texto: "oi" });
  const c = r.tipo === "recebida" ? r.contato : assert.fail();
  const p = await m.orquestrador.abrirPedido({ compradorId: c.id, canalOrigem: "telegram", textoOriginal: "40 cp2" });
  const [item] = await m.orquestrador.definirItens(m.db, p.id, [{ descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco" }]);
  const motivo = { agente: "Interpretador" as const, motivo: "teste" };
  await m.orquestrador.avancarPedido(p.id, "interpretado", motivo);
  await m.orquestrador.avancarPedido(p.id, "comprador_confirmou", { agente: "Comprador", motivo: "teste" });
  await m.orquestrador.avancarItem(item!.id, "busca_concluida", motivo);
  const cots = await m.db
    .insert(m.schema.cotacao)
    .values(forn.map((fornecedorId) => ({ itemPedidoId: item!.id, fornecedorId, rodada: 1, enviadaEm: new Date(), situacao: "respondeu" as const })))
    .returning();
  const precos = ["40", "41", "39", "30"];
  for (const [i, f] of forn.entries()) {
    await m.db.insert(m.schema.oferta).values({
      itemPedidoId: item!.id, fornecedorId: f, cotacaoId: cots[i]!.id, rodada: 1, itemOferecido: "Cimento CP II 50 kg", itemExato: true,
      precoUnitario: precos[i]!, frete: "50", prazoDias: 2, validadeDias: 7, impostosNaoInclusos: "inclusos", pagamento: "boleto 28 dias",
      prazoPagamentoDias: 28, entregaNoLocal: true, formato: "texto", extraido: i === 3 ? { alertas: ["sem_nota"] } : {},
    });
  }
  await m.orquestrador.avancarItem(item!.id, "encerrar_cotacao", { agente: "Cotador", motivo: "teste" });

  const mapa = enviadas.at(-1)!;
  assert.match(mapa.texto, /Mapa de cotação/);
  assert.ok(mapa.opcoes.botoes?.length, "o mapa leva os botões de decisão");
  const [pdf] = mapa.opcoes.anexos ?? [];
  assert.ok(pdf, "o mapa leva o PDF");
  assert.equal(pdf!.mediaType, "application/pdf");
  assert.equal(pdf!.nome, `mapa-pedido-${p.id}-cotacao-${item!.id}-rodada-1.pdf`);
  assert.ok(pdf!.ref.startsWith(process.env.ARQUIVOS_DIR!), "gravado na pasta de arquivos");
  assert.ok(existsSync(pdf!.ref));
  const t = readFileSync(pdf!.ref).toString("latin1").replace(/\\([()\\])/g, "$1");
  assert.match(t, /^%PDF-1\.4/);
  assert.match(t, new RegExp(`Pedido ${p.id} · cotação ${item!.id}`));
  assert.match(t, /Forn C \(simulado\) · recomendada/);
  assert.match(t, /Forn D \(simulado\) \(R\$\xa01\.250,00\): Preço sem nota fiscal/);
  assert.match(t, /3 de 4 recebidas \(4 fornecedores consultados\)/);

  // A tela baixa o mesmo conteúdo, do mesmo mapa gravado.
  const e = await m.entradaPdfDoItem(item!.id);
  assert.ok(e);
  assert.equal(e!.comparacao.vencedora?.oferta.fornecedorNome, "Forn C");
  assert.equal(await m.entradaPdfDoItem(999_999), null);
  // A mensagem gravada também guarda o anexo (a conversa da tela mostra o arquivo).
  const [msg] = await m.db.query.mensagem.findMany({ where: (t, { and, eq }) => and(eq(t.itemPedidoId, item!.id), eq(t.direcao, "saida")), orderBy: (t, { desc }) => [desc(t.criadoEm)], limit: 1 });
  assert.equal(msg!.anexos[0]?.nome, pdf!.nome);
});

test("e-mail do mapa: assunto de mapa e o PDF como anexo", { skip: pular }, async () => {
  const { adaptadorEmail } = await import("../src/canais/email.ts");
  const { writeFileSync } = await import("node:fs");
  process.env.EMAIL_PERMITIDOS = "comprador@empresa.exemplo";
  const caminho = join(process.env.ARQUIVOS_DIR!, "mapa-teste.pdf");
  writeFileSync(caminho, "%PDF-1.4\n%%EOF\n");
  const mandados: { subject: string; attachments?: { filename: string; contentType?: string }[] }[] = [];
  const email = adaptadorEmail({
    transporte: {
      async sendMail(m) {
        mandados.push(m);
        return { messageId: "x" };
      },
    },
  });
  await email.enviar("comprador@empresa.exemplo", "Mapa de cotação...", { pedidoId: 7, tipo: "aviso", anexos: [{ tipo: "pdf", mediaType: "application/pdf", ref: caminho, nome: "mapa-pedido-7-cotacao-9-rodada-1.pdf" }] });
  assert.match(mandados[0]!.subject, /^Mapa de cotação · pedido 7 · /);
  assert.equal(mandados[0]!.attachments?.[0]?.filename, "mapa-pedido-7-cotacao-9-rodada-1.pdf");
});
