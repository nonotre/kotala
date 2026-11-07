import assert from "node:assert/strict";
import { test } from "node:test";
import { casarComBase, palavras, rotuloOpcao } from "../src/agentes/interpretador/base-itens.ts";

const id = (r: ReturnType<typeof casarComBase>) => (r.tipo === "unico" ? r.item.id : r.tipo === "varios" ? r.opcoes.map((o) => o.id).join(",") : "nenhum");

test("palavras separa número e unidade", () => {
  assert.deepEqual(palavras("Isopor 50mm"), ["isopor", "50"]);
  assert.deepEqual(palavras("cabo 2,5 mm²"), ["cabo", "2.5"]);
});

test("casa direto quando o comprador disse a especificação", () => {
  assert.equal(id(casarComBase("Placa de isopor 50mm")), "ITM-001");
  assert.equal(id(casarComBase("Cimento Portland CP II", { Peso: "50 kg" })), "ITM-021");
  assert.equal(id(casarComBase("Vergalhão CA-50 10 mm")), "ITM-024");
  assert.equal(id(casarComBase("Areia média lavada")), "ITM-017");
  assert.equal(id(casarComBase("Cabo flexível 4 mm")), "ITM-005");
  assert.equal(id(casarComBase("Tubo PVC esgoto 100 mm")), "ITM-013");
});

test("pergunta quando há variações e o comprador não disse qual", () => {
  const r = casarComBase("Placa de isopor");
  assert.equal(r.tipo, "varios");
  assert.equal(id(r), "ITM-001,ITM-002,ITM-003");
  const c = casarComBase("Cabo de cobre flexível");
  assert.equal(c.tipo, "varios");
  if (c.tipo === "varios") assert.equal(rotuloOpcao(c.opcoes[0]!, c.opcoes), "2.5 mm²");
  if (r.tipo === "varios") assert.deepEqual(r.opcoes.map((o) => rotuloOpcao(o, r.opcoes)), ["50 mm", "25 mm", "100 mm, alta densidade"]);
});

test("não casa item que não está na base nem confunde especificação", () => {
  assert.equal(id(casarComBase("Cimento CP III 50 kg")), "nenhum");
  assert.equal(id(casarComBase("Telha de fibrocimento")), "nenhum");
  assert.equal(id(casarComBase("Vergalhão CA-50 8 mm")), "nenhum");
});
