// Q1: PDF do mapa de cotação, montado à mão (sem dependência). Sem banco e sem rede.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
const { comparar } = await import("../src/agentes/comparador/calculo.ts");
const { blocosDoMapa, documentoPdf, larguraTexto, nomeArquivoMapa, pdfDoMapa, quebrar } = await import("../src/agentes/comparador/pdf.ts");

/** O PDF como texto Latin-1 (os textos ficam em strings literais, sem compressão). */
const comoTexto = (pdf: Uint8Array) => Buffer.from(pdf).toString("latin1");

/** Confere a tabela xref: cada posição aponta para "N 0 obj". */
function conferirEstrutura(pdf: Uint8Array) {
  const t = comoTexto(pdf);
  assert.ok(t.startsWith("%PDF-1.4\n"));
  assert.ok(t.endsWith("%%EOF\n"));
  const inicio = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(t)![1]);
  assert.ok(t.slice(inicio).startsWith("xref\n"));
  const linhas = t.slice(inicio).split("\n");
  const n = Number(linhas[1]!.split(" ")[1]);
  for (let i = 1; i < n; i++) {
    const pos = Number(linhas[2 + i]!.slice(0, 10));
    assert.ok(t.slice(pos).startsWith(`${i} 0 obj`), `objeto ${i} fora do lugar`);
  }
  // Cada stream tem o tamanho que diz.
  for (const m of t.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const comeco = m.index! + m[0].length;
    assert.equal(t.slice(comeco + Number(m[1]), comeco + Number(m[1]) + 10), "\nendstream");
  }
}

const oferta = (id: string, preco: number, extra: object = {}) => ({
  id, fornecedorId: id, fornecedorNome: `Depósito ${id}`, simulado: true, verificado: false, homologado: false, conhecido: false,
  itemOferecido: "Cimento CP II 50 kg", itemExato: true, precoUnitario: preco, totalProduto: null, frete: 50, impostosValor: 0, impostosNaoInclusos: null,
  prazoDias: 3, validadeDias: 7, pagamento: "boleto 28 dias", prazoPagamentoDias: 28, entregaNoLocal: true, precoConfirmado: false, ...extra,
});

function entrada() {
  const c = comparar({ quantidade: 40, aceitaSimilar: false, prazoMaxDias: 5, modoEntrega: "entrega", urgencia: "normal" }, [
    oferta("A", 38),
    oferta("B", 41),
    oferta("C", 39, { prazoDias: 10 }),
    oferta("D", 30, { alertasConduta: ["sem_nota"] }),
    oferta("Loja", 45, { simulado: false, online: true, fonte: "https://loja.exemplo/cimento-cp-ii/p", frete: null }),
  ]);
  return {
    empresa: "Construtora Exemplo Ltda.",
    pedido: { id: 12, destino: "Rua das Obras, 100 (São Paulo)", cep: "01310-100", modoEntrega: "entrega" as const, prazoTexto: "até sexta", urgencia: "normal", pagamentoPreferido: "Pix", setor: "manutenção" },
    item: { id: 34, descricao: "Cimento CP II 50 kg", quantidade: "40", unidade: "saco", justificativaMenosDeTres: null },
    rodada: 1,
    comparacao: c,
    recomendacao: "Depósito A tem a melhor nota com os critérios atuais. É também a de menor custo total.",
    consultados: 4,
    mapaEm: new Date("2026-11-08T17:02:00Z"),
  };
}

test("largura e quebra: cabe na linha, palavra longa (link) é cortada", () => {
  assert.ok(Math.abs(larguraTexto("Mapa", 10) - 25.01) < 0.01);
  assert.ok(larguraTexto("ção", 10) > 0);
  const linhas = quebrar("Recomendo o Depósito A porque tem a melhor nota e o menor custo total entre as propostas válidas recebidas", 150, 10);
  assert.ok(linhas.length > 1);
  for (const l of linhas) assert.ok(larguraTexto(l, 10) <= 150, l);
  const link = quebrar(`https://loja.exemplo/${"x".repeat(200)}`, 100, 10);
  assert.ok(link.length > 2);
  assert.equal(link.join(""), `https://loja.exemplo/${"x".repeat(200)}`);
});

test("PDF do mapa: itens, válidas com unitário e total, cortadas e por quê, recomendação e data", () => {
  const e = entrada();
  const pdf = pdfDoMapa(e);
  conferirEstrutura(pdf);
  // Sem os escapes das strings do PDF, para ler como o comprador lê.
  const t = comoTexto(pdf).replace(/\\([()\\])/g, "$1");
  assert.match(t, /0 g \/F2 18 Tf 50 [\d.]+ Td \(Mapa de cotação\) Tj/);
  assert.match(t, /\(Pedido 12 · setor manutenção · cotação 34\) Tj/);
  assert.match(t, /\(40 sacos de Cimento CP II 50 kg\) Tj/);
  assert.match(t, /Mapa montado em 08\/11\/2026, 14:02/);
  assert.match(t, /\(1\. Depósito A \(simulado\) · recomendada\) Tj/);
  assert.match(t, /Unitário R\$\xa038,00 · Total R\$\xa01\.570,00/);
  assert.match(t, /Total estimado/); // a loja online sem frete
  assert.match(t, /Anúncio: https:\/\/loja\.exemplo\/cimento-cp-ii\/p/);
  assert.match(t, /\(Fora da comparação, e por quê\) Tj/);
  assert.match(t, /Depósito C \(simulado\) \(R\$\xa01\.610,00\): Entrega depois do prazo do pedido/);
  assert.match(t, /Depósito D \(simulado\)[^)]*\): Preço sem nota fiscal/);
  assert.match(t, /\(Recomendo: Depósito A \(simulado\), R\$\xa01\.570,00\.\) Tj/);
  assert.match(t, /Depósito A tem a melhor nota/);
  assert.match(t, /página 1 de 1/);
  assert.match(t, /\/Title \(Mapa de cotação · pedido 12 · Cimento CP II 50 kg\)/);
  assert.equal(nomeArquivoMapa(12, 34, 1), "mapa-pedido-12-cotacao-34-rodada-1.pdf");
});

test("mapa grande vira várias páginas, com o rodapé contando todas", () => {
  const blocos = Array.from({ length: 120 }, (_, i) => ({ texto: `Linha ${i + 1} do mapa (com parênteses e \\ barra)` }));
  const pdf = documentoPdf(blocos, { titulo: "Teste", rodape: "Rodapé" });
  conferirEstrutura(pdf);
  const t = comoTexto(pdf);
  const paginas = Number(/\/Count (\d+)/.exec(t)![1]);
  assert.ok(paginas >= 2);
  assert.match(t, new RegExp(`página ${paginas} de ${paginas}`));
  assert.match(t, /\(Linha 120 do mapa \\\(com parênteses e \\\\ barra\\\)\) Tj/);
});

test("menos de 3 válidas: o PDF não diz 'Recomendo' e traz a justificativa", () => {
  const e = entrada();
  const c = comparar({ quantidade: 40, aceitaSimilar: false, prazoMaxDias: null, modoEntrega: "entrega", urgencia: "urgente" }, [oferta("A", 38)]);
  const t = blocosDoMapa({ ...e, comparacao: c, item: { ...e.item, justificativaMenosDeTres: "Apenas 1 proposta válida: pedido urgente." } })
    .map((b) => ("texto" in b ? b.texto : "---"))
    .join("\n");
  assert.match(t, /Na frente: Depósito A/);
  assert.doesNotMatch(t, /Recomendo:/);
  assert.match(t, /Apenas 1 proposta válida: pedido urgente\./);
  assert.match(t, /prazo em dobro: pedido urgente/);
});
