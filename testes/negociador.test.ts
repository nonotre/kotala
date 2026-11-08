// I1 e X3: negociação automática e rodada do botão. Testes puros, sem banco e sem IA.
import assert from "node:assert/strict";
import { test } from "node:test";
import { proximoEstadoItem } from "../src/nucleo/orquestrador/estados.ts";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
import type { Alavanca, MarcaNegociacao } from "../src/agentes/negociador/index.ts";
const n = await import("../src/agentes/negociador/index.ts");
const { completarComAnterior } = await import("../src/fluxo/fornecedor.ts");

const item = { id: 12, quantidade: "40", unidade: "saco", descricao: "Cimento CP II" };
const T0 = new Date("2026-11-08T13:00:00Z");
const min = (m: number) => new Date(T0.getTime() + m * 60_000);

// ---------- Rodada do botão ----------

test("contraproposta do botão nunca cita valor nem nome de outro fornecedor", () => {
  const t = n.textoNegociacao("Loja Aurora Exemplo", item, { referencia: null }, "às 14:30");
  assert.match(t, /Olá, Loja Aurora Exemplo/);
  assert.match(t, /40 sacos de Cimento CP II \(cotação 12\)/);
  assert.match(t, /no preço, no frete, no prazo de entrega ou na condição de pagamento/);
  assert.match(t, /não precisa responder/);
  assert.match(t, /Respondo ao comprador até 14:30/);
  assert.doesNotMatch(t, /R\$/);
  assert.ok(n.validarTextoNegociacao(t, []).ok);
});

test("só a referência pública da internet pode ser citada, e a última rodada muda o texto", () => {
  const t = n.textoNegociacao("Depósito Perto Exemplo", item, { referencia: 38.9 }, null, { ultima: true });
  assert.match(t, /preço publicado na internet para este item está em R\$\s38,90 por saco/);
  assert.match(t, /última rodada/);
  assert.ok(n.validarTextoNegociacao(t, [38.9]).ok);
  assert.ok(!n.validarTextoNegociacao(t, []).ok);
});

const linha = (fornecedorId: string, custo: number, nota: number, online = false) =>
  ({ oferta: { fornecedorId, online } as never, custo, nota }) as Parameters<typeof n.escolherAlvos>[0][number];

test("botão do comprador inclui a mais barata; loja online e quem está no limite ficam de fora", () => {
  const validas = [linha("caro", 2000, 9), linha("barato", 1500, 5), linha("medio", 1800, 8), linha("outro", 1900, 7), linha("loja", 1400, 9, true)];
  assert.deepEqual(n.escolherAlvos(validas), ["barato", "caro", "medio"]);
  // "barato" disse que o preço está no limite: a mais barata das restantes entra primeiro.
  assert.deepEqual(n.escolherAlvos(validas, new Set(["barato"])), ["medio", "caro", "outro"]);
  assert.deepEqual(n.escolherAlvos([linha("loja", 1400, 9, true)]), []);
});

test("negociar e reavaliar só a partir da decisão do comprador", () => {
  assert.equal(proximoEstadoItem("aguardando_decisao", "negociar"), "cotando");
  assert.equal(proximoEstadoItem("aguardando_decisao", "reavaliar"), "comparando");
  assert.equal(proximoEstadoItem("cotando", "negociar"), null);
  assert.equal(proximoEstadoItem("confirmado", "reavaliar"), null);
  assert.equal(n.MAX_RODADAS, 3);
});

// ---------- Quando pedir desconto ----------

type Situacao = Parameters<typeof n.deveNegociar>[0];
const situacao = (s: Partial<Situacao> = {}): Situacao => ({
  temPreco: true,
  aConfirmar: false,
  alertas: 0,
  jaPedido: false,
  estadoItem: "cotando",
  prazoRespostasEm: min(15),
  inicio: T0,
  agora: min(2),
  itemExato: true,
  aceitaSimilar: false,
  prazoDias: 3,
  prazoMaxDias: 5,
  ...s,
});

test("pede desconto em proposta completa, com janela de 25% do prazo e no mínimo 5 min, sem passar do prazo", () => {
  const r = n.deveNegociar(situacao());
  assert.ok(r.ok);
  // Demo de 15 min: 25% seriam 3 min 45 s; a Ester pediu pelo menos 5 min, mais 2 de folga para o simulado.
  assert.equal(r.ok && r.janelaAte.getTime() - min(2).getTime(), 420_000);
  const fim = n.deveNegociar(situacao({ agora: min(13) }));
  assert.ok(fim.ok && fim.janelaAte.getTime() === min(15).getTime());
});

test("R13: pede desconto em qualquer ocasião, inclusive com pouco prazo restante", () => {
  // Antes: com menos de 10% do prazo não pedia. Agora pede, e a janela vai até o prazo.
  const r = n.deveNegociar(situacao({ agora: min(14.5) }));
  assert.ok(r.ok && r.janelaAte.getTime() === min(15).getTime());
});

test("não pede desconto: sem preço, a confirmar, alerta, já pedido, fechada, prazo vencido, portões", () => {
  const casos: [Partial<Situacao>, RegExp][] = [
    [{ temPreco: false }, /sem preço/],
    [{ aConfirmar: true }, /confirmar/],
    [{ alertas: 1 }, /alerta/],
    [{ jaPedido: true }, /já pedi/],
    [{ estadoItem: "comparando" }, /fechada/],
    [{ agora: min(15) }, /vencido/],
    [{ itemExato: false }, /equivalente/],
    [{ prazoDias: 9 }, /prazo do pedido/],
  ];
  for (const [s, motivo] of casos) {
    const r = n.deveNegociar(situacao(s));
    assert.ok(!r.ok, JSON.stringify(s));
    assert.match(!r.ok ? r.motivo : "", motivo);
  }
  // Item equivalente com aceite do comprador continua negociável.
  assert.ok(n.deveNegociar(situacao({ itemExato: false, aceitaSimilar: true })).ok);
});

// ---------- Texto do pedido ----------

test("alavancas verdadeiras, na ordem, no máximo 2", () => {
  assert.deepEqual(n.escolherAlavancas({ recompra: true, quantidade: 50, pagamento: "à vista", frete: 60, entregas: "em duas vezes" }), ["recompra", "volume"]);
  // R13: o padrão da empresa (à vista, no recebimento) é sempre alavanca, salvo preferência do comprador.
  assert.deepEqual(n.escolherAlavancas({ recompra: false, quantidade: 1, pagamento: "boleto 30 dias", frete: 60, entregas: null }), ["pagamento", "frete"]);
  assert.deepEqual(n.escolherAlavancas({ recompra: false, quantidade: 1, pagamento: "boleto 30 dias", pagamentoPreferido: "boleto 28 dias", frete: 60, entregas: null }), ["frete"]);
  assert.deepEqual(n.escolherAlavancas({ recompra: false, quantidade: 1, pagamento: null, pagamentoPreferido: "pix", frete: 0, entregas: "partes" }), ["entregas"]);
  assert.deepEqual(n.escolherAlavancas({ recompra: false, quantidade: 1, pagamento: null, frete: null, entregas: null }), ["pagamento"]);
});

test("R13: pagamento antecipado vira alavanca própria, a primeira, e pede o pagamento no recebimento", () => {
  for (const p of ["50% antecipado", "Pix adiantado", "sinal de 30% e o resto na entrega", "pagamento no ato do pedido", "entrada de 50%"]) {
    assert.ok(n.pagamentoAntecipado(p), p);
  }
  for (const p of ["à vista", "à vista na entrega", "boleto 28 dias", "pix na entrega", null]) assert.ok(!n.pagamentoAntecipado(p), String(p));
  const alavancas = n.escolherAlavancas({ recompra: true, quantidade: 50, pagamento: "50% antecipado", frete: 60, entregas: null });
  assert.deepEqual(alavancas, ["antecipado", "recompra"]);
  const m = n.montarNegociacao({ alavancas, quantidade: "50", unidade: "saco", frete: 60, referencia: null, janelaAte: min(5), agora: T0 });
  assert.ok(m.validado, m.motivos.join("; "));
  assert.match(m.texto, /^Por gentileza, conseguiria desconto na cotação\?/);
  assert.match(m.texto, /Nosso padrão é pagar à vista, no recebimento da mercadoria \(contra a nota fiscal\), e não antecipado/);
  assert.match(m.texto, /pagamento no recebimento\?/);
});

test("R13: alavanca de pagamento pede desconto pelo padrão à vista no recebimento, sem prometer", () => {
  const m = n.montarNegociacao({ alavancas: ["pagamento"], quantidade: "1", unidade: "un", frete: null, referencia: null, janelaAte: min(5), agora: T0 });
  assert.ok(m.validado, m.motivos.join("; "));
  assert.match(m.texto, /Nosso padrão é pagamento à vista, no recebimento da mercadoria \(contra a nota fiscal\): há desconto para essa condição\?/);
  assert.doesNotMatch(m.texto, /boleto/);
  // Prometer continua barrado.
  assert.ok(!n.validarTextoNegociacao("Pagamos à vista se fechar.", []).ok);
  assert.ok(!n.validarTextoNegociacao("Pagamos adiantado.", []).ok);
});

test("pedido de desconto: frase da Ester, alavancas, sem alavanca falsa e sem valor de fora", () => {
  const m = n.montarNegociacao({ alavancas: ["volume", "frete"], quantidade: "50", unidade: "saco", frete: 60, referencia: null, janelaAte: min(5), agora: T0 });
  assert.ok(m.validado);
  assert.match(m.texto, /^Por gentileza, conseguiria desconto na cotação\?/);
  assert.match(m.texto, /50 sacos de uma vez: há desconto por volume\?/);
  assert.match(m.texto, /O frete de R\$\s60,00 pode ser reduzido/);
  assert.match(m.texto, /a proposta continua valendo/);
  assert.match(m.texto, /Respondo ao comprador até \d\d:\d\d/);
  assert.doesNotMatch(m.texto, /já compramos com vocês/i);
  assert.doesNotMatch(m.texto, /entrega em partes/);
  assert.doesNotMatch(m.texto, /referência/);
  assert.deepEqual(n.valoresEmReais(m.texto), [60]);
});

test("referência pública só quando o preço do fornecedor está acima dela", () => {
  assert.equal(n.citarReferencia(40, 38.9), 38.9);
  assert.equal(n.citarReferencia(38.9, 38.9), null);
  assert.equal(n.citarReferencia(35, 38.9), null);
  assert.equal(n.citarReferencia(40, null), null);
  const m = n.montarNegociacao({ alavancas: [], quantidade: 40, unidade: "saco", frete: null, referencia: 38.9, janelaAte: min(5), agora: T0 });
  assert.match(m.texto, /internet para este item está em R\$\s38,90 por saco/);
});

test("o texto não recebe posição nem valor de outro fornecedor: o mesmo vale para o mais barato e o mais caro", () => {
  const base = { alavancas: ["volume"] as Alavanca[], quantidade: 40, unidade: "saco", frete: null, referencia: null, janelaAte: min(5), agora: T0 };
  const t = n.montarNegociacao(base).texto;
  assert.ok(n.validarTextoNegociacao(t, []).ok);
  assert.deepEqual(n.valoresEmReais(t), []);
});

test("validador: barra valor que não é da própria proposta nem a referência, e as palavras proibidas", () => {
  assert.deepEqual(n.valoresEmReais("de R$ 1.583,60 para R$ 38,9 e R$1500"), [1583.6, 38.9, 1500]);
  const vazou = n.validarTextoNegociacao("Outro fornecedor fez R$ 1.583,60. Consegue cobrir?", [60]);
  assert.ok(!vazou.ok);
  assert.ok(vazou.motivos.some((m) => /valor não permitido/.test(m)));
  assert.ok(vazou.motivos.some((m) => /outro fornecedor/.test(m)));
  for (const frase of ["Tem concorrente mais barato.", "Sua proposta está em primeiro lugar.", "Vamos fechar com você.", "Pagamos à vista.", "É a melhor oferta até agora."]) {
    assert.ok(!n.validarTextoNegociacao(frase, []).ok, frase);
  }
  assert.ok(n.validarTextoNegociacao("O frete de R$ 60,00 pode ser reduzido?", [60]).ok);
});

test("texto barrado cai na frase mínima", () => {
  // Unidade com palavra proibida (texto vindo do pedido) derruba o texto montado.
  const m = n.montarNegociacao({ alavancas: [], quantidade: 1, unidade: "unidade (mais barata)", frete: null, referencia: 10, janelaAte: min(5), agora: T0 });
  assert.equal(m.validado, false);
  assert.equal(m.texto, n.TEXTO_PEDIDO_DESCONTO);
});

// ---------- Resposta ao pedido ----------

const antes = { precoUnitario: 40, totalProduto: null, frete: 60, prazoDias: 3, pagamento: "boleto 28 dias", prazoPagamentoDias: 28, impostosValor: null };
const marca: MarcaNegociacao = { pedidaEm: T0.toISOString(), janelaAte: min(5).toISOString(), rodadaAuto: 1, alavancas: ["volume"], referenciaCitada: null, antes };

test("resultado em código: desconto, manteve, subiu e condicional", () => {
  const d = n.resultadoNegociacao(marca, { ...antes, precoUnitario: 38 }, 40, { agora: min(1) });
  assert.equal(d.resultado, "desconto");
  assert.equal(d.produtoAntes, 1600);
  assert.equal(d.produtoDepois, 1520);
  assert.equal(d.descontoProduto, 80);
  assert.equal(d.respondidaEm, min(1).toISOString());
  assert.deepEqual(d.antes, antes);
  assert.equal(n.resultadoNegociacao(marca, { ...antes, frete: 30 }, 40).resultado, "desconto");
  assert.equal(n.resultadoNegociacao(marca, antes, 40).resultado, "manteve");
  assert.equal(n.resultadoNegociacao(marca, { ...antes, precoUnitario: 41 }, 40).resultado, "subiu");
  const c = n.resultadoNegociacao(marca, antes, 40, { condicao: "3% se for à vista" });
  assert.equal(c.resultado, "condicional");
  assert.equal(c.condicao, "3% se for à vista");
  // A segunda mensagem mantém o primeiro horário de resposta e o "antes".
  const segunda = n.resultadoNegociacao(d, { ...antes, precoUnitario: 37 }, 40, { agora: min(3) });
  assert.equal(segunda.respondidaEm, min(1).toISOString());
  assert.equal(segunda.produtoAntes, 1600);
  assert.equal(segunda.descontoProduto, 120);
});

test("desconto condicionado, 'vou ver' e 'no limite' são lidos em código", () => {
  assert.match(n.descontoCondicional("Faço 3% se for à vista.") ?? "", /3%.*à vista/);
  assert.match(n.descontoCondicional("No pix consigo 5%") ?? "", /pix.*5%/i);
  assert.match(n.descontoCondicional("Acima de 100 sacos dou R$ 2 de desconto") ?? "", /acima de/i);
  assert.equal(n.descontoCondicional("Consigo 5% de desconto."), null);
  assert.ok(n.vaiResponderDepois("Vou ver com o gerente e já te falo"));
  assert.ok(!n.vaiResponderDepois("Não consigo desconto"));
  assert.ok(n.mantemFirme("Já está no limite, não tem como baixar"));
  assert.ok(!n.mantemFirme("Não consigo agora"));
});

test("desconto condicionado: o campo do Extrator manda e a regex é a reserva", () => {
  const sem = { descontoPercentual: null, descontoValor: null };
  // O campo pega condição que a regex não conhece ("pagando na entrega").
  assert.equal(n.condicaoDoDesconto({ descontoPercentual: 4, descontoValor: null, descontoCondicao: "pagando na entrega" }, "Dou 4% pagando na entrega"), "4% pagando na entrega");
  assert.match(n.condicaoDoDesconto({ descontoPercentual: null, descontoValor: 20, descontoCondicao: " no Pix " }, "tiro 20 no pix") ?? "", /^R\$\s20,00 no Pix$/);
  // Campo vazio: a regex de antes continua valendo.
  assert.match(n.condicaoDoDesconto({ descontoPercentual: 3, descontoValor: null, descontoCondicao: null }, "Faço 3% se for à vista.") ?? "", /3%.*à vista/);
  assert.match(n.condicaoDoDesconto({ descontoPercentual: 3, descontoValor: null }, "Faço 3% se for à vista.") ?? "", /3%.*à vista/);
  // Sem desconto, ou desconto sem condição: null.
  assert.equal(n.condicaoDoDesconto({ ...sem, descontoCondicao: "à vista" }, "à vista"), null);
  assert.equal(n.condicaoDoDesconto({ descontoPercentual: 5, descontoValor: null, descontoCondicao: null }, "Consigo 5% de desconto."), null);
});

test("desconto aplicado em código: percentual, valor no total e por unidade", () => {
  assert.deepEqual(n.aplicarDesconto({ precoUnitario: 40, totalProduto: null }, { descontoPercentual: 5, descontoValor: null }, 40), { precoUnitario: 38, totalProduto: 1520, descricao: "5% sobre o preço" });
  const v = n.aplicarDesconto({ precoUnitario: 40, totalProduto: null }, { descontoPercentual: null, descontoValor: 20 }, 40)!;
  assert.equal(v.totalProduto, 1580);
  const u = n.aplicarDesconto({ precoUnitario: 40, totalProduto: null }, { descontoPercentual: null, descontoValor: 2 }, 40, true)!;
  assert.equal(u.precoUnitario, 38);
  assert.equal(u.totalProduto, 1520);
  assert.equal(n.aplicarDesconto({ precoUnitario: 40, totalProduto: null }, { descontoPercentual: 100, descontoValor: null }, 40), null);
  assert.equal(n.aplicarDesconto({ precoUnitario: null, totalProduto: null }, { descontoPercentual: null, descontoValor: 20 }, 40), null);
  assert.ok(n.descontoPorUnidade("tiro R$ 2 no saco"));
  assert.ok(!n.descontoPorUnidade("tiro R$ 20"));
});

// ---------- completarComAnterior com a marca ----------

const anterior = {
  id: "o1",
  itemOferecido: "Cimento CP II",
  itemExato: true,
  precoUnitario: "40.00",
  totalProduto: null,
  quantidadeOfertada: null,
  unidadeOfertada: null,
  embalagem: null,
  frete: "60.00",
  impostosValor: null,
  impostosNaoInclusos: null,
  prazoDias: 3,
  validadeDias: 10,
  pagamento: "boleto 28 dias",
  prazoPagamentoDias: 28,
  entregaNoLocal: true,
  extraido: { negociacao: marca },
} as unknown as Parameters<typeof completarComAnterior>[1];

const vazia = {
  classificacao: "outro" as const, duvida: null, itemOferecido: null, itemExato: true, aderencia: "exato" as const, divergencias: [] as string[],
  leituraPreco: "unitario" as const, trechoPreco: null, alertas: [] as never[], descontoPercentual: null, descontoValor: null, precoUnitario: null,
  quantidadeOfertada: null, unidadeOfertada: null, embalagem: null, totalProduto: null, frete: null, impostosValor: null, impostosNaoInclusos: null,
  prazoDias: null, validadeDias: null, pagamento: null, prazoPagamentoDias: null, entregaNoLocal: null, cnpj: null,
};

test("'faço 5% a menos' sem preço novo: o código calcula, e a marca do desconto vai junto", () => {
  const r = completarComAnterior({ ...vazia, descontoPercentual: 5 }, anterior, { quantidade: 40 })!;
  assert.equal(r.classificacao, "proposta");
  assert.equal(r.precoUnitario, 38);
  assert.equal(r.totalProduto, 1520);
  assert.equal(r.frete, 60);
  assert.deepEqual(r.negociacao, marca);
});

test("desconto condicionado não muda o preço; preço novo vale mais que o percentual", () => {
  const c = completarComAnterior({ ...vazia, descontoPercentual: 3 }, anterior, { quantidade: 40, condicional: true })!;
  assert.equal(c.precoUnitario, 40);
  const p = completarComAnterior({ ...vazia, classificacao: "proposta", precoUnitario: 37, descontoPercentual: 5 }, anterior, { quantidade: 40 })!;
  assert.equal(p.precoUnitario, 37);
});
