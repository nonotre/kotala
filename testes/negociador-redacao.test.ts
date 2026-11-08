// I2: o Negociador redige com IA, dentro de trilhos. Testes puros: a "IA" é uma função falsa.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
const r = await import("../src/agentes/negociador/redacao.ts");

const T0 = new Date("2026-11-08T13:00:00Z");
const janelaAte = new Date(T0.getTime() + 5 * 60_000);
const base = { alavancas: ["volume", "frete"] as ("volume" | "frete")[], quantidade: "50", unidade: "saco", frete: 60, referencia: null, janelaAte, agora: T0 };
const ia = (texto: string) => async () => texto;

test("nos testes a IA de verdade nunca é chamada; NEGOCIADOR_IA=desligado também desliga", () => {
  assert.equal(r.redacaoPorIaLigada(process.env), false);
  assert.equal(r.redacaoPorIaLigada({ NEGOCIADOR_IA: "desligado" }), false);
  assert.equal(r.redacaoPorIaLigada({}), true);
});

test("texto da IA aprovado: sai ele, com o rodapé do código (proposta vale e horário)", async () => {
  const m = await r.redigirPedidoDeDesconto(base, { gerar: ia("Por gentileza, consegue um desconto? São 50 sacos de uma vez, e o frete de R$ 60,00 poderia entrar no preço.") });
  assert.equal(m.origem, "ia");
  assert.ok(m.validado);
  assert.match(m.texto, /^Por gentileza, consegue um desconto\?/);
  assert.match(m.texto, /a proposta continua valendo\. Respondo ao comprador até \d{2}:\d{2}\.$/);
  assert.deepEqual(m.alavancas, ["volume", "frete"]);
  assert.equal(m.referenciaCitada, null);
});

test("a IA só recebe as alavancas, a quantidade e os valores permitidos", () => {
  const p = r.promptDesconto({ ...base, referencia: 38.9 });
  assert.match(p, /50 sacos/);
  assert.match(p, /R\$\s60,00 \(frete da própria proposta\)/);
  assert.match(p, /R\$\s38,90 \(preço publicado na internet/);
  assert.doesNotMatch(p, /melhor|concorr|outro fornecedor/i);
});

test("valor de outro fornecedor, palavra proibida ou promessa: cai no template", async () => {
  const casos: [string, RegExp][] = [
    ["Por gentileza, consegue desconto? Recebi R$ 35,00 em outra loja.", /valor não permitido/],
    ["Por gentileza, consegue desconto? Um concorrente fez melhor.", /concorrente/],
    ["Por gentileza, consegue desconto? Se baixar, vamos fechar com você.", /promete compra/],
    ["Consegue 10% de desconto nos 50 sacos?", /percentual/],
    ["Consegue desconto? Pagamos à vista, garantido.", /promete forma de pagamento|fala de pagamento/],
    ["Consegue desconto? Já compramos com vocês antes.", /compra anterior/],
    ["Consegue desconto se a entrega for em partes?", /entrega em partes/],
    ["Consegue desconto até as 15h?", /número fora dos dados/],
    ["", /texto vazio/],
  ];
  for (const [texto, motivo] of casos) {
    const m = await r.redigirPedidoDeDesconto(base, { gerar: ia(texto) });
    assert.equal(m.origem, "template", texto);
    assert.match(m.motivosIa.join("; "), motivo, texto);
    assert.match(m.texto, /^Por gentileza, conseguiria desconto na cotação\?/);
  }
});

test("IA fora do ar ou desligada: template de hoje", async () => {
  const fora = await r.redigirPedidoDeDesconto(base, { gerar: async () => { throw new Error("429 sem cota"); } });
  assert.equal(fora.origem, "template");
  assert.match(fora.motivosIa[0]!, /IA fora do ar: 429/);
  const desligada = await r.redigirPedidoDeDesconto(base, { gerar: null });
  assert.equal(desligada.origem, "template");
  assert.deepEqual(desligada.motivosIa, []);
});

test("referência pública: só conta como citada se o texto da IA a tem", async () => {
  const c = { ...base, alavancas: [] as never[], frete: null, referencia: 38.9 };
  const cita = await r.redigirPedidoDeDesconto(c, { gerar: ia("Por gentileza, consegue desconto? O preço publicado na internet está em R$ 38,90 por saco.") });
  assert.equal(cita.origem, "ia");
  assert.equal(cita.referenciaCitada, 38.9);
  const naoCita = await r.redigirPedidoDeDesconto(c, { gerar: ia("Por gentileza, conseguiria um desconto na proposta?") });
  assert.equal(naoCita.referenciaCitada, null);
});

test("sem alavanca de frete, a IA não fala de frete; sem pagamento, não fala de pix", () => {
  const regras = { permitidos: [], numeros: [50], alavancas: ["volume"] as "volume"[] };
  assert.match(r.conferirRedacao("Consegue desconto com frete grátis?", regras).motivos.join(), /frete/);
  assert.match(r.conferirRedacao("Consegue desconto no pix?", regras).motivos.join(), /pagamento/);
  assert.ok(r.conferirRedacao("Por gentileza, consegue desconto para os 50 sacos de uma vez?", regras).ok);
});

test("números no formato brasileiro", () => {
  assert.deepEqual(r.numerosDoTexto("R$ 1.234,56, 50 sacos, 38,90 e 2.000 un"), [1234.56, 50, 38.9, 2000]);
});

const rodada = { nome: "Loja Aurora", item: { id: 12, quantidade: "40", unidade: "saco", descricao: "Cimento CP II 50 kg" }, referencia: null, respostaAte: "às 14:30", ultima: false };

test("rodada do botão: texto da IA precisa citar a cotação; o horário vem do código", async () => {
  const ok = await r.redigirRodada(rodada, { gerar: ia("Olá, Loja Aurora! Sobre a cotação 12 (40 sacos de Cimento CP II 50 kg): qual o melhor preço que consegue fazer? Pagamento à vista, no recebimento.") });
  assert.equal(ok.origem, "ia");
  assert.match(ok.texto, /Respondo ao comprador até 14:30\.$/);
  const semCotacao = await r.redigirRodada(rodada, { gerar: ia("Olá! Qual o melhor preço que consegue fazer?") });
  assert.equal(semCotacao.origem, "template");
  assert.match(semCotacao.motivos.join(), /não cita 12/);
  assert.match(semCotacao.texto, /^Olá, Loja Aurora! Obrigado pela proposta/);
});

test("rodada do botão: mesma cotação e mesmo template não chamam a IA de novo", async () => {
  let chamadas = 0;
  const gerar = async () => {
    chamadas++;
    return "Olá, Loja Aurora! Cotação 12: consegue melhorar o preço? Pagamento à vista, no recebimento.";
  };
  await r.redigirRodada(rodada, { chave: "c-teste:2", gerar });
  await r.redigirRodada(rodada, { chave: "c-teste:2", gerar });
  assert.equal(chamadas, 1);
  // Mudou a referência: o template muda e redige de novo.
  await r.redigirRodada({ ...rodada, referencia: 38.9 }, { chave: "c-teste:2", gerar });
  assert.equal(chamadas, 2);
});
