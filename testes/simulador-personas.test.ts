// Simulador geral (Frente 3): catálogo por categoria, personas de outras áreas,
// personas difíceis e a resposta ao pedido automático de desconto. Sem IA nem banco.
import assert from "node:assert/strict";
import { test } from "node:test";
import { descontoCondicional, mantemFirme, valoresEmReais, vaiResponderDepois } from "../src/agentes/negociador/index.ts";
import { categoriaSim, CATEGORIAS_SIM, itemDoCatalogo } from "../src/simulador/catalogo.ts";
import { pdfDeTexto } from "../src/simulador/pdf.ts";
import {
  PERSONAS,
  PERSONAS_AREAS,
  PERSONAS_BASE,
  PERSONAS_EXTRAS,
  TODAS_PERSONAS,
  linhasOrcamentoPdf,
  ondeEntrega,
  personaVende,
  precoUnitario,
  respostaAoDesconto,
  textoComplemento,
  textoEsclarecePreco,
  textoProposta,
  textoSegundaParte,
  type EstiloDesconto,
  type Persona,
} from "../src/simulador/personas.ts";
import { categorias } from "../src/dominio/categorias.ts";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // o simulador importa o cliente do banco; nada conecta aqui
const { ehDescontoAutomatico } = await import("../src/simulador/index.ts");

const perto = PERSONAS.find((p) => p.chave === "sim-perto")!;
const papelaria = PERSONAS_AREAS.find((p) => p.chave === "sim-papelaria")!;
const cimento = { descricao: "Cimento CP II 50 kg", quantidade: 40, unidade: "saco", destino: "Obra Alfa" };
const resma = { descricao: "Papel A4 75 g", quantidade: 50, unidade: "resma", destino: null };
const menos5 = Math.round(39.9 * 0.95 * 100) / 100;
const persona = (estilo: EstiloDesconto, extra: Partial<Persona> = {}): Persona => ({ ...perto, chave: `t-${estilo}`, desconto: estilo, descontoPct: 5, ...extra });

test("catálogo: toda categoria do simulador existe em src/dominio/categorias.json, e vice-versa", () => {
  const doDominio = new Set(categorias().map((c) => c.id));
  for (const id of Object.keys(CATEGORIAS_SIM)) assert.ok(doDominio.has(id), id);
  for (const id of doDominio) assert.ok(CATEGORIAS_SIM[id], `falta ${id} em catalogo.json`);
});

test("catálogo: construção igual a antes (preço, carrada e milheiro)", () => {
  assert.equal(precoUnitario(perto, "Cimento Portland CP II", "saco"), 39.9);
  assert.equal(precoUnitario(perto, "Areia média", "carrada"), 135 * 6);
  assert.equal(precoUnitario(perto, "Areia média", "m³"), 135);
  assert.equal(precoUnitario(perto, "Bloco de concreto 14x19x39", "milheiro"), 3900);
  assert.equal(precoUnitario(perto, "Tijolo 8 furos", "milheiro"), 980);
  assert.match(textoProposta(perto, cimento, 1)!, /aí na obra/);
});

test("catálogo: palavra no começo da palavra (\"ari\" de CP V-ARI não pega \"sanitária\")", () => {
  assert.equal(itemDoCatalogo("Cimento CP V-ARI")?.categoria, "cimenticios");
  assert.equal(itemDoCatalogo("Água sanitária 5 L")?.categoria, "limpeza");
  assert.equal(categoriaSim("Clips de papel nº 2"), "escritorio");
  assert.equal(categoriaSim("Lápis preto nº 2"), "escritorio"); // sem preço na lista: categoria pelo domínio
  assert.equal(categoriaSim("Coisa sem categoria nenhuma"), "geral");
});

test("personas de obra não vendem fora da obra; as de área vendem só as suas áreas", () => {
  for (const p of PERSONAS) assert.ok(!personaVende(p, "Papel A4 75 g", null), p.chave);
  for (const p of PERSONAS_AREAS) assert.ok(!personaVende(p, "Cimento CP II", null), p.chave);
  assert.ok(personaVende(papelaria, "Clips de papel", null));
  assert.ok(personaVende(papelaria, "Notebook i5 16 GB", null));
  assert.ok(!personaVende(papelaria, "Luva de vaqueta", null));
  assert.ok(personaVende(PERSONAS_AREAS.find((p) => p.chave === "sim-epi")!, "Extintor ABC 6 kg", null));
  // Cada área pedida tem pelo menos 2 fornecedores simulados (para o mapa ter com o que comparar).
  for (const area of ["escritorio", "epi", "limpeza", "informatica", "copa"]) {
    const n = TODAS_PERSONAS.filter((p) => p.areas?.includes(area)).length;
    assert.ok(n >= 2, `${area}: ${n}`);
  }
});

test("persona de área: item da categoria sem preço na lista recebe o preço sintético, não recusa", () => {
  assert.equal(precoUnitario(papelaria, "Lápis preto nº 2", "caixa"), CATEGORIAS_SIM.escritorio!.precoSintetico.preco);
  assert.equal(precoUnitario(papelaria, "Papel A4 75 g", "resma"), 27.9);
  const t = textoProposta(papelaria, resma, 1)!;
  assert.match(t, /no escritório/);
  assert.doesNotMatch(t, /obra/);
});

test("\"até a obra\" virou dado da categoria", () => {
  const semFrete = { ...perto, frete: null };
  assert.match(textoComplemento(semFrete, cimento), /até a obra/);
  assert.match(textoComplemento(semFrete, resma), /até o escritório/);
  assert.match(textoComplemento(semFrete, { ...resma, descricao: "Detergente neutro" }), /até o endereço/);
  assert.equal(ondeEntrega("Café torrado 500 g"), "no endereço informado");
});

test("ninguém dá desconto sem pedirem: a primeira proposta é o preço cheio", () => {
  for (const p of [...PERSONAS, ...PERSONAS_AREAS, ...PERSONAS_EXTRAS]) {
    const item = p.areas && !p.areas.includes("cimenticios") ? { ...resma, descricao: "Papel A4 75 g" } : cimento;
    const t = textoProposta(p, item, 1);
    if (!t) continue;
    assert.doesNotMatch(t, /desconto/i, p.chave);
  }
});

test("pedido automático é o da mesma rodada; a rodada nova do botão não é", () => {
  assert.ok(ehDescontoAutomatico({ rodada: 1 }, 1));
  assert.ok(!ehDescontoAutomatico({ rodada: 1 }, 2));
  assert.ok(ehDescontoAutomatico({ rodada: 2 }, 2));
  assert.ok(ehDescontoAutomatico(undefined, 1)); // simulador reiniciado no meio da rodada 1
  assert.ok(!ehDescontoAutomatico(undefined, 2));
});

test("desconto: novo preço baixa o unitário (o bug era reenviar o mesmo preço)", () => {
  const [f] = respostaAoDesconto(persona("novo_preco"), cimento, 39.9);
  assert.ok(f);
  const valores = valoresEmReais(f.texto);
  assert.ok(valores.includes(menos5), f.texto); // 39,90 − 5%
  assert.ok(!valores.includes(39.9), f.texto);
});

test("desconto: percentual, condicionado no Pix, recusa, ignora e vou ver são lidos como o negociador espera", () => {
  const [pct] = respostaAoDesconto(persona("percentual"), cimento, 39.9);
  assert.match(pct!.texto, /5%/);
  assert.equal(descontoCondicional(pct!.texto), null);
  assert.ok(!mantemFirme(pct!.texto) && !vaiResponderDepois(pct!.texto));

  const [pix] = respostaAoDesconto(persona("condicionado"), cimento, 39.9);
  assert.ok(descontoCondicional(pix!.texto), pix!.texto);

  const [firme] = respostaAoDesconto(persona("recusa"), cimento, 39.9);
  assert.ok(mantemFirme(firme!.texto), firme!.texto);

  assert.deepEqual(respostaAoDesconto(persona("ignora"), cimento, 39.9), []);

  const [espera, depois] = respostaAoDesconto(persona("vou_ver"), cimento, 39.9);
  assert.ok(vaiResponderDepois(espera!.texto));
  assert.ok(depois!.atraso > espera!.atraso);
  assert.ok(valoresEmReais(depois!.texto).includes(menos5));
});

test("desconto \"se fechar hoje\" é condicionado", () => {
  const [hoje] = respostaAoDesconto(persona("fechar_hoje"), cimento, 39.9);
  assert.ok(descontoCondicional(hoje!.texto), hoje!.texto);
});

test("todo estilo de desconto aparece em alguma persona", () => {
  const estilos = new Set(TODAS_PERSONAS.map((p) => p.desconto));
  for (const e of ["novo_preco", "percentual", "condicionado", "fechar_hoje", "vou_ver", "recusa", "ignora"] as const) assert.ok(estilos.has(e), e);
  assert.ok(new Set(PERSONAS_BASE.map((p) => p.desconto)).size >= 5);
});

const extra = (c: string) => PERSONAS_EXTRAS.find((p) => p.comportamento === c)!;
const cinco = { descricao: "Extintor ABC 6 kg", quantidade: 5, unidade: "unidade", destino: null };

test("persona do unitário ambíguo: um número só, sem \"cada\", e esclarece quando perguntam", () => {
  const p = extra("ambiguo");
  const unit = precoUnitario(p, cinco.descricao, cinco.unidade)!;
  const t = textoProposta(p, cinco, 1)!;
  assert.deepEqual(valoresEmReais(t).filter((v) => v > 100), [Math.round(unit * 5 * 100) / 100]);
  assert.doesNotMatch(t, /\bcada\b|unit|total/i);
  const r = textoEsclarecePreco(cinco, unit);
  assert.match(r, /total/);
  assert.match(r, /cada/);
});

test("persona das duas mensagens: preço primeiro, condições depois", () => {
  const p = extra("duas_mensagens");
  const t1 = textoProposta(p, cimento, 1)!;
  assert.match(t1, /R\$/);
  assert.doesNotMatch(t1, /frete|prazo|pagamento|validade/i);
  const t2 = textoSegundaParte(p, cimento);
  assert.match(t2, /frete/i);
  assert.match(t2, /pagamento/);
  assert.match(t2, /válida por \d+ dias/);
  assert.doesNotMatch(t2, /R\$ \d+,\d{2} cada/);
});

test("persona só Pix diz que não aceita boleto; persona do PDF manda o orçamento como anexo", () => {
  assert.match(textoProposta(extra("so_pix"), cimento, 1)!, /só no Pix.*não trabalhamos com boleto/);
  const p = extra("pdf");
  assert.equal(textoProposta(p, cimento, 1), "Bom dia, segue o orçamento em anexo.");
  const linhas = linhasOrcamentoPdf(p, cimento, 39.5);
  assert.ok(linhas.some((l) => /Valor unitário: R\$ 39,50/.test(l)));
  const pdf = Buffer.from(pdfDeTexto(linhas)).toString("latin1");
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /%%EOF\n$/);
  assert.match(pdf, /\(Valor unit\xe1rio: R\$ 39,50\) Tj/);
  // A tabela xref aponta para os objetos certos.
  const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
  assert.equal(pdf.slice(xref, xref + 4), "xref");
  const pos3 = Number(pdf.slice(xref).split("\n")[6]!.slice(0, 10));
  assert.equal(pdf.slice(pos3, pos3 + 7), "4 0 obj");
});

test("as personas difíceis não entram na demo de construção sem pedir", async () => {
  const chaves = new Set(PERSONAS_EXTRAS.map((p) => p.chave));
  assert.equal(chaves.size, 4);
  for (const p of PERSONAS_EXTRAS) assert.ok(!PERSONAS.includes(p) && !PERSONAS_BASE.includes(p));
  // A ordem da busca começa igual: construção, depois a base.
  assert.deepEqual(TODAS_PERSONAS.slice(0, PERSONAS.length).map((p) => p.chave), PERSONAS.map((p) => p.chave));
});
