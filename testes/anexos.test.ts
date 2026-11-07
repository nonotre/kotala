// Texto do pedido a partir de áudio, foto e print (R1b). Sem IA nem banco.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // o módulo exige a variável; nada conecta aqui
const { textoDoPedidoComAnexo } = await import("../src/agentes/interpretador/anexos.ts");

const base = { anuncio: null, legivel: true } as const;

test("áudio entra como se fosse escrito, para 'sim' e 'pode cotar' valerem", () => {
  assert.equal(textoDoPedidoComAnexo("", { ...base, tipo: "audio", texto: "sim, pode cotar" }), "sim, pode cotar");
});

test("foto e print levam a origem marcada, depois da legenda", () => {
  const print = { ...base, tipo: "print_loja" as const, texto: "Cimento CP II 50 kg Votoran" };
  assert.equal(textoDoPedidoComAnexo("40 desse pra obra alfa", print), "40 desse pra obra alfa\n[Print de loja] Cimento CP II 50 kg Votoran");
  assert.equal(textoDoPedidoComAnexo("", { ...base, tipo: "foto_produto", texto: "Argamassa AC-III" }), "[Foto] Argamassa AC-III");
  assert.equal(textoDoPedidoComAnexo(" ", { ...base, tipo: "lista", texto: "10 barras de ferro 3/8" }), "[Lista] 10 barras de ferro 3/8");
});

test("anexo ilegível fica só com a legenda", () => {
  assert.equal(textoDoPedidoComAnexo("cimento", { ...base, tipo: "outro", texto: "", legivel: false }), "cimento");
});
