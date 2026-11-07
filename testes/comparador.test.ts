import assert from "node:assert/strict";
import { test } from "node:test";
import { comparar, mediana, type ItemComparado, type OfertaComparavel } from "../src/agentes/comparador/calculo.ts";

const item: ItemComparado = { quantidade: 40, aceitaSimilar: false, prazoMaxDias: 5, modoEntrega: "entrega", urgencia: "normal" };

let seq = 0;
function oferta(p: Partial<OfertaComparavel>): OfertaComparavel {
  seq++;
  return {
    id: `o${seq}`, fornecedorId: `f${seq}`, fornecedorNome: `F${seq}`, simulado: true, verificado: false, homologado: false,
    conhecido: false, itemOferecido: "Cimento CP II", itemExato: true, precoUnitario: 40, totalProduto: null, frete: 50,
    impostosValor: null, impostosNaoInclusos: "inclusos", prazoDias: 2, validadeDias: 7, pagamento: "boleto 28 dias",
    prazoPagamentoDias: 28, entregaNoLocal: true, precoConfirmado: false, ...p,
  };
}

test("mediana", () => {
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([1, 2, 3, 4]), 2.5);
});

test("custo total soma produto, frete e impostos", () => {
  const c = comparar(item, [oferta({ precoUnitario: 40, frete: 60, impostosValor: 10 })]);
  assert.equal(c.validas[0]!.custo, 40 * 40 + 60 + 10);
});

test("total informado vale mais que unitário × quantidade (embalagens diferentes)", () => {
  const c = comparar(item, [oferta({ precoUnitario: null, totalProduto: 1500 })]);
  assert.equal(c.validas[0]!.produto, 1500);
});

test("frete não informado vira estimado pela mediana dos informados", () => {
  const c = comparar(item, [oferta({ frete: 40 }), oferta({ frete: 80 }), oferta({ frete: null })]);
  const est = [...c.validas, ...c.cortadas].find((l) => l.origemFrete === "estimado")!;
  assert.equal(est.frete, 60);
  assert.ok(est.alertas.some((a) => a.includes("estimado")));
});

test("retirada não soma frete", () => {
  const c = comparar({ ...item, modoEntrega: "retirada" }, [oferta({ frete: 99 })]);
  assert.equal(c.validas[0]!.origemFrete, "nao_se_aplica");
  assert.equal(c.validas[0]!.frete, 0);
});

test("portões: prazo, item parecido e entrega no local", () => {
  const c = comparar(item, [
    oferta({ prazoDias: 10 }),
    oferta({ itemExato: false }),
    oferta({ entregaNoLocal: false }),
    oferta({}),
  ]);
  assert.equal(c.validas.length, 1);
  const motivos = c.cortadas.flatMap((l) => l.motivos);
  assert.ok(motivos.includes("Entrega depois do prazo do pedido"));
  assert.ok(motivos.includes("Item parecido sem aceite do comprador"));
  assert.ok(motivos.includes("Não entrega no local"));
  assert.equal(c.podeDizerMelhor, false);
});

test("similar passa quando o comprador aceita", () => {
  const c = comparar({ ...item, aceitaSimilar: true }, [oferta({ itemExato: false })]);
  assert.equal(c.validas.length, 1);
});

test("preço 30% abaixo da referência fica retido até confirmar", () => {
  const ofertas = [oferta({ precoUnitario: 40 }), oferta({ precoUnitario: 41 }), oferta({ precoUnitario: 25 })];
  const c = comparar(item, ofertas);
  assert.equal(c.cortadas.length, 1);
  assert.match(c.cortadas[0]!.motivos[0]!, /abaixo da referência/);
  const confirmado = comparar(item, [ofertas[0]!, ofertas[1]!, { ...ofertas[2]!, precoConfirmado: true }]);
  assert.equal(confirmado.cortadas.length, 0);
});

test("urgência dobra o peso do prazo e o mais rápido pode ganhar sendo mais caro", () => {
  const barata = oferta({ precoUnitario: 38, prazoDias: 5 });
  const rapida = oferta({ precoUnitario: 41, prazoDias: 1 });
  const normal = comparar(item, [barata, rapida, oferta({ precoUnitario: 40, prazoDias: 3 })]);
  const urgente = comparar({ ...item, urgencia: "obra_parada" }, [barata, rapida, oferta({ precoUnitario: 40, prazoDias: 3 })]);
  assert.equal(urgente.pesos.prazo, 50);
  assert.equal(urgente.vencedora!.oferta.id, rapida.id);
  assert.ok(urgente.aMaisQueAMaisBarata > 0);
  assert.equal(normal.pesos.prazo, 25);
});

test("pagamento antecipado com fornecedor novo gera alerta", () => {
  const c = comparar(item, [oferta({ prazoPagamentoDias: 0, pagamento: "PIX antecipado" })]);
  assert.ok(c.validas[0]!.alertas.includes("Pagamento antecipado com fornecedor novo"));
});
