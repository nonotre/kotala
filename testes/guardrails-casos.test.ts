// Os 60 casos do comprador de docs/plano-ia/guardrails.md, na parte sem IA: o que as
// barreiras em código garantem sozinhas. A parte com IA é o `npm run guardrails:avaliar`.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // os módulos exigem a variável; nada conecta aqui
const { CASOS_COMPRADOR, CASOS_FORNECEDOR, metricasPorClasse } = await import("../src/simulador/casos/guardrails.ts");
const { avaliarCaso, decidirSemIa } = await import("../src/simulador/casos/avaliar-guardrails.ts");
const { CLASSES } = await import("../src/agentes/guardrail/index.ts");
const { ALERTAS } = await import("../src/agentes/extrator/index.ts");

const resultados = CASOS_COMPRADOR.map((c) => {
  const r = decidirSemIa(c);
  return avaliarCaso(c, r.classe, r.decisao);
});
const por = new Map(resultados.map((r) => [r.n, r]));

test("os casos estão completos: 60 do comprador e 9 do fornecedor, com classes e alertas que existem", () => {
  assert.deepEqual(CASOS_COMPRADOR.map((c) => c.n), Array.from({ length: 60 }, (_, i) => i + 1));
  for (const c of CASOS_COMPRADOR) for (const k of c.classes) assert.ok((CLASSES as readonly string[]).includes(k), `${c.n}: ${k}`);
  assert.equal(CASOS_FORNECEDOR.length, 9);
  for (const f of CASOS_FORNECEDOR) for (const a of [...f.alertas, ...(f.semAlertas ?? [])]) assert.ok((ALERTAS as readonly string[]).includes(a), `${f.n}: ${a}`);
});

test("falso positivo sem IA: nenhum caso legítimo é bloqueado pelo código (a IA que acerta não é derrubada)", () => {
  const fp = resultados.filter((r) => r.grupo === "fp");
  assert.equal(fp.length, 24);
  for (const r of fp) assert.ok(r.ok, `caso ${r.n}: ${r.motivo}`);
  assert.deepEqual(metricasPorClasse(resultados).bloqueouLegitimo, []);
});

test("falso negativo sem IA: mesmo com a IA dizendo \"pedido\", lista dura e controlados seguram", () => {
  // Conteúdo sexual (39) não tem lista dura por desenho: depende da leitura da IA.
  const soComIa = new Set([39]);
  for (const r of resultados.filter((x) => x.grupo === "fn" && x.obtido !== "pulado" && !soComIa.has(x.n))) assert.ok(r.ok, `caso ${r.n}: ${r.motivo}`);
  assert.equal(por.get(39)!.obtido, "pedido");
  assert.deepEqual(metricasPorClasse(resultados).deixouPassar, [39]);
});

test("casos que só a IA decide (pergunta, fora do escopo, consulta, injeção, ofensa) ficam como pedido sem ela", () => {
  for (const n of [3, 7, 8, 42, 43, 44, 45, 46, 47, 48, 49, 51, 52, 57]) assert.equal(por.get(n)!.obtido, "pedido", String(n));
});

test("misturas: controlado sai e o resto segue (23, 54); proibido derruba a mensagem inteira (29)", () => {
  assert.ok(por.get(23)!.ok && por.get(23)!.pedido);
  assert.ok(por.get(54)!.ok && por.get(54)!.pedido);
  assert.equal(por.get(29)!.obtido, "proibido");
  assert.equal(por.get(29)!.pedido, false);
});

test("métrica por classe: falso positivo e falso negativo somam os erros", () => {
  const m = metricasPorClasse(resultados);
  const erros = resultados.filter((r) => !r.ok && r.obtido !== "pulado" && r.esperado.length).length;
  const fn = Object.values(m.porClasse).reduce((s, c) => s + c.falsoNegativo, 0);
  const fp = Object.values(m.porClasse).reduce((s, c) => s + c.falsoPositivo, 0);
  assert.equal(fn, erros);
  assert.equal(fp, erros);
  assert.equal(m.porClasse.proibido!.falsoNegativo, 1); // o 39
  assert.equal(m.porClasse.proibido!.falsoPositivo, 0);
  assert.equal(m.porClasse.controlado!.falsoPositivo, 0);
});
