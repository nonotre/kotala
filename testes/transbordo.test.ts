// Transbordo inteligente (ideiastransbordo.md): leitura do texto, escolha do fornecedor, sigilo do
// recado e a tentativa do lado do comprador. Testes puros, sem banco e sem IA.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
const t = await import("../src/fluxo/transbordo.ts");

test("pedido de falar com o fornecedor; pedido de compra e consulta não contam", () => {
  for (const s of ["Preciso falar com o fornecedor sobre entregas parciais", "quero falar com a Cerâmica Alfa, o fornecedor", "pode passar um recado pro fornecedor?", "me passa o telefone do fornecedor", "tem como ligar pro vendedor?"]) assert.ok(t.pedeFalarComFornecedor(s), s);
  for (const s of ["manda 40 sacos de cimento pro depósito da obra", "algum fornecedor respondeu?", "o fornecedor mandou proposta?", "10 resmas de papel A4"]) assert.ok(!t.pedeFalarComFornecedor(s), s);
});

test("insistência depois da tentativa", () => {
  for (const s of ["Não resolveu o problema, preciso falar direto com o fornecedor.", "não ajudou", "quero falar com uma pessoa", "preciso falar com ele mesmo"]) assert.ok(t.insiste(s), s);
  assert.ok(!t.insiste("ok, obrigado"));
});

test("assunto: sobra algo além de pedir uma pessoa", () => {
  assert.ok(!t.temAssunto("quero falar com o responsável"));
  assert.ok(!t.temAssunto("Posso falar com alguém, por favor?"));
  assert.ok(!t.temAssunto("me liga"));
  assert.ok(t.temAssunto("quero falar com o comprador sobre a entrega em duas partes"));
  assert.ok(t.temAssunto("preciso falar com alguém: o frete para o interior fica por conta de quem?"));
});

test("sigilo do recado: só valores da proposta dele; nada de outro fornecedor", () => {
  assert.ok(t.conferirRecado("Consegue entregar metade em 20 dias e o resto em 30?", [10, 400, 60]).ok);
  assert.ok(t.conferirRecado("O frete de R$ 60,00 pode sair mais barato?", [10, 400, 60]).ok);
  assert.match(t.conferirRecado("Outro fez por R$ 8,00, cobre?", [10]).motivos.join(), /valor que não é da proposta dele/);
  assert.match(t.conferirRecado("O concorrente faz entrega amanhã", [10]).motivos.join(), /concorrente/);
  assert.match(t.conferirRecado("A outra loja entrega amanhã", [10]).motivos.join(), /outro fornecedor/);
});

const c = (itemPedidoId: number, fornecedor: string, fornecedorId: string, horas = 0) => ({
  itemPedidoId,
  pedidoId: itemPedidoId + 100,
  descricao: "Cimento CP II",
  quantidade: "40",
  unidade: "saco",
  estado: "cotando",
  fornecedorId,
  fornecedor,
  atualizadoEm: new Date(Date.UTC(2026, 10, 8, 12 - horas)),
});

test("com qual fornecedor: pelo nome, pela cotação, único; senão botões", () => {
  const lista = [c(12, "Cerâmica Alfa", "a"), c(12, "Depósito Beta", "b", 1), c(13, "Cerâmica Alfa", "a", 2)];
  const pelo = t.escolherAlvo("quero falar com a Cerâmica Alfa", lista);
  assert.equal(pelo.tipo, "um");
  assert.equal(pelo.tipo === "um" && pelo.alvo.itemPedidoId, 12); // o mais recente dele
  const pelaCotacao = t.escolherAlvo("falar com o fornecedor da cotação 13", lista);
  assert.equal(pelaCotacao.tipo === "um" && pelaCotacao.alvo.fornecedor, "Cerâmica Alfa");
  const varios = t.escolherAlvo("quero falar com o fornecedor", lista);
  assert.equal(varios.tipo, "varios");
  assert.equal(varios.tipo === "varios" && varios.opcoes.length, 3);
  assert.equal(t.escolherAlvo("quero falar com o fornecedor", [lista[1]!]).tipo, "um");
  assert.equal(t.escolherAlvo("quero falar com o fornecedor", []).tipo, "nenhum");
});

test("tentativa do comprador: o que a proposta dele já diz, ou que ainda não respondeu", () => {
  const alvo = { fornecedor: "Cerâmica Alfa", itemPedidoId: 12, quantidade: "40", unidade: "saco", descricao: "Cimento CP II" };
  const com = t.textoTentativa(alvo, { precoUnitario: "38.50", totalProduto: "1540", frete: "0", prazoDias: 3, pagamento: "boleto 28 dias", validadeDias: 10 }, null);
  assert.match(com, /^Sobre Cerâmica Alfa na cotação 12 \(40 sacos de Cimento CP II\):/);
  assert.match(com, /R\$\s38,50 por saco; total R\$\s1\.540,00; frete grátis; entrega em 3 dias; pagamento: boleto 28 dias; validade de 10 dias/);
  assert.match(com, /me diga de novo que quer falar com o fornecedor/);
  const sem = t.textoTentativa(alvo, null, null);
  assert.match(sem, /Ainda não mandou proposta/);
});

test("recado com preço segue também para a leitura da proposta", () => {
  assert.ok(t.pareceProposta("faço por R$ 37,00 o saco"));
  assert.ok(t.pareceProposta("fica 37,50 cada"));
  assert.ok(!t.pareceProposta("consigo entregar em duas partes, 20 e 30 dias"));
});
