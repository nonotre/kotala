import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
const { limpar } = await import("../src/agentes/extrator/index.ts");
const { perguntaDeConfirmacao } = await import("../src/fluxo/fornecedor.ts");

const base = {
  classificacao: "proposta" as const, duvida: null, itemOferecido: "Cimento CP II 50 kg", aderencia: "exato" as const, divergencias: [] as string[],
  leituraPreco: "unitario" as const, trechoPreco: "R$ 300 cada", alertas: [] as never[], descontoPercentual: null, descontoValor: null,
  precoUnitario: null, quantidadeOfertada: null, unidadeOfertada: null, embalagem: null, totalProduto: null, frete: null, impostosValor: null,
  impostosNaoInclusos: null, prazoDias: null, validadeDias: null, pagamento: null, prazoPagamentoDias: null, entregaNoLocal: null, cnpj: null,
};
const pedido = { quantidade: 5 };

test("Q1: R$ 300 cada para 5 unidades é unitário e não pede confirmação", () => {
  const e = limpar({ ...base, precoUnitario: 300 }, pedido);
  assert.equal(e.leituraPreco, "unitario");
  assert.equal(e.aConfirmar, undefined);
});

test("Q1: total igual ao unitário com quantidade maior que 1 é ambíguo", () => {
  const e = limpar({ ...base, precoUnitario: 300, totalProduto: 300 }, pedido);
  assert.equal(e.leituraPreco, "ambiguo");
  assert.deepEqual(e.aConfirmar, ["preco"]);
});

test("Q1: unitário vezes quantidade divergindo do total em mais de 1% é ambíguo; até 1% passa", () => {
  assert.deepEqual(limpar({ ...base, precoUnitario: 300, totalProduto: 1200 }, pedido).aConfirmar, ["preco"]);
  assert.equal(limpar({ ...base, precoUnitario: 300, totalProduto: 1500 }, pedido).aConfirmar, undefined);
  assert.equal(limpar({ ...base, precoUnitario: 300, totalProduto: 1505 }, pedido).aConfirmar, undefined);
});

test("Q1: leitura declarada sem o campo correspondente, ou ambígua, pede confirmação", () => {
  assert.deepEqual(limpar({ ...base, leituraPreco: "total", precoUnitario: 300 }, pedido).aConfirmar, ["preco"]);
  assert.deepEqual(limpar({ ...base, leituraPreco: "ambiguo", precoUnitario: 300 }, pedido).aConfirmar, ["preco"]);
  assert.equal(limpar({ ...base, leituraPreco: "total", totalProduto: 1500 }, pedido).aConfirmar, undefined);
});

test("Q1: quantidade ou embalagem diferente da pedida vira divergência", () => {
  const e = limpar({ ...base, precoUnitario: 300, quantidadeOfertada: 3, embalagem: "3 x 500 g" }, pedido);
  assert.ok(e.divergencias.some((d) => d.includes("quantidade ofertada 3")));
  assert.ok(e.divergencias.some((d) => d.includes("3 x 500 g")));
});

test("Q2: itemExato deriva de aderencia; só 'diferente' é false", () => {
  assert.equal(limpar({ ...base, precoUnitario: 30, aderencia: "equivalente", divergencias: ["marca Tigre, não exigida"] }, pedido).itemExato, true);
  assert.equal(limpar({ ...base, precoUnitario: 30, aderencia: "diferente" }, pedido).itemExato, false);
});

test("Q2: a_confirmar não corta e pede confirmação do item", () => {
  const e = limpar({ ...base, precoUnitario: 30, aderencia: "a_confirmar" }, pedido);
  assert.equal(e.itemExato, true);
  assert.deepEqual(e.aConfirmar, ["item"]);
});

test("desconto fora da faixa vira nulo", () => {
  const e = limpar({ ...base, precoUnitario: 30, descontoPercentual: 150, descontoValor: -2 }, pedido);
  assert.equal(e.descontoPercentual, null);
  assert.equal(e.descontoValor, null);
  assert.equal(limpar({ ...base, precoUnitario: 30, descontoPercentual: 5 }, pedido).descontoPercentual, 5);
});

test("alertas repetidos são juntados", () => {
  assert.deepEqual(limpar({ ...base, precoUnitario: 30, alertas: ["propina", "propina"] }, pedido).alertas, ["propina"]);
});

test("pergunta única junta preço e item", () => {
  const e = limpar({ ...base, precoUnitario: 300, totalProduto: 300, aderencia: "a_confirmar", divergencias: ["sem dimensão"] }, pedido);
  e.aConfirmar = ["preco", "item"];
  const t = perguntaDeConfirmacao(e, { id: 7, descricao: "cimento CP II", unidade: "saco", quantidade: "5" });
  assert.match(t, /R\$ 300 é o preço por saco ou o total das 5 saco/);
  assert.match(t, /Também: o item oferecido/);
  assert.match(t, /sem dimensão/);
});

test("I1: a condição do desconto só fica quando há desconto válido", () => {
  const com = limpar({ ...base, precoUnitario: 30, descontoPercentual: 5, descontoCondicao: " à vista " }, pedido);
  assert.equal(com.descontoCondicao, "à vista");
  const semValor = limpar({ ...base, precoUnitario: 30, descontoPercentual: 150, descontoCondicao: "à vista" }, pedido);
  assert.equal(semValor.descontoCondicao, null);
  // Leitura montada sem o campo (testes antigos, simulador) continua aceita.
  assert.equal(limpar({ ...base, precoUnitario: 30 }, pedido).descontoCondicao, null);
});
