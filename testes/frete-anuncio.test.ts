// R7: frete de loja fora da VTEX lido do JSON-LD do anúncio (fixtures, sem rede).
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
const { freteDoJsonLd, ufDoCep } = await import("../src/agentes/busca/frete.ts");
const { freteDaPagina, freteAnuncioDaReferencia, PREFIXO_FRETE_ANUNCIO } = await import("../src/agentes/busca/internet.ts");
const { comparar, lerExtraido, textoFrete } = await import("../src/agentes/comparador/index.ts");

/** Página de loja com um Product e as regras de frete dadas. */
const pagina = (shippingDetails: unknown, extra: Record<string, unknown> = {}) => `<!doctype html><html><head><title>Loja</title>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Cimento CP II 50 kg",
  offers: { "@type": "Offer", price: "38.90", priceCurrency: "BRL", availability: "https://schema.org/InStock", shippingDetails, ...extra },
})}</script></head><body>R$ 38,90</body></html>`;

const taxa = (value: number | string, currency = "BRL") => ({ "@type": "MonetaryAmount", value, currency });
const prazo = (manuseio: number, transporte: number) => ({
  "@type": "ShippingDeliveryTime",
  handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: manuseio, unitCode: "DAY" },
  transitTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: transporte, unitCode: "DAY" },
});

test("UF do CEP pelas faixas dos Correios", () => {
  assert.equal(ufDoCep("01310-100"), "SP");
  assert.equal(ufDoCep("20040-002"), "RJ");
  assert.equal(ufDoCep("70040010"), "DF");
  assert.equal(ufDoCep("69301-000"), "RR");
  assert.equal(ufDoCep("1234"), null);
});

test("faixa de CEP que cobre o pedido: frete no CEP, com prazo e a regra da loja", () => {
  const html = pagina([
    { "@type": "OfferShippingDetails", shippingRate: taxa(19.9), shippingDestination: { "@type": "DefinedRegion", addressCountry: "BR", postalCodeRange: { postalCodeBegin: "01000-000", postalCodeEnd: "05999-999" } }, deliveryTime: prazo(1, 3) },
    { "@type": "OfferShippingDetails", shippingRate: taxa(49.9), shippingDestination: { "@type": "DefinedRegion", addressCountry: "BR" }, deliveryTime: prazo(1, 10) },
  ]);
  const f = freteDoJsonLd(html, "01310-100");
  assert.ok(f && f.entrega);
  assert.equal(f.valor, 19.9);
  assert.equal(f.prazoDias, 4);
  assert.equal(f.noCep, true);
  assert.equal(f.regra, "faixa 01000-000 a 05999-999");
  assert.match(f.trecho, /postalCodeRange/);
});

test("faixa que não cobre o CEP: vale a regra nacional, sem conferir o CEP", () => {
  const html = pagina([
    { shippingRate: taxa(19.9), shippingDestination: { addressCountry: "BR", postalCodeRange: { postalCodeBegin: "01000000", postalCodeEnd: "05999999" } } },
    { shippingRate: taxa("49,90"), shippingDestination: { addressCountry: "BR" } },
  ]);
  const f = freteDoJsonLd(html, "20040-002");
  assert.ok(f && f.entrega);
  assert.equal(f.valor, 49.9);
  assert.equal(f.noCep, false);
  assert.equal(f.regra, "Brasil");
  assert.equal(f.prazoDias, null);
});

test("frete por UF e frete grátis declarados contam; moeda estrangeira não", () => {
  const html = pagina([
    { shippingRate: taxa(0), shippingDestination: { addressCountry: "BR", addressRegion: ["SP", "RJ"] }, deliveryTime: prazo(0, 2) },
    { shippingRate: taxa(5, "USD"), shippingDestination: { addressCountry: "BR", addressRegion: "MG" } },
  ]);
  const sp = freteDoJsonLd(html, "01310100");
  assert.ok(sp && sp.entrega);
  assert.equal(sp.valor, 0);
  assert.equal(sp.regra, "UF SP");
  // MG só tem a regra em dólar: nada que sirva.
  assert.equal(freteDoJsonLd(html, "30110-000"), null);
});

test("doesNotShip para o CEP vira 'não entrega'; sem CEP só a regra nacional serve", () => {
  const html = pagina([
    { doesNotShip: true, shippingDestination: { addressCountry: "BR", addressRegion: "AM" } },
    { shippingRate: taxa(30), shippingDestination: { addressCountry: "BR", addressRegion: "SP" } },
  ]);
  const am = freteDoJsonLd(html, "69005-000");
  assert.ok(am && !am.entrega);
  assert.equal(am.regra, "UF AM");
  assert.equal(freteDoJsonLd(html, null), null);
  const nacional = pagina({ shippingRate: taxa(25) });
  const f = freteDoJsonLd(nacional, null);
  assert.ok(f && f.entrega && !f.noCep && f.valor === 25);
});

test("página sem shippingDetails não inventa frete", () => {
  assert.equal(freteDoJsonLd(pagina(undefined), "01310-100"), null);
  assert.equal(freteDoJsonLd("<html><body>Frete grátis acima de R$ 199</body></html>", "01310-100"), null);
});

test("campos da coleta: no CEP, Brasil todo e não entrega", () => {
  const noCep = freteDaPagina({ entrega: true, valor: 19.9, prazoDias: 4, noCep: true, regra: "UF SP", trecho: "{}" }, "01310-100");
  assert.equal(noCep.frete, 19.9);
  assert.equal(noCep.entregaNoCep, true);
  assert.equal(noCep.fretePrazoDias, 4);
  assert.equal(noCep.regiaoDoPreco, `${PREFIXO_FRETE_ANUNCIO} para o CEP 01310-100 (UF SP)`);
  const brasil = freteDaPagina({ entrega: true, valor: 49.9, prazoDias: null, noCep: false, regra: "Brasil", trecho: "{}" }, "20040-002");
  assert.equal(brasil.entregaNoCep, null);
  assert.match(brasil.regiaoDoPreco!, /^Frete do anúncio: R\$\s49,90 para o Brasil, sem faixa de CEP conferida$/);
  const nao = freteDaPagina({ entrega: false, regra: "UF AM", trecho: "{}" }, "69005-000");
  assert.equal(nao.entregaNoCep, false);
  assert.equal(nao.frete, null);
  const nada = freteDaPagina(null, "01310-100");
  assert.equal(nada.regiaoDoPreco, "Preço do site, sem CEP");
});

test("referência com frete do anúncio vai para a proposta com fonte e hora; VTEX não", () => {
  const base = { frete: "49.90", entregaNoCep: null, coletadoEm: new Date("2026-11-08T17:02:00Z"), url: "https://loja.exemplo/p" };
  const a = freteAnuncioDaReferencia({ ...base, metodo: "jsonld", regiaoDoPreco: `${PREFIXO_FRETE_ANUNCIO}: R$ 49,90 para o Brasil, sem faixa de CEP conferida` });
  assert.deepEqual(a, { valor: 49.9, noCep: false, fonte: `${PREFIXO_FRETE_ANUNCIO}: R$ 49,90 para o Brasil, sem faixa de CEP conferida`, url: base.url, coletadoEm: "2026-11-08T17:02:00.000Z" });
  assert.equal(freteAnuncioDaReferencia({ ...base, metodo: "vtex_api", regiaoDoPreco: "Entrega no CEP 01310-100" }), null);
  assert.equal(freteAnuncioDaReferencia({ ...base, frete: null, metodo: "jsonld", regiaoDoPreco: "Preço do site, sem CEP" }), null);
});

test("mapa: frete do anúncio sem CEP entra como 'a calcular' com o valor do anúncio, não a mediana", () => {
  const extraido = { freteAnuncio: { valor: 49.9, noCep: false, fonte: "Frete do anúncio: R$ 49,90 para o Brasil", coletadoEm: "2026-11-08T17:02:00.000Z" } };
  const lido = lerExtraido(extraido);
  assert.equal(lido.freteAnuncio?.valor, 49.9);
  const oferta = (id: string, frete: number | null, extra: object = {}) => ({
    id, fornecedorId: id, fornecedorNome: id, simulado: true, verificado: false, homologado: false, conhecido: false,
    itemOferecido: "Cimento", itemExato: true, precoUnitario: 40, totalProduto: null, frete, impostosValor: 0, impostosNaoInclusos: null,
    prazoDias: 3, validadeDias: 5, pagamento: "Pix", prazoPagamentoDias: 0, entregaNoLocal: true, precoConfirmado: false, ...extra,
  });
  const c = comparar({ quantidade: 10, aceitaSimilar: false, prazoMaxDias: null, modoEntrega: "entrega", urgencia: "normal" }, [
    oferta("A", 10),
    oferta("B", 20),
    oferta("Loja", null, { online: true, fonte: "https://loja.exemplo/p", ...lido }),
  ]);
  const loja = c.validas.find((l) => l.oferta.id === "Loja")!;
  assert.equal(loja.origemFrete, "a_calcular");
  assert.equal(loja.frete, 49.9);
  assert.equal(loja.custo, 449.9);
  assert.ok(loja.alertas.some((a) => /frete do anúncio R\$\s49,90, coletado às 14:02, para o Brasil, sem conferir o CEP/.test(a)));
  assert.match(textoFrete(loja), /frete a calcular no site \(frete do anúncio R\$\s49,90, coletado às 14:02, sem conferir o CEP\)/);

  // Com a regra cobrindo o CEP, o frete é informado (veio do anúncio) e o mapa diz de onde.
  const noCep = lerExtraido({ freteAnuncio: { ...extraido.freteAnuncio, noCep: true } });
  const c2 = comparar({ quantidade: 10, aceitaSimilar: false, prazoMaxDias: null, modoEntrega: "entrega", urgencia: "normal" }, [oferta("Loja", 19.9, { online: true, ...noCep })]);
  assert.equal(c2.validas[0]!.origemFrete, "informado");
  assert.match(textoFrete(c2.validas[0]!), /\(do anúncio, para o CEP\)/);
});
