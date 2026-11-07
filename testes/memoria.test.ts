import assert from "node:assert/strict";
import { test } from "node:test";
import { proximoEstadoItem, colunaDoItem } from "../src/nucleo/orquestrador/estados.ts";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
const { mesmoItem, textoRecompra } = await import("../src/agentes/memoria/index.ts");

test("mesmo item com nomes diferentes da IA", () => {
  assert.ok(mesmoItem("cimento-portland-cp-ii-50-kg", "cimento-cp-ii-50-kg"));
  assert.ok(mesmoItem("cimento-cp-ii", "cimento-portland-cp-ii"));
  assert.ok(!mesmoItem("cimento-cp-ii-50-kg", "cimento-cp-iii-50-kg"));
  assert.ok(!mesmoItem("areia-media", "areia-fina"));
  assert.ok(!mesmoItem("argamassa-ac-ii-20-kg", "argamassa-ac-iii-20-kg"));
});

test("estados da recompra", () => {
  assert.equal(proximoEstadoItem("buscando", "propor_recompra"), "aguardando_recompra");
  assert.equal(proximoEstadoItem("aguardando_recompra", "repetir_compra"), "aprovado");
  assert.equal(proximoEstadoItem("aguardando_recompra", "cotar_de_novo"), "buscando");
  assert.equal(proximoEstadoItem("pedido_enviado", "recompra_recusada"), "buscando");
  assert.equal(colunaDoItem("em_andamento", "aguardando_recompra"), "Comparando");
});

test("texto da recompra mostra o histórico e deixa a decisão com o comprador", () => {
  const t = textoRecompra(9, { descricao: "Cimento CP II", unidade: "saco" }, {
    historicoId: "h", fornecedorId: "f", fornecedorNome: "Depósito Perto Exemplo", simulado: true, precoUnitario: 38.9, frete: 60,
    quantidade: 40, data: new Date("2026-10-20T12:00:00Z"), prazoPrometidoDias: 1, prazoCumprido: true, experiencia: null, comprasNoPeriodo: 2,
  });
  assert.match(t, /Depósito Perto Exemplo \(simulado\), em 20\/10\/2026, a R\$\s38,90 por saco, frete R\$\s60,00/);
  assert.match(t, /Prazo combinado: 1 dia, cumprido/);
  assert.match(t, /Comprou 2 vezes/);
  assert.match(t, /repetir com o mesmo fornecedor ou cotar de novo\?/);
});
