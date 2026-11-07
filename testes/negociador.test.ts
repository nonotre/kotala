import assert from "node:assert/strict";
import { test } from "node:test";
import { proximoEstadoItem } from "../src/nucleo/orquestrador/estados.ts";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
const { textoNegociacao, MAX_RODADAS } = await import("../src/agentes/negociador/index.ts");

const item = { id: 12, quantidade: "40", unidade: "saco", descricao: "Cimento CP II" };

test("contraproposta nunca cita valor nem nome de outro fornecedor", () => {
  const t = textoNegociacao("Loja Aurora Exemplo", item, { melhorCusto: 1583.6, referencia: null }, "14:30");
  assert.match(t, /Olá, Loja Aurora Exemplo/);
  assert.match(t, /40 sacos de Cimento CP II \(cotação 12\)/);
  assert.match(t, /preço, no frete ou no prazo de entrega/);
  assert.match(t, /forma de pagamento/);
  assert.match(t, /não precisa responder/);
  assert.doesNotMatch(t, /1\.583|R\$/);
  assert.doesNotMatch(t, /Depósito|Lagoa|Vale|Serra|Ipê/);
});

test("só a referência pública da internet pode ser citada", () => {
  const t = textoNegociacao("Depósito Perto Exemplo", item, { melhorCusto: 1583.6, referencia: 38.9 }, null);
  assert.match(t, /preço publicado na internet para este item está em R\$\s38,90 por saco/);
  assert.doesNotMatch(t, /1\.583/);
});

test("negociar e reavaliar só a partir da decisão do comprador", () => {
  assert.equal(proximoEstadoItem("aguardando_decisao", "negociar"), "cotando");
  assert.equal(proximoEstadoItem("aguardando_decisao", "reavaliar"), "comparando");
  assert.equal(proximoEstadoItem("cotando", "negociar"), null);
  assert.equal(proximoEstadoItem("confirmado", "reavaliar"), null);
  assert.equal(MAX_RODADAS, 3);
});
