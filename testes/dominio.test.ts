// Generalista por dados (item G e Q4): categorias, unidades, atributos e CNAE por categoria.

import assert from "node:assert/strict";
import { test } from "node:test";
import { atividadeCompativel, atributosFaltando, categoriasDoCadastro, detectarCategoria, detectarCategorias, exemplosDoNicho, regraDeUnidade } from "../src/dominio/categorias.ts";
import { conteudoNoTitulo, converterUnidade, normalizarUnidade, unidadeAceita } from "../src/dominio/unidades.ts";
import { textoJargao } from "../src/agentes/interpretador/jargao.ts";
import { converter, tamanhoDoKit, type Termos } from "../src/agentes/busca/filtro.ts";
import { lojasParaCategorias } from "../src/agentes/busca/vtex.ts";
import { julgar, type EntradaJulgamento } from "../src/agentes/verificacao/confianca.ts";
import { palavras } from "../src/agentes/interpretador/base-itens.ts";

test("detecta a categoria pelo texto, de obra e de outras áreas", () => {
  assert.equal(detectarCategoria("Areia média lavada").id, "agregados");
  assert.equal(detectarCategoria("Cimento CP II 50 kg").id, "cimenticios");
  assert.equal(detectarCategoria("Papel A4 75 g, resma").id, "escritorio");
  assert.equal(detectarCategoria("Extintor de pó ABC").id, "extintores");
  assert.equal(detectarCategoria("luvas de raspa").id, "epi");
  assert.equal(detectarCategoria("cabo HDMI 2 m").id, "informatica");
  assert.equal(detectarCategoria("papel higiênico").id, "limpeza");
  assert.equal(detectarCategoria("manutenção de ar-condicionado").id, "manutencao");
  assert.equal(detectarCategoria("bom dia").id, "geral");
  assert.deepEqual(detectarCategorias("bom dia"), []);
});

test("agregados como dado: unidade fora das aceitas gera a pergunta de antes", () => {
  const r = regraDeUnidade({ descricao: "Areia média", quantidade: 2, unidade: "carradas" });
  assert.equal(r?.pergunta, "Areia média: quantos m³ (ou toneladas) são as 2 carradas?");
  assert.equal(regraDeUnidade({ descricao: "Brita 1", unidade: "metros cúbicos" }), null);
  assert.equal(regraDeUnidade({ descricao: "Pó de pedra", unidade: "t" }), null);
  // Outra categoria não herda a regra.
  assert.equal(regraDeUnidade({ descricao: "Papel A4", unidade: "resma" }), null);
  assert.equal(regraDeUnidade({ descricao: "Cimento CP II", unidade: "saco" }), null);
});

test("unidades: normaliza plural e converte só o que é seguro", () => {
  assert.equal(normalizarUnidade("Sacos")?.id, "saco");
  assert.equal(normalizarUnidade("metros cúbicos")?.id, "m3");
  assert.ok(unidadeAceita("toneladas", ["m³", "t"]));
  assert.ok(!unidadeAceita("carrada", ["m³", "t"]));
  assert.equal(converterUnidade(5000, "g", "kg"), 5);
  assert.equal(converterUnidade(500, "ml", "L"), 0.5);
  assert.equal(converterUnidade(2, "milheiro", "un"), 2000);
  assert.equal(converterUnidade(1, "caixa", "un"), null);
  assert.equal(converterUnidade(1, "carrada", "m³"), null);
  assert.equal(converterUnidade(1, "kg", "L"), null);
});

test("conteúdo por embalagem com unidade; gramatura do papel não conta", () => {
  assert.deepEqual(conteudoNoTitulo("Cimento 50KG"), { valor: 50, unidade: "kg" });
  assert.deepEqual(conteudoNoTitulo("Papel A4 75g/m² 500 folhas"), { valor: 500, unidade: "folha" });
  assert.deepEqual(conteudoNoTitulo("Tinta 3,6 L", "liquido"), { valor: 3.6, unidade: "l" });
  assert.equal(conteudoNoTitulo("Tubo 100mm"), null);
  assert.equal(tamanhoDoKit("Resma c/ 5"), 5);
  assert.equal(tamanhoDoKit("Kit 3 pares de luva"), 3);
});

test("busca: outro conteúdo por embalagem corta em qualquer unidade", () => {
  const papel: Termos = { grupos: [["papel"]], proibidas: [], conteudoKg: null, conteudo: { valor: 500, unidade: "folha" } };
  assert.match(converter(25, "Papel A4 resma 100 folhas", "resma", papel).corte!, /Outro tamanho \(100 folha; pedido 500 folha\)/);
  assert.equal(converter(25, "Papel A4 resma 500 folhas", "resma", papel).corte, null);
  const tinta: Termos = { grupos: [["tinta"]], proibidas: [], conteudoKg: null, conteudo: { valor: 3.6, unidade: "l" } };
  assert.equal(converter(90, "Tinta branca 3600 mL", "lata", tinta).corte, null);
  assert.ok(converter(90, "Tinta branca 18 L", "lata", tinta).corte);
  // conteudoKg continua valendo sozinho.
  const cimento: Termos = { grupos: [["cimento"]], proibidas: [], conteudoKg: 50 };
  assert.equal(converter(38.9, "Cimento 25kg", "saco", cimento).corte, "Outro tamanho (25 kg; pedido 50 kg)");
});

test("lojas por categoria: sem loja da categoria, nenhuma (só Serper)", () => {
  assert.ok(lojasParaCategorias(["agregados"]).length > 0);
  assert.deepEqual(lojasParaCategorias(["escritorio"]), []);
  assert.deepEqual(lojasParaCategorias([]), []);
});

test("atributos obrigatórios por categoria (Q4)", () => {
  const chaves = (i: Parameters<typeof atributosFaltando>[0]) => atributosFaltando(i).map((a) => a.chave);
  assert.deepEqual(chaves({ descricao: "Extintor de incêndio" }), ["tipo", "capacidade", "norma"]);
  assert.deepEqual(chaves({ descricao: "Extintor pó ABC 6 kg", especificacao: { norma: "NBR 15808" } }), []);
  assert.deepEqual(chaves({ descricao: "Cabo flexível", unidade: "rolo" }), ["bitola", "metragem"]);
  assert.deepEqual(chaves({ descricao: "Cabo flexível 2,5 mm² rolo de 100 m" }), []);
  assert.deepEqual(chaves({ descricao: "Areia média", unidade: "carrada" }), ["unidade"]);
  assert.deepEqual(chaves({ descricao: "Areia média", unidade: "m³" }), []);
  assert.deepEqual(chaves({ descricao: "Caneta azul", unidade: "caixa" }), []);
  assert.deepEqual(chaves({ descricao: "Item sem categoria" }), []);
});

test("CNAE por categoria: papelaria não perde ponto; sem regra, não conta", () => {
  const base: EntradaJulgamento = {
    simulado: false, homologado: false, cnpj: null, cnpjInexistente: false, consultaIndisponivel: false,
    presencaVerificavel: false, compras: 0, prazosCumpridos: 0, prazosAvaliados: 0, hoje: new Date("2026-11-07"),
  } as unknown as EntradaJulgamento;
  const cnpj = { cnpj: "03840986005670", razaoSocial: "PAPELARIA EXEMPLO LTDA", nomeFantasia: null, situacao: "ATIVA", abertura: "2013-08-16", municipio: "SAO PAULO", uf: "SP", atividade: "Comércio varejista de artigos de papelaria", matrizOuFilial: "MATRIZ", fonte: "BrasilAPI" as const };
  const papelaria = julgar({ ...base, cnpj, categorias: ["Escritório e papelaria"] });
  assert.ok(papelaria.alertas.length === 0);
  assert.ok(papelaria.motivos.some((m) => m.includes("compatível com Escritório e papelaria")));
  const semRegra = julgar({ ...base, cnpj });
  assert.equal(semRegra.alertas.length, 0);
  assert.equal(semRegra.pontos, papelaria.pontos - 10);
  assert.ok(!semRegra.motivos.some((m) => /atividade/i.test(m)));
  const obra = julgar({ ...base, cnpj, categorias: ["Cimentícios"] });
  assert.ok(obra.alertas.some((a) => a.includes("fora de Cimentícios")));
  assert.equal(atividadeCompativel(["Geral"], "qualquer coisa"), null);
});

test("cadastro do fornecedor e exemplos vêm das categorias, não da base de itens", () => {
  const nomes = categoriasDoCadastro().map((c) => c.nome);
  assert.ok(nomes.includes("Escritório e papelaria") && nomes.includes("Agregados") && !nomes.includes("Geral"));
  const e = exemplosDoNicho();
  assert.ok(e.categorias.length >= 3 && e.pedidos.length > 0);
});

test("jargão por categoria e palavras vazias/sinônimos como dado", () => {
  assert.match(textoJargao(["agregados"]), /carrada/);
  assert.doesNotMatch(textoJargao(["agregados"]), /resma pacote|toner/);
  assert.match(textoJargao(["escritorio"]), /resma/);
  assert.ok(textoJargao().length <= 1800);
  assert.deepEqual(palavras("areia lavada de rio"), ["areia", "rio"]);
});
