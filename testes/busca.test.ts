import assert from "node:assert/strict";
import { test } from "node:test";
import { contem, converter, kgNoTitulo, mediana, ordenar, relevante, tamanhoDoKit, type Termos } from "../src/agentes/busca/filtro.ts";
import { precoDoJsonLd, recorte, textoVisivel } from "../src/agentes/busca/pagina.ts";
import { lerPrecoBRL } from "../src/agentes/busca/serper.ts";
import { diasDoPrazo } from "../src/agentes/busca/vtex.ts";

const cimento: Termos = { grupos: [["cimento"], ["cp ii", "cpii", "cp-ii", "cp2"]], proibidas: ["rejunte"], conteudoKg: 50 };

test("relevância: precisa de uma palavra de cada grupo e nenhuma proibida", () => {
  assert.ok(relevante("Cimento Cinza CPII-E 50KG Campeão", cimento).ok);
  assert.ok(relevante("Cimento CP II E-32 50KGs Nacional", cimento).ok);
  assert.ok(!relevante("Cimento Cinza Cp Iii E 32 Rs Campeao 50Kg", cimento).ok);
  assert.ok(!relevante("Rejunte cimentício CP II", cimento).ok);
  const areia: Termos = { grupos: [["areia"]], proibidas: ["rejunte", "bacia"], conteudoKg: null };
  assert.equal(relevante("Rejunte Acrílico Areia 1kg", areia).motivo, "Outro produto (rejunte)");
});

test("contem compara por palavras", () => {
  assert.ok(contem("Cimento CPII-E 50KG", "cp ii"));
  assert.ok(contem("Cimento CP II E-32", "cpii"));
  assert.ok(contem("Cimento CPIIE 32", "cpii"));
  assert.ok(!contem("Cimento CP III E 32", "cp ii"));
  assert.ok(!contem("Saco 500kg", "50kg"));
  assert.ok(contem("Cimento 50KGs", "50kg"));
  assert.ok(contem("Vergalhão CA50 10mm", "ca-50"));
});

test("peso, kit e conversão", () => {
  assert.equal(kgNoTitulo("Cimento 50KGs"), 50);
  assert.equal(kgNoTitulo("Areia Média 20Kg Pedrasil"), 20);
  assert.equal(tamanhoDoKit("Kit 10 sacos cimento"), 10);
  assert.equal(tamanhoDoKit("Cimento CP II 50kg"), null);
  assert.equal(converter(38.9, "Cimento CP II 25kg", "saco", cimento).corte, "Outro tamanho (25 kg; pedido 50 kg)");
  assert.equal(converter(389, "Kit 10 sacos Cimento CP II 50kg", "saco", cimento).precoUnitario, 38.9);
  assert.match(converter(4.75, "Areia Média 20Kg", "m³", { grupos: [["areia"]], proibidas: [], conteudoKg: null }).corte!, /embalagem de 20 kg/);
  assert.match(converter(150, "Areia média a granel m³", "carrada", { grupos: [["areia"]], proibidas: [], conteudoKg: null }).corte!, /carrada/);
});

test("ordenar tira duplicadas e põe aceitas em estoque primeiro", () => {
  const base = { aceita: true, disponivel: true, confianca: 90, precoUnitario: 40 };
  const r = ordenar([
    { ...base, loja: "B", titulo: "x", url: "https://b/x", aceita: false },
    { ...base, loja: "A", titulo: "y", url: "https://a/y?utm=1" },
    { ...base, loja: "A", titulo: "y", url: "https://a/y" },
    { ...base, loja: "C", titulo: "z", url: "https://c/z", disponivel: false },
  ]);
  assert.deepEqual(r.map((x) => x.loja), ["A", "C", "B"]);
  assert.equal(mediana([3, 1, 2]), 2);
});

test("preços em texto, prazos VTEX e JSON-LD", () => {
  assert.equal(lerPrecoBRL("R$ 1.234,56"), 1234.56);
  assert.equal(lerPrecoBRL("R$38,90 à vista"), 38.9);
  assert.equal(lerPrecoBRL("sem preço"), null);
  assert.equal(diasDoPrazo("5bd"), 5);
  assert.equal(diasDoPrazo("2h"), 0);
  const html = `<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Cimento CP II 50kg","offers":{"@type":"Offer","price":"38.90","priceCurrency":"BRL","availability":"https://schema.org/InStock"}}]}</script></html>`;
  const p = precoDoJsonLd(html)!;
  assert.equal(p.preco, 38.9);
  assert.equal(p.disponivel, true);
  assert.equal(precoDoJsonLd("<html>sem nada</html>"), null);
});

test("recorte da página pega o texto em volta do preço", () => {
  const t = textoVisivel("<p>Cimento CP II</p><script>x</script><b>Por R$ 38,90</b>");
  assert.equal(t, "Cimento CP II Por R$ 38,90");
  assert.match(recorte(t, "Título"), /R\$ 38,90/);
});

test("link sem rastreamento", async () => {
  process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x";
  const { limparUrl } = await import("../src/agentes/busca/internet.ts");
  assert.equal(limparUrl("https://loja.com/p?srsltid=abc&utm_source=g&id=5"), "https://loja.com/p?id=5");
  assert.equal(limparUrl("https://loja.com/p?srsltid=abc"), "https://loja.com/p");
});
