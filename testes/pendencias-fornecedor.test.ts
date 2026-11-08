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
  // R13: sem preferência, o padrão da empresa; com ela, a forma do comprador. U1: quem não puder diz a sua.
  assert.match(textoCotacao(dados(), "Loja"), /Pagamento: à vista, no recebimento/);
  assert.match(textoCotacao(dados({ pagamentoPreferido: "  " }), "Loja"), /Pagamento: à vista, no recebimento/);
  const t = textoCotacao(dados({ pagamentoPreferido: "pix" }), "Loja");
  assert.match(t, /Entrega e pagamento\nEntrega: Rua A, 10\nPagamento: pix \(se não puder nessa condição, diga a sua\)/);
  assert.match(htmlCotacao(dados({ pagamentoPreferido: "boleto <28>" }), "Loja").valor, /Pagamento: boleto &lt;28&gt;/);
});

test("R13: sem preferência, a alavanca de pagamento pede o padrão à vista no recebimento; com a forma do comprador, não entra", () => {
  const base = { recompra: false, quantidade: 1, pagamento: "boleto 28 dias", frete: null, entregas: null };
  assert.deepEqual(n.escolherAlavancas(base), ["pagamento"]);
  assert.deepEqual(n.escolherAlavancas({ ...base, pagamentoPreferido: "pix" }), []);
  const r = n.montarNegociacao({ alavancas: ["pagamento"], quantidade: "40", unidade: "saco", frete: null, referencia: null, janelaAte: new Date("2026-11-08T14:00:00Z"), agora: new Date("2026-11-08T13:00:00Z") });
  assert.ok(r.validado);
  assert.match(r.texto, /Nosso padrão é pagamento à vista, no recebimento/);
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
