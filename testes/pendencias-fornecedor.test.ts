// Pendências do lado do fornecedor (junção da rodada 2): preferência de pagamento (U1) na
// cotação, na negociação e no pedido de compra; quem compra no pedido de compra.
// Testes puros, sem banco e sem IA.

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // os módulos exigem a variável; nada conecta aqui
const { htmlCotacao, textoCotacao } = await import("../src/agentes/cotador/index.ts");
const n = await import("../src/agentes/negociador/index.ts");
const { textoPedidoDeCompra } = await import("../src/fluxo/decisao.ts");

const dados = (pedido: Record<string, unknown> = {}) =>
  ({
    item: { id: 12, rodada: 1, quantidade: "40", unidade: "saco", descricao: "Cimento CP II", itemChave: null, aceitaSimilar: true, especificacao: {}, prazoRespostasEm: null },
    pedido: { id: 3, modoEntrega: "entrega", destino: "Rua A, 10", cep: null, janelaRecebimento: null, prazoTexto: null, entregas: null, pagamentoPreferido: null, ...pedido },
  }) as never;

test("U1: a cotação diz a forma de pagamento preferida, escapada, e só quando existe", () => {
  assert.doesNotMatch(textoCotacao(dados(), "Loja"), /Pagamento preferido/);
  assert.doesNotMatch(textoCotacao(dados({ pagamentoPreferido: "  " }), "Loja"), /Pagamento preferido/);
  const t = textoCotacao(dados({ pagamentoPreferido: "pix" }), "Loja");
  assert.match(t, /Entrega e pagamento\nEntrega: Rua A, 10\nPagamento preferido: pix \(se puder, cote nessa condição; se não, diga a sua\)/);
  assert.match(htmlCotacao(dados({ pagamentoPreferido: "boleto <28>" }), "Loja").valor, /Pagamento preferido: boleto &lt;28&gt;/);
});

test("U1: preferência só vira alavanca quando a proposta ainda não a oferece", () => {
  assert.equal(n.preferenciaNaoAtendida(null, "boleto"), null);
  assert.equal(n.preferenciaNaoAtendida("Pix", "PIX à vista"), null);
  assert.equal(n.preferenciaNaoAtendida("boleto 28 dias", "Boleto, 28 dias"), null);
  assert.equal(n.preferenciaNaoAtendida("pix", "boleto 28 dias"), "pix");
  assert.equal(n.preferenciaNaoAtendida("pix", null), "pix");
  // Com prazo de pagamento longo, só a preferência faz a alavanca "pagamento" aparecer.
  const base = { recompra: false, quantidade: 1, prazoPagamentoDias: 60, frete: null, entregas: null };
  assert.deepEqual(n.escolherAlavancas(base), []);
  assert.deepEqual(n.escolherAlavancas({ ...base, pagamentoPreferido: "pix" }), ["pagamento"]);
});

test("U1: o pedido de desconto cita a preferência como pergunta e passa no validador", () => {
  const r = n.montarNegociacao({ alavancas: ["pagamento"], quantidade: "40", unidade: "saco", frete: null, referencia: null, pagamentoPreferido: "pix", janelaAte: new Date("2026-11-08T14:00:00Z"), agora: new Date("2026-11-08T13:00:00Z") });
  assert.ok(r.validado);
  assert.match(r.texto, /Nossa forma de pagamento preferida é pix: há desconto nessa condição\?/);
  assert.doesNotMatch(r.texto, /à vista, ou prazo maior/);
  // Sem preferência, a frase de antes.
  const s = n.montarNegociacao({ alavancas: ["pagamento"], quantidade: "40", unidade: "saco", frete: null, referencia: null, janelaAte: new Date("2026-11-08T14:00:00Z") });
  assert.match(s.texto, /Há desconto para pagamento à vista, ou prazo maior no boleto\?/);
});

const pedidoCompra = (p: Partial<Parameters<typeof textoPedidoDeCompra>[0]> = {}) =>
  textoPedidoDeCompra({
    item: { id: 12, quantidade: "40", unidade: "saco" },
    pedido: { modoEntrega: "entrega", destino: "Rua A, 10", janelaRecebimento: null, entregas: null, pagamentoPreferido: null },
    oferta: { itemOferecido: "Cimento CP II 50 kg", formato: "texto", precoUnitario: "40", frete: "60", prazoDias: 3, pagamento: "boleto", prazoPagamentoDias: 28 },
    custo: 1660,
    comprador: null,
    ...p,
  });

test("pedido de compra: quem compra (só o nome) e a preferência de pagamento sem mudar o combinado", () => {
  const sem = pedidoCompra();
  assert.match(sem, /Pagamento: boleto \(28 dias para pagar\)\./);
  assert.doesNotMatch(sem, /Comprador responsável|preferida/);

  const com = pedidoCompra({
    comprador: "Ana Souza",
    pedido: { modoEntrega: "entrega", destino: "Rua A, 10", janelaRecebimento: null, entregas: null, pagamentoPreferido: "pix" },
  });
  assert.match(com, /Pagamento: boleto \(28 dias para pagar\)\.\nSe for possível nas mesmas condições, nossa forma de pagamento preferida é pix\./);
  assert.match(com, /Comprador responsável: Ana Souza\.\nPode confirmar o fornecimento\?$/);

  // A proposta já é na forma preferida: não repete.
  const igual = pedidoCompra({
    pedido: { modoEntrega: "entrega", destino: "Rua A, 10", janelaRecebimento: null, entregas: null, pagamentoPreferido: "boleto" },
  });
  assert.doesNotMatch(igual, /preferida/);
});
