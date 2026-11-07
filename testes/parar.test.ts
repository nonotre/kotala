import assert from "node:assert/strict";
import { test } from "node:test";
import { ehPedidoDeParar } from "../src/nucleo/mensagens/parar.ts";

test("reconhece PARAR e variações curtas", () => {
  for (const t of ["PARAR", "parar", "Pare!", "pare por favor", "/stop", "STOP", "não quero mais receber", "por favor parar"]) {
    assert.ok(ehPedidoDeParar(t), t);
  }
});

test("não confunde proposta ou frase comum com PARAR", () => {
  for (const t of [
    "",
    "Cimento CP II a R$ 39,90, entrega em 2 dias",
    "Posso parar na obra amanhã de manhã para entregar os 40 sacos, tudo bem?",
    "para quando é a entrega?",
  ]) {
    assert.ok(!ehPedidoDeParar(t), t);
  }
});
