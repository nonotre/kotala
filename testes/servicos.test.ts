// Cotação de serviços: unidade, escopo, prazo e local. Testes puros, sem banco e sem IA.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
const s = await import("../src/agentes/interpretador/servicos.ts");
const { limpar } = await import("../src/agentes/interpretador/index.ts");
const { posRegras, triagem } = await import("../src/agentes/guardrail/index.ts");
const { textoConfirmacao } = await import("../src/fluxo/comprador.ts");

test("unidade de serviço: h, diárias, visita, vb e mensal viram o nome da cotação", () => {
  assert.equal(s.unidadeDeServico("h"), "hora");
  assert.equal(s.unidadeDeServico("Horas"), "hora");
  assert.equal(s.unidadeDeServico("diárias"), "diária");
  assert.equal(s.unidadeDeServico("visita técnica"), "visita");
  assert.equal(s.unidadeDeServico("vb"), "serviço");
  assert.equal(s.unidadeDeServico("mensal"), "mês");
  assert.equal(s.unidadeDeServico("saco"), null);
  assert.equal(s.unidadeDeServico("unidade"), null);
});

test("é serviço pela unidade ou pelo nome; produto continua produto", () => {
  assert.ok(s.ehServico({ descricao: "Instalação de ar-condicionado split", unidade: "unidade" }));
  assert.ok(s.ehServico({ descricao: "Frete de 2 t de areia", unidade: "serviço" }));
  assert.ok(s.ehServico({ descricao: "Pedreiro", unidade: "diária" }));
  assert.ok(s.ehServico({ descricao: "Limpeza pós-obra", unidade: "serviço" }));
  assert.ok(!s.ehServico({ descricao: "Cimento CP II 50 kg", unidade: "saco" }));
  assert.ok(!s.ehServico({ descricao: "Limpador multiuso", unidade: "litro" }));
  assert.ok(s.soServicos([{ descricao: "Manutenção de portão", unidade: "visita" }]));
  assert.ok(!s.soServicos([{ descricao: "Manutenção de portão", unidade: "visita" }, { descricao: "Graxa", unidade: "kg" }]));
});

test("escopo: especificação Escopo, ou duas especificações", () => {
  assert.ok(s.temEscopo({ descricao: "Instalação de ar", especificacao: { Escopo: "3 aparelhos de 12.000 BTU" } }));
  assert.ok(s.temEscopo({ descricao: "Pintura", especificacao: [{ nome: "Área", valor: "80 m²" }, { nome: "Cor", valor: "branco" }] }));
  assert.ok(!s.temEscopo({ descricao: "Manutenção", especificacao: {} }));
});

test("perguntas do serviço: escopo de cada serviço e uma pergunta de prazo; produto não pergunta nada", () => {
  const p = s.perguntasDoServico([{ descricao: "Manutenção de ar-condicionado", unidade: "visita", especificacao: {} }], { prazoDias: null, prazoTexto: null });
  assert.equal(p.length, 2);
  assert.match(p[0]!, /^Manutenção de ar-condicionado: o que exatamente deve ser feito/);
  assert.equal(p[1], "Para quando precisa do serviço?");
  assert.deepEqual(s.perguntasDoServico([{ descricao: "Manutenção", unidade: "visita", especificacao: { Escopo: "6 aparelhos" } }], { prazoDias: 5, prazoTexto: "até sexta" }), []);
  assert.deepEqual(s.perguntasDoServico([{ descricao: "Cimento", unidade: "saco" }], { prazoDias: null, prazoTexto: null }), []);
  // A IA já perguntou o prazo: não repete.
  assert.deepEqual(s.perguntasDoServico([{ descricao: "Frete", unidade: "serviço", especificacao: { Escopo: "levar 2 t" } }], { prazoDias: null, prazoTexto: null }, ["Para quando precisa?"]), []);
});

const lido = (itens: object[], extra: object = {}) =>
  ({
    classe: "pedido",
    subtipo: null,
    motivo: "",
    opcoes: [],
    tentouMudarRegras: false,
    hostil: false,
    condicaoIrregular: null,
    itens,
    destino: null,
    cep: null,
    modoEntrega: null,
    janelaRecebimento: null,
    prazoTexto: null,
    prazoDias: null,
    urgencia: "normal",
    setor: null,
    entregas: null,
    faltando: [],
    suposicoes: [],
    ...extra,
  }) as Parameters<typeof limpar>[0];
const item = (descricao: string, quantidade: number, unidade: string, especificacao: { nome: string; valor: string }[] = []) => ({
  descricao,
  quantidade,
  unidade,
  especificacao,
  marca: null,
  marcaExigida: false,
  aceitaSimilar: null,
  risco: "nenhum",
  motivoRisco: null,
});

test("leitura: serviço é pedido; 'serviço' sem quantidade vira 1 serviço, sem pergunta de quantidade", () => {
  const i = limpar(lido([item("Limpeza pós-obra", 0, "serviço", [{ nome: "Escopo", valor: "casa de 120 m²" }])]));
  assert.ok(i.ehPedido);
  assert.equal(i.itens[0]!.quantidade, 1);
  assert.equal(i.itens[0]!.unidade, "serviço");
  assert.ok(!i.faltando.some((f) => /quant/i.test(f)));
  assert.match(i.suposicoes.join(), /1 serviço/);
});

test("leitura: horas sem quantidade perguntam 'Quantas horas'; 'h' vira hora", () => {
  const i = limpar(lido([item("Eletricista", 0, "h")]));
  assert.equal(i.itens[0]!.unidade, "hora");
  assert.ok(i.faltando.includes("Quantas horas de Eletricista?"), i.faltando.join(" | "));
});

test("guardrails: serviço proibido continua barrado; serviço comum passa", () => {
  const proibido = posRegras(limpar(lido([item("Serviço de nota fria", 1, "serviço")])), triagem("preciso de serviço de nota fria"));
  assert.equal(proibido.interpretacao.classe, "proibido");
  assert.equal(proibido.interpretacao.itens.length, 0);
  const comum = posRegras(limpar(lido([item("Instalação de ar-condicionado", 2, "serviço", [{ nome: "Escopo", valor: "2 splits" }])])), triagem("instalação de 2 ares"));
  assert.equal(comum.interpretacao.classe, "pedido");
  assert.ok(comum.interpretacao.ehPedido);
});

test("confirmação de pedido só de serviço: 'Local do serviço', escopo na linha e sem 'aceita similar'", () => {
  const t = textoConfirmacao({
    id: 7,
    itens: [{ descricao: "Instalação de ar-condicionado", quantidade: 2, unidade: "serviço", aceitaSimilar: true, especificacao: { Escopo: "2 splits de 12.000 BTU" } }],
    destino: "Rua A, 10",
    prazoTexto: "até sexta",
    prazoMaxDias: 4,
    urgencia: "normal",
    modoEntrega: null,
    janelaRecebimento: null,
    suposicoes: [],
    perguntas: [],
  });
  assert.match(t, /Local do serviço: Rua A, 10/);
  assert.match(t, /\(escopo: 2 splits de 12\.000 BTU\)/);
  assert.doesNotMatch(t, /aceita similar/);
});
