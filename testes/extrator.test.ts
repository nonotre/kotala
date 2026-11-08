import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
const { limpar } = await import("../src/agentes/extrator/index.ts");

const base = {
  classificacao: "outro" as const, duvida: null, itemOferecido: null, itemExato: true, aderencia: "exato" as const, divergencias: [] as string[], leituraPreco: "unitario" as const, trechoPreco: null, alertas: [] as never[], descontoPercentual: null, descontoValor: null, precoUnitario: null, quantidadeOfertada: null,
  unidadeOfertada: null, embalagem: null, totalProduto: null, frete: null, impostosValor: null, impostosNaoInclusos: null,
  prazoDias: null, validadeDias: null, pagamento: null, prazoPagamentoDias: null, entregaNoLocal: null, cnpj: null,
};

test("com preço, é proposta mesmo pedindo uma pessoa; o pedido vira aviso", () => {
  const e = limpar({ ...base, classificacao: "responsavel", precoUnitario: 38.9 });
  assert.equal(e.classificacao, "proposta");
  assert.equal(e.pedidoContato, true);
});

test("com preço e fora do assunto, a proposta não se perde", () => {
  assert.equal(limpar({ ...base, classificacao: "fora_do_assunto", totalProduto: 1500 }).classificacao, "proposta");
});

test("proposta sem preço não é proposta", () => {
  assert.equal(limpar({ ...base, classificacao: "proposta" }).classificacao, "outro");
});

test("valores fora da faixa viram nulo", () => {
  const e = limpar({ ...base, classificacao: "proposta", precoUnitario: 40, frete: -5, prazoDias: 9999 });
  assert.equal(e.frete, null);
  assert.equal(e.prazoDias, null);
});
