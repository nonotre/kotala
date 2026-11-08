// Mapa montado do banco: lê oferta.extraido (guardrails, Q1, negociação), conta a busca
// automática e refaz o mapa trocando o anterior. Usa DATABASE_URL_TESTE e nenhuma IA
// (sem chave, a justificativa cai no template).
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";

const urlTeste = process.env.DATABASE_URL_TESTE;
const pular = urlTeste ? false : "defina DATABASE_URL_TESTE no .env";
if (urlTeste) process.env.DATABASE_URL = urlTeste;
process.env.GEMINI_API_KEY = "";
process.env.GEMINI_API_KEY_RESERVA = "";

const mod = urlTeste
  ? {
      ...(await import("../src/nucleo/index.ts")),
      ...(await import("../src/nucleo/mensagens/index.ts")),
      ...(await import("../src/agentes/comparador/index.ts")),
    }
  : null;

let enviadas: { endereco: string; texto: string; opcoes: { substitui?: string; botoes?: unknown[] } }[] = [];

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

/** Fornecedores simulados: a verificação de CNPJ (rede) não roda para eles. */
async function fornecedores(n: number) {
  const m = mod!;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [f] = await m.db.insert(m.schema.fornecedor).values({ nome: `Forn ${String.fromCharCode(65 + i)}`, origem: "simulado" }).returning();
    ids.push(f!.id);
  }
  return ids;
}

async function itemCotando(consultados: string[]) {
  const m = mod!;
  const r = await m.receber({ canal: "telegram", endereco: `c-${crypto.randomUUID()}`, texto: "oi" });
  const c = r.tipo === "recebida" ? r.contato : assert.fail();
  const p = await m.orquestrador.abrirPedido({ compradorId: c.id, canalOrigem: "telegram", textoOriginal: "40 cp2" });
  const [item] = await m.orquestrador.definirItens(m.db, p.id, [{ descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco" }]);
  const motivo = { agente: "Interpretador" as const, motivo: "teste" };
  await m.orquestrador.avancarPedido(p.id, "interpretado", motivo);
  await m.orquestrador.avancarPedido(p.id, "comprador_confirmou", { agente: "Comprador", motivo: "teste" });
  await m.orquestrador.avancarItem(item!.id, "busca_concluida", motivo);
  const cotacoes = await m.db
    .insert(m.schema.cotacao)
    .values(consultados.map((fornecedorId) => ({ itemPedidoId: item!.id, fornecedorId, rodada: 1, enviadaEm: new Date(), situacao: "respondeu" as const })))
    .returning();
  return { itemId: item!.id, cotacoes: new Map(cotacoes.map((x) => [x.fornecedorId, x.id])) };
}

async function proposta(itemId: number, fornecedorId: string, cotacaoId: string, extra: Partial<NonNullable<typeof mod>["schema"]["oferta"]["$inferInsert"]> = {}) {
  const m = mod!;
  await m.db.insert(m.schema.oferta).values({
    itemPedidoId: itemId, fornecedorId, cotacaoId, rodada: 1, itemOferecido: "Cimento CP II 50 kg", itemExato: true,
    precoUnitario: "40", frete: "50", prazoDias: 2, validadeDias: 7, impostosNaoInclusos: "inclusos",
    pagamento: "boleto 28 dias", prazoPagamentoDias: 28, entregaNoLocal: true, formato: "texto", ...extra,
  });
}

const antes = { precoUnitario: 40, totalProduto: null, frete: 50, prazoDias: 2, pagamento: "boleto 28 dias", prazoPagamentoDias: 28, impostosValor: null };

async function montar(itemId: number) {
  await mod!.orquestrador.avancarItem(itemId, "encerrar_cotacao", { agente: "Cotador", motivo: "teste" });
  const falhas = await mod!.db.query.evento.findMany({ where: (t, { and, eq, like }) => and(eq(t.itemPedidoId, itemId), like(t.acao, "Falhou%")) });
  assert.deepEqual(falhas.map((f) => f.motivo), []);
}

test("mapa lê extraido: desconto obtido, conduta, preço a confirmar e quem manteve", { skip: pular }, async () => {
  const m = mod!;
  const [a, b, c, d, e] = await fornecedores(5);
  const { itemId, cotacoes } = await itemCotando([a!, b!, c!, d!, e!]);
  // A: pediu desconto e baixou de 40 para 38 por saco.
  await proposta(itemId, a!, cotacoes.get(a!)!, {
    precoUnitario: "38",
    extraido: { negociacao: { pedidaEm: "2026-11-08T10:00:00Z", janelaAte: "2026-11-08T10:05:00Z", rodadaAuto: 1, alavancas: [], referenciaCitada: null, antes, resultado: "desconto", descontoFrete: 0 } },
  });
  // B: ofereceu comissão (fica, com alerta) e manteve o preço no desconto.
  await proposta(itemId, b!, cotacoes.get(b!)!, {
    precoUnitario: "41",
    extraido: { alertas: ["propina"], negociacao: { pedidaEm: "2026-11-08T10:00:00Z", janelaAte: "x", rodadaAuto: 1, alavancas: [], referenciaCitada: null, antes: { ...antes, precoUnitario: 41 }, resultado: "manteve" } },
  });
  // C: preço ambíguo (colunas vazias, número no extraido).
  await proposta(itemId, c!, cotacoes.get(c!)!, { precoUnitario: null, extraido: { aConfirmar: ["preco"], precoUnitario: 300, alertas: [] } });
  // D: sem nota fiscal: fora do ranking.
  await proposta(itemId, d!, cotacoes.get(d!)!, { precoUnitario: "30", extraido: { alertas: ["sem_nota"] } });
  // E: não respondeu ao desconto.
  await proposta(itemId, e!, cotacoes.get(e!)!, {
    precoUnitario: "42",
    extraido: { divergencias: ["marca Votoran, não exigida"], negociacao: { pedidaEm: "2026-11-08T10:00:00Z", janelaAte: "x", rodadaAuto: 1, alavancas: [], referenciaCitada: null, antes: { ...antes, precoUnitario: 42 }, resultado: "sem_resposta" } },
  });

  assert.equal(await m.contarPropostasValidas(itemId), 3);
  await montar(itemId);
  const mapa = enviadas.at(-1)!.texto;
  assert.match(mapa, /Desconto obtido: R\$\s80,00 \([\d,]+%\) · valor bruto R\$\s[\d.,]+ · com desconto R\$\s[\d.,]+/);
  assert.match(mapa, /Pedi desconto: manteve o preço/);
  assert.match(mapa, /Pedi desconto: não respondeu/);
  assert.match(mapa, /Atenção: Ofereceu comissão ou vantagem ao comprador/);
  assert.match(mapa, /Difere do pedido: marca Votoran, não exigida/);
  assert.match(mapa, /A confirmar com o fornecedor[^\n]*\n- Forn C \(simulado\): Preço a confirmar \(R\$\s300,00: por unidade ou total\?\)/);
  assert.match(mapa, /Fora da comparação:\n- Forn D \(simulado\): Preço sem nota fiscal/);
  assert.doesNotMatch(mapa, /Sem preço/);
});

test("busca automática aparece no mapa e o mapa refeito troca o anterior", { skip: pular }, async () => {
  const m = mod!;
  const [a, b, c, d] = await fornecedores(4);
  const { itemId, cotacoes } = await itemCotando([a!, b!, c!, d!]);
  for (const [f, preco] of [[a!, "40"], [b!, "41"], [c!, "39"]] as const) await proposta(itemId, f, cotacoes.get(f)!, { precoUnitario: preco });
  await m.db.update(m.schema.itemPedido).set({ ampliacoes: 1 }).where(eq(m.schema.itemPedido.id, itemId));
  await m.registrar(m.db, { agente: "Cotador", acao: "Ampliou a busca", motivo: "teste", itemPedidoId: itemId, fornecedorIds: [c!, d!], dados: { tipo: "ampliacao", rodada: 1, ampliacao: 1, validas: 2 } });

  await montar(itemId);
  const primeiro = enviadas.at(-1)!;
  assert.match(primeiro.texto, /Busca automática: consultei mais 2 fornecedores em 1 leva/);
  assert.ok(primeiro.opcoes.botoes?.length);

  // Tira C do mapa: o mapa é refeito, o anterior vira "substituído" (sem botões) e o novo diz o que mudou.
  const [item] = await m.db.select().from(m.schema.itemPedido).where(eq(m.schema.itemPedido.id, itemId));
  await m.orquestrador.avancarItem(itemId, "reavaliar", { agente: "Comprador", motivo: "teste" }, { excluidos: [...item!.excluidos, c!] });
  const depois = enviadas.slice(enviadas.indexOf(primeiro) + 1);
  const troca = depois.find((x) => x.opcoes.substitui);
  assert.ok(troca, "editou o mapa anterior");
  assert.match(troca!.texto, /Mapa substituído/);
  assert.ok(!troca!.opcoes.botoes?.length);
  const novo = depois.at(-1)!;
  assert.match(novo.texto, /Mapa atualizado: Forn C saiu/);
  assert.ok(novo.opcoes.botoes?.length);
  assert.ok(depois.indexOf(troca!) < depois.indexOf(novo), "troca antes do mapa novo");
});
