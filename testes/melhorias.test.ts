// Regras vindas dos testes da Liria e da Ester (07/11/2026), sem banco e sem IA.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // o módulo exige a variável; nada conecta aqui
const { palavrasEmComum } = await import("../src/agentes/interpretador/index.ts");
const { categoriasDoTexto, completarComAnterior } = await import("../src/fluxo/fornecedor.ts");
const { nomePedido, quando } = await import("../src/texto.ts");
const { prazoRespostasMs } = await import("../src/config.ts");
const { comparar } = await import("../src/agentes/comparador/calculo.ts");

test("pergunta de quantidade da IA com outras palavras conta como a mesma", () => {
  assert.ok(palavrasEmComum("Qual é a quantidade de extintores?", "Extintor de incêndio pó químico"));
  assert.ok(!palavrasEmComum("Qual a espessura da placa?", "Cimento CP II"));
});

test("categorias do fornecedor a partir do texto livre do cadastro", () => {
  const c = categoriasDoTexto("vendemos cimento, areia e tinta");
  assert.ok(c.includes("Cimentícios"));
  assert.ok(c.includes("Agregados"));
  assert.ok(c.includes("Tintas"));
  assert.deepEqual(categoriasDoTexto("bom dia"), []);
});

const anterior = {
  itemOferecido: "Cimento CP II",
  itemExato: true,
  precoUnitario: "38.50",
  totalProduto: null,
  quantidadeOfertada: null,
  unidadeOfertada: null,
  embalagem: null,
  frete: "60.00",
  impostosValor: null,
  impostosNaoInclusos: null,
  prazoDias: 2,
  validadeDias: null,
  pagamento: "boleto 28 dias",
  prazoPagamentoDias: 28,
  entregaNoLocal: true,
} as unknown as Parameters<typeof completarComAnterior>[1];

const vazia = {
  classificacao: "outro",
  duvida: null,
  itemOferecido: null,
  itemExato: true,
  precoUnitario: null,
  quantidadeOfertada: null,
  unidadeOfertada: null,
  embalagem: null,
  totalProduto: null,
  frete: null,
  impostosValor: null,
  impostosNaoInclusos: null,
  prazoDias: null,
  validadeDias: null,
  pagamento: null,
  prazoPagamentoDias: null,
  entregaNoLocal: null,
  cnpj: null,
} as const;

test("complemento da proposta (só a validade) junta com a anterior, sem perder o preço", () => {
  const r = completarComAnterior({ ...vazia, validadeDias: 10 }, anterior)!;
  assert.equal(r.classificacao, "proposta");
  assert.equal(r.precoUnitario, 38.5);
  assert.equal(r.frete, 60);
  assert.equal(r.validadeDias, 10);
  assert.equal(r.pagamento, "boleto 28 dias");
  // Mensagem sem nada de proposta não mexe na anterior.
  assert.equal(completarComAnterior({ ...vazia }, anterior), null);
  // Preço novo substitui o antigo.
  assert.equal(completarComAnterior({ ...vazia, classificacao: "proposta", precoUnitario: 36 }, anterior)!.precoUnitario, 36);
});

test("nome legível do pedido", () => {
  assert.equal(nomePedido({ id: 11, setor: "comunicação" }, [{ descricao: "Placa de Inox 304" }]), "Pedido 11 · Placa de Inox 304 · setor comunicação");
  assert.equal(nomePedido({ id: 2 }, [{ descricao: "Cimento" }, { descricao: "Areia" }]), "Pedido 2 · Cimento (+1 item)");
});

test("prazo de respostas: demo curto; real de 3 dias, ou 5 para compra maior", () => {
  const antes = { ...process.env };
  try {
    delete process.env.PRAZO_MODO;
    process.env.PRAZO_RESPOSTAS_SEG = "300";
    assert.equal(prazoRespostasMs(99_999), 300_000);
    process.env.PRAZO_MODO = "real";
    const dia = 24 * 3600_000;
    assert.equal(prazoRespostasMs(1_000), 3 * dia);
    assert.equal(prazoRespostasMs(20_000), 5 * dia);
    assert.equal(prazoRespostasMs(null, true), 2 * dia);
  } finally {
    process.env = antes;
  }
});

test("quando: só a hora hoje, data e hora em outro dia", () => {
  const agora = new Date("2026-11-07T15:00:00-03:00");
  assert.equal(quando(new Date("2026-11-07T17:30:00-03:00"), agora), "às 17:30");
  assert.equal(quando(new Date("2026-11-10T17:30:00-03:00"), agora), "em 10/11 às 17:30");
});

test("loja online entra no mapa como proposta, com alerta de dados simulados", () => {
  const base = { simulado: false, verificado: false, homologado: false, conhecido: false, itemExato: true, totalProduto: null, impostosValor: null, impostosNaoInclusos: null, validadeDias: 1, prazoPagamentoDias: 0, entregaNoLocal: null, precoConfirmado: false };
  const c = comparar(
    { quantidade: 10, aceitaSimilar: false, prazoMaxDias: null, modoEntrega: "entrega", urgencia: "normal" },
    [
      { ...base, id: "a", fornecedorId: "fa", fornecedorNome: "Loja A", itemOferecido: "Cimento", precoUnitario: 38, frete: null, prazoDias: 4, pagamento: "PIX", online: true },
      { ...base, id: "b", fornecedorId: "fb", fornecedorNome: "Loja B", itemOferecido: "Cimento", precoUnitario: 40, frete: 30, prazoDias: 2, pagamento: "boleto", online: true },
    ],
    39,
  );
  assert.equal(c.validas.length, 2);
  assert.ok(c.validas.every((l) => l.alertas.some((a) => a.startsWith("Loja online"))));
});
