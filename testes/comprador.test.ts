import assert from "node:assert/strict";
import { test } from "node:test";
import { chaveDoItem } from "../src/agentes/interpretador/index.ts";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // o módulo exige a variável; nada conecta aqui
const { plural, textoConfirmacao } = await import("../src/fluxo/comprador.ts");

test("plural de unidade só para exibição", () => {
  assert.equal(plural("saco", 40), "sacos");
  assert.equal(plural("carrada", 2), "carradas");
  assert.equal(plural("milheiro", 3), "milheiros");
  assert.equal(plural("saco", 1), "saco");
  assert.equal(plural("m³", 5), "m³");
  assert.equal(plural("kg", 5), "kg");
  assert.equal(plural("barras", 5), "barras");
});

test("chave estável do item", () => {
  assert.equal(chaveDoItem("Cimento CP II 50 kg"), "cimento-cp-ii-50-kg");
  assert.equal(chaveDoItem("  Areia média lavada "), "areia-media-lavada");
});

test("confirmação mostra itens, prazo, suposições e perguntas", () => {
  const t = textoConfirmacao({
    id: 7,
    itens: [
      { descricao: "Cimento CP II", quantidade: "40", unidade: "saco", aceitaSimilar: false },
      { descricao: "Areia média", quantidade: "0", unidade: "carrada", aceitaSimilar: true },
    ],
    destino: null,
    prazoTexto: "até sexta",
    prazoMaxDias: 6,
    urgencia: "parada",
    modoEntrega: null,
    janelaRecebimento: null,
    suposicoes: ["Saco de 50 kg"],
    perguntas: ["Quantas carradas de areia?"],
    pagamento: "pix",
  });
  assert.match(t, /1\. 40 sacos de Cimento CP II/);
  assert.match(t, /2\. \? carrada de Areia média \(aceita similar\)/);
  assert.match(t, /Entrega: não informado/);
  assert.match(t, /até sexta \(6 dias\)/);
  assert.match(t, /Operação parada/);
  assert.match(t, /Pagamento preferido: pix/);
  assert.match(t, /- Saco de 50 kg/);
  assert.match(t, /Antes de cotar, me diga:\n- Quantas carradas de areia\?/);
});

test("quantidade sem repetir a unidade no nome", async () => {
  const { quantidadeDe } = await import("../src/texto.ts");
  assert.equal(quantidadeDe(10, "placa", "Placa de isopor (EPS)"), "10 placas de isopor (EPS)");
  assert.equal(quantidadeDe(40, "saco", "Cimento CP II"), "40 sacos de Cimento CP II");
  assert.equal(quantidadeDe(5, "barra", "Barra de aço CA-50"), "5 barras de aço CA-50");
});
