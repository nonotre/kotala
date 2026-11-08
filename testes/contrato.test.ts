// X2: regras puras do contrato anual (sem banco).
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
const { contratoCobreItem, mesmaUnidade, situacaoDoContrato, textoContrato } = await import("../src/agentes/memoria/contrato.ts");
const { textoPedidoDeCompra } = await import("../src/fluxo/decisao.ts");

test("o contrato cobre o item: código da base igual, ou o mesmo item pela descrição", () => {
  const c = { itemChave: "ITM-0001", descricao: "Cimento CP II 50 kg" };
  assert.ok(contratoCobreItem(c, { itemChave: "ITM-0001", descricao: "Cimento Portland CP II 50kg" }));
  assert.ok(contratoCobreItem(c, { itemChave: "itm-0001", descricao: "x" }));
  // Códigos diferentes da base são itens diferentes, mesmo com nome parecido.
  assert.ok(!contratoCobreItem(c, { itemChave: "ITM-0002", descricao: "Cimento CP II 50 kg" }));
  // Sem código: pela descrição, com os termos decisivos iguais.
  assert.ok(contratoCobreItem(c, { itemChave: null, descricao: "Cimento CP II 50 kg" }));
  assert.ok(!contratoCobreItem(c, { itemChave: null, descricao: "Cimento CP III 50 kg" }));
  assert.ok(!contratoCobreItem(c, { itemChave: null, descricao: "Cimento CP II 25 kg" }));
});

test("unidade: plural e sinônimo valem; outra unidade não", () => {
  assert.ok(mesmaUnidade("saco", "sacos"));
  assert.ok(mesmaUnidade("m³", "metro cúbico"));
  assert.ok(!mesmaUnidade("tonelada", "m³"));
  assert.ok(mesmaUnidade("Kit X", "kit x"));
});

test("situação do contrato", () => {
  const agora = new Date("2026-11-08T12:00:00Z");
  const d = (s: string) => new Date(s);
  assert.equal(situacaoDoContrato({ ativo: true, inicio: d("2026-01-01"), fim: d("2026-12-31") }, agora), "vigente");
  assert.equal(situacaoDoContrato({ ativo: true, inicio: d("2026-12-01"), fim: d("2027-11-30") }, agora), "agendado");
  assert.equal(situacaoDoContrato({ ativo: true, inicio: d("2025-01-01"), fim: d("2025-12-31") }, agora), "vencido");
  assert.equal(situacaoDoContrato({ ativo: false, inicio: d("2026-01-01"), fim: d("2026-12-31") }, agora), "encerrado");
});

test("pergunta ao comprador e pedido de compra pelo contrato", () => {
  const c = {
    id: "c", itemChave: "ITM-0001", descricao: "Cimento CP II 50 kg", fornecedorId: "f", fornecedorNome: "Cimenteira", simulado: false,
    precoUnitario: 36.5, unidade: "saco", inicio: new Date("2026-01-01T12:00:00Z"), fim: new Date("2026-12-31T12:00:00Z"), observacao: null,
  };
  const t = textoContrato(12, { descricao: "Cimento CP II 50 kg", quantidade: "40", unidade: "saco" }, c);
  assert.match(t, /^Pedido 12: Cimento CP II 50 kg\.\nEste item tem contrato com Cimenteira até 31\/12\/2026, a R\$\s36,50 por saco: pedir direto\?/);
  assert.match(t, /cotar mesmo assim/);

  const pc = textoPedidoDeCompra({
    item: { id: 34, quantidade: "40", unidade: "saco" },
    pedido: { modoEntrega: "entrega", destino: "Rua das Obras, 100", janelaRecebimento: null, entregas: null, pagamentoPreferido: "pix" },
    oferta: { itemOferecido: "Cimento CP II 50 kg", formato: "historico", precoUnitario: "36.50", frete: null, prazoDias: null, pagamento: "conforme o contrato", prazoPagamentoDias: null },
    custo: null,
    comprador: "Ester",
    contrato: { precoUnitario: 36.5, fim: c.fim, observacao: "boleto 28 dias" },
  });
  assert.match(pc, /Pelo nosso contrato vigente até 31\/12\/2026: R\$\s36,50 por saco, total do produto R\$\s1\.460,00\./);
  assert.match(pc, /Pagamento e frete: conforme o contrato \(boleto 28 dias\)\./);
  // A preferência de pagamento do pedido não entra: vale o contrato.
  assert.doesNotMatch(pc, /forma de pagamento preferida/);
  assert.doesNotMatch(pc, /Mesmo preço da última compra/);
});
