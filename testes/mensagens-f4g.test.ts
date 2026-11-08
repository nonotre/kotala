// U4 (cotação organizada), Q4 (atributos perguntados) e jargão por categoria no Interpretador.

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // os módulos exigem a variável; nada conecta aqui
const { htmlCotacao, textoCotacao } = await import("../src/agentes/cotador/index.ts");
const { atributosPerguntados, textoBoasVindas } = await import("../src/fluxo/comprador.ts");
const { detectarCategorias } = await import("../src/dominio/categorias.ts");
const { sistema } = await import("../src/agentes/interpretador/index.ts");

const dados = (item: Record<string, unknown> = {}, pedido: Record<string, unknown> = {}) =>
  ({
    item: { id: 12, rodada: 1, quantidade: "2", unidade: "unidade", descricao: "Extintor de incêndio", itemChave: "extintor", aceitaSimilar: true, especificacao: { Tipo: "Pó ABC", Capacidade: "6 kg" }, prazoRespostasEm: null, ...item },
    pedido: { id: 3, modoEntrega: "entrega", destino: "Rua A, 10", cep: "01310-100", janelaRecebimento: null, prazoTexto: "até sexta", entregas: null, ...pedido },
  }) as never;

test("cotação em HTML tem título, blocos e checklist; o texto simples continua legível", () => {
  const h = htmlCotacao(dados(), "Loja <X>").valor;
  assert.match(h, /<b>Cotação 12<\/b>/);
  assert.match(h, /<b>Item<\/b>\n2 unidades de Extintor de incêndio\n• Tipo: Pó ABC\n• Capacidade: 6 kg/);
  assert.match(h, /<b>Entrega e pagamento<\/b>\nEntrega: Rua A, 10, CEP 01310-100\nPrazo desejado: até sexta/);
  // R13: o padrão da empresa vai na cotação (à vista quer dizer no recebimento).
  assert.match(h, /Pagamento: à vista, no recebimento da mercadoria \(contra a nota fiscal\)/);
  assert.match(h, /<b>Por favor, responda<\/b>\n• Preço unitário.*\n• Frete.*\n• Prazo de entrega\n• Condição de pagamento\n• Validade da proposta/);
  assert.match(h, /Loja &lt;X&gt;/); // texto de fora escapado

  const t = textoCotacao(dados(), "Loja");
  assert.doesNotMatch(t, /<\/?b>/);
  assert.match(t, /^Olá, Loja! Sou o assistente automatizado/);
  assert.match(t, /Cotação 12 · sem compromisso de compra\./);
  assert.match(t, /• Capacidade: 6 kg/);
  assert.match(t, /Aceita equivalente \(outra marca, mesma especificação\): sim/);
});

test("cotação: nova rodada, retirada e sem especificação", () => {
  const t = textoCotacao(dados({ rodada: 2, especificacao: {}, aceitaSimilar: false }, { modoEntrega: "retirada" }), "Loja");
  assert.match(t, /Cotação 12 · nova rodada/);
  assert.match(t, /Retirada na loja/);
  assert.doesNotMatch(t, /Tipo|Item\n•/);
  assert.match(t, /: não/);
});

const extintor = { ordem: 1, descricao: "Extintor de incêndio", unidade: "unidade", quantidade: "2" };

test("Q4: pergunta o atributo que falta, com botões quando há opções", () => {
  const r = atributosPerguntados([{ ...extintor, especificacao: {} }], 0);
  assert.deepEqual(r.map((a) => a.chave), ["tipo", "capacidade", "norma"]);
  assert.deepEqual(r[0]!.opcoes, ["Pó ABC", "CO2", "Água"]);
  assert.equal(r[2]!.opcoes, undefined); // norma: só texto
  assert.match(r[0]!.pergunta, /^Extintor de incêndio: qual o tipo/);
});

test("Q4: não pergunta o que já está na especificação e respeita o teto de 3 perguntas", () => {
  const dito = atributosPerguntados([{ ...extintor, especificacao: { Tipo: "Pó ABC", Capacidade: "6 kg" } }], 0);
  assert.deepEqual(dito.map((a) => a.chave), ["norma"]);
  assert.equal(atributosPerguntados([{ ...extintor, especificacao: {} }], 2).length, 1);
  assert.equal(atributosPerguntados([{ ...extintor, especificacao: {} }], 3).length, 0);
  assert.equal(atributosPerguntados([{ ordem: 1, descricao: "Caneta azul", unidade: "caixa", quantidade: "1", especificacao: {} }], 0).length, 0);
});

test("Q4: a unidade fica com o Interpretador, não vira pergunta duplicada", () => {
  const r = atributosPerguntados([{ ordem: 1, descricao: "Areia média", unidade: "carrada", quantidade: "2", especificacao: {} }], 0);
  assert.equal(r.length, 0);
});

test("Interpretador: o jargão do prompt vem só das categorias do pedido", () => {
  const geral = sistema(new Date());
  const extintores = sistema(new Date(), []);
  assert.ok(extintores.length <= geral.length);
  const comAreia = sistema(new Date(), detectarCategorias("2 carradas de areia"));
  const semAreia = sistema(new Date(), detectarCategorias("2 extintores"));
  assert.match(comAreia, /pedrisco/);
  assert.doesNotMatch(semAreia, /pedrisco/);
});

test("boas-vindas usam o exemplo do nicho, com padrão neutro", () => {
  const antes = process.env.EMPRESA_NICHO;
  try {
    delete process.env.EMPRESA_NICHO;
    assert.match(textoBoasVindas(), /resmas de papel A4/);
    process.env.EMPRESA_NICHO = "agregados";
    assert.match(textoBoasVindas(), /carradas de areia/);
  } finally {
    if (antes === undefined) delete process.env.EMPRESA_NICHO;
    else process.env.EMPRESA_NICHO = antes;
  }
});
