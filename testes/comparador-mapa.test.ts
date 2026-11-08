// Texto do mapa e leitura de oferta.extraido, sem banco e sem IA.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // o módulo exige a variável; nada conecta aqui
const { comparar, lerExtraido, textoBuscaAutomatica, textoFrete, textoMapa } = await import("../src/agentes/comparador/index.ts");
type OfertaComparavel = import("../src/agentes/comparador/calculo.ts").OfertaComparavel;

const item = { quantidade: 10, aceitaSimilar: false, prazoMaxDias: null, modoEntrega: "entrega" as const, urgencia: "normal" as const };
let seq = 0;
const oferta = (p: Partial<OfertaComparavel>): OfertaComparavel => {
  seq++;
  return {
    id: `o${seq}`, fornecedorId: `f${seq}`, fornecedorNome: `F${seq}`, simulado: false, verificado: false, homologado: false,
    conhecido: false, itemOferecido: "Papel A4", itemExato: true, precoUnitario: 30, totalProduto: null, frete: 20,
    impostosValor: null, impostosNaoInclusos: "inclusos", prazoDias: 2, validadeDias: 7, pagamento: "boleto 28 dias",
    prazoPagamentoDias: 28, entregaNoLocal: true, precoConfirmado: false, ...p,
  };
};

test("lerExtraido: alertas, divergências, preço a confirmar e a marca do desconto", () => {
  const l = lerExtraido({
    alertas: ["propina", 3],
    divergencias: ["marca X, não exigida", " "],
    aConfirmar: ["preco", "outro"],
    precoUnitario: 300,
    negociacao: { pedidaEm: "2026-11-08T10:00:00Z", resultado: "condicional", condicao: "3% no pix", descontoFrete: 0 },
  });
  assert.deepEqual(l.alertasConduta, ["propina"]);
  assert.deepEqual(l.divergencias, ["marca X, não exigida"]);
  assert.deepEqual(l.aConfirmar, ["preco"]);
  assert.equal(l.precoLido, 300);
  assert.deepEqual(l.negociacao, { resultado: "condicional", descontoFrete: 0, condicao: "3% no pix" });
  // Marca sem pedidaEm não vale (mesmo critério de marcaDe); extraido vazio não quebra.
  assert.equal(lerExtraido({ negociacao: { resultado: "manteve" } }).negociacao, null);
  assert.deepEqual(lerExtraido(null), { alertasConduta: [], divergencias: [], aConfirmar: [], precoLido: null, aumento: null, negociacao: null });
});

test("frete no texto: informado, estimado, a calcular no site e retirada", () => {
  assert.equal(textoFrete({ origemFrete: "informado", frete: 20 }), "frete R$\u00a020,00 (informado)");
  assert.equal(textoFrete({ origemFrete: "a_calcular", frete: 20 }), "frete a calcular no site (estimado R$\u00a020,00 só para comparar)");
  assert.equal(textoFrete({ origemFrete: "nao_se_aplica", frete: 0 }), "retirada");
});

test("busca automática: levas, fornecedores e o teto", () => {
  assert.equal(textoBuscaAutomatica({ fornecedores: 5, levas: 2, teto: 2 }, 3), "Busca automática: consultei mais 5 fornecedores em 2 levas, porque faltavam propostas válidas.");
  assert.match(textoBuscaAutomatica({ fornecedores: 5, levas: 2, teto: 2 }, 1), /Parei no limite de 2 levas\.$/);
  assert.doesNotMatch(textoBuscaAutomatica({ fornecedores: 1, levas: 1, teto: 2 }, 1), /Parei/);
  assert.match(textoBuscaAutomatica({ fornecedores: 1, levas: 1, teto: 2 }, 1), /mais 1 fornecedor em 1 leva/);
});

test("texto do mapa: a confirmar à parte, pagamento preferido, aviso de atualizado e total estimado da loja", () => {
  const c = comparar(item, [
    oferta({ precoUnitario: 30 }),
    oferta({ precoUnitario: 32, frete: null, online: true }),
    oferta({ precoUnitario: null, aConfirmar: ["preco"], precoLido: 300 }),
    oferta({ alertasConduta: ["sem_nota"] }),
  ]);
  const t = textoMapa({
    c,
    cabecalho: "Pedido 7 · 10 resmas de Papel A4",
    rodada: 1,
    recebidas: 4,
    consultados: 3,
    recomendacao: "É a de menor custo.",
    urgente: false,
    pagamentoPreferido: "boleto 28 dias",
    busca: "Busca automática: consultei mais 2 fornecedores em 1 leva, porque faltavam propostas válidas.",
    aviso: "Mapa atualizado: F9 saiu.",
  });
  assert.match(t, /^Pedido 7 · 10 resmas de Papel A4\nMapa atualizado: F9 saiu\.\nMapa de cotação: 2 propostas válidas de 4 recebidas \(3 fornecedores consultados e 1 loja online\)\./);
  assert.match(t, /Busca automática: consultei mais 2/);
  assert.match(t, /Pagamento preferido: boleto 28 dias\./);
  assert.match(t, /Unitário R\$\s\d+,\d{2} · total estimado R\$\s340,00\n   \(produto R\$\s320,00 \+ frete a calcular no site/);
  assert.match(t, /A confirmar com o fornecedor \(fora do ranking até responder\):\n- F\d+: Preço a confirmar/);
  assert.match(t, /Fora da comparação:\n- F\d+: Preço sem nota fiscal/);
  assert.match(t, /pagamento: boleto 28 dias/);
});
