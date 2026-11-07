import assert from "node:assert/strict";
import { test } from "node:test";
import { PERSONAS, precoUnitario, textoProposta, vendeItem } from "../src/simulador/personas.ts";

const perto = PERSONAS.find((p) => p.chave === "sim-perto")!;

test("catálogo reconhece itens de obra e recusa o resto", () => {
  assert.ok(vendeItem("Cimento Portland CP II"));
  assert.ok(vendeItem("Vergalhão CA-50 10 mm"));
  assert.ok(!vendeItem("Notebook gamer"));
});

test("carrada vira m³ na conta do preço", () => {
  assert.equal(precoUnitario(perto, "Areia média", "carrada"), 135 * 6);
});

test("toda persona gera proposta com preço para item do catálogo", () => {
  for (const p of PERSONAS) {
    const t = textoProposta(p, { descricao: "Cimento CP II", quantidade: 40, unidade: "saco", destino: "Obra" }, 1);
    assert.ok(t && /\d+,\d{2}/.test(t), p.chave);
  }
});

test("segunda rodada baixa o preço", () => {
  assert.ok(precoUnitario(perto, "Cimento CP II", "saco")! > 0);
  const r1 = textoProposta(perto, { descricao: "Cimento CP II", quantidade: 1, unidade: "saco", destino: null }, 1)!;
  const r2 = textoProposta(perto, { descricao: "Cimento CP II", quantidade: 1, unidade: "saco", destino: null }, 2)!;
  assert.notEqual(r1, r2);
});

test("fornecedores da base vendem pela categoria; os outros, pelo catálogo", async () => {
  const { PERSONAS_BASE, personaVende } = await import("../src/simulador/personas.ts");
  assert.equal(PERSONAS_BASE.length, 12);
  const isoterm = PERSONAS_BASE.find((p) => p.nome === "Isoterm Isopor")!;
  assert.ok(personaVende(isoterm, "Placa de isopor (EPS)", "Isolamento térmico"));
  assert.ok(!personaVende(isoterm, "Cimento Portland CP II-E-32", "Cimentícios"));
  assert.ok(personaVende(perto, "Cimento Portland CP II", null));
  assert.ok(PERSONAS_BASE.every((p) => p.chave.startsWith("sim-base-")));
});

test("fornecedor da base sem referência de preço diz que não tem, sem inventar", async () => {
  const { PERSONAS_BASE } = await import("../src/simulador/personas.ts");
  const t = textoProposta(PERSONAS_BASE[0]!, { descricao: "Registro de gaveta bruto", quantidade: 5, unidade: "unidade", destino: null }, 1, null)!;
  assert.match(t, /não temos/);
  assert.doesNotMatch(t, /R\$|\d+,\d{2}/);
});
