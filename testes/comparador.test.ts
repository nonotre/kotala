import assert from "node:assert/strict";
import { test } from "node:test";
import { comparar, mediana, mudancasDoMapa, negociacaoDaLinha, type ItemComparado, type OfertaComparavel } from "../src/agentes/comparador/calculo.ts";

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

// ---------- Pedidos da Frente 4: guardrails, Q1, Q7, Q8 e negociação ----------

test("S: sem nota e item irregular saem do ranking; propina e pagamento por fora vão para Atenção", () => {
  const c = comparar(item, [
    oferta({ alertasConduta: ["sem_nota"] }),
    oferta({ alertasConduta: ["item_irregular"] }),
    oferta({ alertasConduta: ["propina", "pagamento_por_fora"] }),
  ]);
  assert.equal(c.validas.length, 1);
  assert.deepEqual(c.validas[0]!.alertas.slice(0, 2), ["Ofereceu comissão ou vantagem ao comprador", "Pediu pagamento por fora (conta pessoal, link ou cripto)"]);
  const motivos = c.cortadas.flatMap((l) => l.motivos);
  assert.ok(motivos.includes("Preço sem nota fiscal"));
  assert.ok(motivos.some((m) => m.startsWith("Item irregular")));
  assert.ok(c.cortadas.every((l) => !l.aConfirmar));
});

test("Q1: preço ambíguo fica 'a confirmar', com o número lido, e não ganha", () => {
  const c = comparar(item, [oferta({ precoUnitario: null, aConfirmar: ["preco"], precoLido: 300 }), oferta({ precoUnitario: 45 })]);
  assert.equal(c.vencedora!.oferta.precoUnitario, 45);
  const pendente = c.cortadas[0]!;
  assert.equal(pendente.aConfirmar, true);
  assert.deepEqual(pendente.motivos, ["Preço a confirmar (R$\u00a0300,00: por unidade ou total?)"]);
});

test("Q2: item a confirmar e divergências viram alerta, sem corte", () => {
  const c = comparar(item, [oferta({ aConfirmar: ["item"], divergencias: ["embalagem 25 kg"] })]);
  assert.equal(c.validas.length, 1);
  assert.ok(c.validas[0]!.alertas.includes("Item a confirmar com o fornecedor"));
  assert.ok(c.validas[0]!.alertas.includes("Difere do pedido: embalagem 25 kg"));
});

test("R8: preço retido conta como 'a confirmar'; outro motivo junto não", () => {
  const c = comparar(item, [oferta({ precoUnitario: 40 }), oferta({ precoUnitario: 41 }), oferta({ precoUnitario: 42 }), oferta({ precoUnitario: 25 }), oferta({ precoUnitario: 20, prazoDias: 10 })]);
  const retida = c.cortadas.find((l) => l.oferta.precoUnitario === 25)!;
  const tardia = c.cortadas.find((l) => l.oferta.precoUnitario === 20)!;
  assert.equal(retida.aConfirmar, true);
  assert.equal(tardia.aConfirmar, false);
});

test("Q7: a referência do portão vem só de fornecedores físicos; a internet só alerta", () => {
  // Um físico barato e a referência pública alta: antes ficava retido, agora só alerta.
  const sozinho = comparar(item, [oferta({ precoUnitario: 20 })], 40);
  assert.equal(sozinho.validas.length, 1);
  assert.equal(sozinho.referenciaUnitaria, 0);
  assert.equal(sozinho.referenciaOnline, 40);
  assert.ok(sozinho.validas[0]!.alertas.includes("Preço 50% abaixo da referência online"));
  // Lojas online baratas não puxam a mediana para baixo nem são retidas.
  const c = comparar(item, [
    oferta({ precoUnitario: 40 }),
    oferta({ precoUnitario: 42 }),
    oferta({ precoUnitario: 20, online: true }),
    oferta({ precoUnitario: 21, online: true }),
  ]);
  assert.equal(c.referenciaUnitaria, 41);
  assert.equal(c.validas.length, 4);
  const caro = comparar(item, [oferta({ precoUnitario: 60 })], 40);
  assert.ok(caro.validas[0]!.alertas.includes("Preço 50% acima da referência online"));
});

test("Q8: loja online sem frete fica 'a calcular no site', com estimativa só para comparar", () => {
  const c = comparar(item, [oferta({ frete: 40 }), oferta({ frete: null, online: true })]);
  const loja = c.validas.find((l) => l.oferta.online)!;
  assert.equal(loja.origemFrete, "a_calcular");
  assert.equal(loja.frete, 40);
  assert.ok(loja.alertas.includes("Frete a calcular no site: a estimativa serve só para comparar"));
  assert.ok(!loja.alertas.includes("Frete não informado: valor estimado"));
});

test("I1: negociação no mapa (desconto, manteve, não respondeu, subiu, condicional)", () => {
  const o = oferta({});
  assert.equal(negociacaoDaLinha({ ...o, produtoAnterior: 1600 }, 1520).texto, "Desconto obtido: R$\u00a080,00 (de R$\u00a01.600,00 para R$\u00a01.520,00)");
  assert.equal(negociacaoDaLinha({ ...o, produtoAnterior: 1600, negociacao: { resultado: "manteve" } }, 1600).texto, "Pedi desconto: manteve o preço");
  assert.equal(negociacaoDaLinha({ ...o, negociacao: { resultado: "sem_resposta" } }, 1600).texto, "Pedi desconto: não respondeu");
  assert.equal(negociacaoDaLinha({ ...o, negociacao: { resultado: null } }, 1600).texto, "Pedi desconto: não respondeu");
  const subiu = negociacaoDaLinha({ ...o, produtoAnterior: 1600, negociacao: { resultado: "subiu" } }, 1700);
  assert.equal(subiu.texto, null);
  assert.deepEqual(subiu.alertas, ["Subiu o preço depois do pedido de desconto (de R$\u00a01.600,00 para R$\u00a01.700,00)"]);
  const cond = negociacaoDaLinha({ ...o, produtoAnterior: 1600, negociacao: { resultado: "condicional", condicao: "3% à vista" } }, 1600);
  assert.equal(cond.texto, "Pedi desconto: só com condição");
  assert.deepEqual(cond.alertas, ['Desconto condicionado, não aplicado ao total: "3% à vista"']);
  assert.equal(negociacaoDaLinha({ ...o, produtoAnterior: 1600, negociacao: { resultado: "desconto", descontoFrete: 10 } }, 1600).texto, "Desconto obtido: frete R$\u00a010,00 mais barato");
  // Sem negociação e sem preço anterior: nada.
  assert.deepEqual(negociacaoDaLinha(o, 1600), { texto: null, alertas: [] });
  // A linha do mapa leva o texto e os alertas.
  const c = comparar(item, [oferta({ produtoAnterior: 1700, negociacao: { resultado: "desconto" } })]);
  assert.match(c.validas[0]!.negociacao!, /^Desconto obtido/);
});

test("Q6: o que mudou entre o mapa e o refeito", () => {
  const a = oferta({ fornecedorNome: "A", precoUnitario: 40 });
  const b = oferta({ fornecedorNome: "B", precoUnitario: 39 });
  const cc = oferta({ fornecedorNome: "C", precoUnitario: 41 });
  const antes = comparar(item, [a, b]);
  const depois = comparar(item, [a, cc]);
  assert.deepEqual(mudancasDoMapa(antes, depois), ["C entrou na comparação", "B saiu", "agora na frente: A"]);
  assert.deepEqual(mudancasDoMapa(antes, antes), []);
});

test("R3b: proposta que subiu aparece em Atenção no mapa", async () => {
  const { lerExtraido } = await import("../src/agentes/comparador/index.ts");
  assert.equal(lerExtraido({ aumento: "produto de R$ 40,00 para R$ 45,00" }).aumento, "produto de R$ 40,00 para R$ 45,00");
  assert.equal(lerExtraido({}).aumento, null);
});
