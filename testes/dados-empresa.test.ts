// R11 (regra de 08/11): dados da empresa ao fornecedor, por template. Testes puros, sem banco e sem IA.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // nada conecta aqui
const { lerPedidoDeDados, respostaPedidoDeDados, textoDadosEmpresa, TEXTO_DADO_PROIBIDO } = await import("../src/agentes/cotador/dados-empresa.ts");
const { EMPRESA } = await import("../src/config.ts");

const pedido = { destino: "Rua A, 10", cep: "01310-100", modoEntrega: "entrega" as const, janelaRecebimento: "seg a sex, 7h às 16h" };

test("template com os cinco dados e nada além", () => {
  const t = textoDadosEmpresa(12, pedido);
  assert.match(t, /^Dados da empresa para a cotação 12:/);
  assert.match(t, new RegExp(`Razão social: ${EMPRESA.nome.replace(/\./g, "\\.")}`));
  assert.match(t, new RegExp(`CNPJ: ${EMPRESA.cnpj.replace(/[./]/g, "\\$&")}`));
  assert.match(t, /Endereço de entrega: Rua A, 10, CEP 01310-100/);
  assert.match(t, /Janela de recebimento: seg a sex, 7h às 16h/);
  assert.match(t, new RegExp(`Quem recebe: ${EMPRESA.recebedor}`));
  assert.doesNotMatch(t, /banc|ag[eê]ncia|pix|telefone|e-?mail|R\$|or[cç]amento/i);
});

test("sem destino nem janela no pedido, valem os padrões da empresa; retirada não tem endereço", () => {
  const t = textoDadosEmpresa(3, { destino: null, cep: null, modoEntrega: null, janelaRecebimento: null });
  assert.match(t, new RegExp(`Endereço de entrega: ${EMPRESA.enderecoEntrega}, CEP ${EMPRESA.cep}`));
  assert.match(t, new RegExp(`Janela de recebimento: ${EMPRESA.janelaRecebimento}`));
  const r = textoDadosEmpresa(3, { ...pedido, modoEntrega: "retirada" });
  assert.match(r, /Entrega: retirada na loja/);
  assert.doesNotMatch(r, /Rua A/);
});

test("lê em código o que o fornecedor pede", () => {
  const casos: [string, boolean, { empresa: boolean; proibido: boolean }][] = [
    ["Qual o CNPJ para faturar?", false, { empresa: true, proibido: false }],
    ["me passa a razão social e o endereço de entrega", false, { empresa: true, proibido: false }],
    ["Quem vai receber a mercadoria e em que horário de recebimento?", false, { empresa: true, proibido: false }],
    ["Qual o orçamento de vocês para esse item?", false, { empresa: false, proibido: true }],
    ["Quanto os outros cotaram?", false, { empresa: false, proibido: true }],
    ["Me passa o telefone do comprador e os dados da empresa", false, { empresa: true, proibido: true }],
    ["Preciso dos dados bancários", false, { empresa: false, proibido: true }],
    ["Qual o celular de quem recebe?", false, { empresa: true, proibido: true }],
    // Telefone na assinatura da proposta não é pedido de contato.
    ["Cimento a R$ 38 o saco. Telefone: (11) 4000-0000. Posso ajudar em algo mais?", false, { empresa: false, proibido: false }],
    // Proposta que só cita o endereço, sem pedir nada: não é pedido de dados.
    ["Cimento a R$ 38 o saco, entrega no endereço informado em 2 dias.", false, { empresa: false, proibido: false }],
    // Lida como dúvida pelo Extrator: não precisa da pista de pergunta.
    ["dados para emissão da nota", true, { empresa: true, proibido: false }],
    ["A bitola é 5/16?", true, { empresa: false, proibido: false }],
  ];
  for (const [texto, duvida, esperado] of casos) assert.deepEqual(lerPedidoDeDados(texto, { duvida }), esperado, texto);
});

test("resposta: dados permitidos, recusa do que não passa, ou null para seguir o caminho de sempre", () => {
  const d = { item: { id: 9 }, pedido };
  assert.equal(respostaPedidoDeDados(d, "A bitola é 5/16?", { duvida: true }), null);
  const so = respostaPedidoDeDados(d, "Qual o orçamento máximo?", { duvida: true })!;
  assert.equal(so, TEXTO_DADO_PROIBIDO);
  const ambos = respostaPedidoDeDados(d, "qual o CNPJ e o whatsapp do comprador?", { duvida: true })!;
  assert.match(ambos, /^Dados da empresa para a cotação 9:/);
  assert.match(ambos, /Não passo dados bancários, contatos pessoais, orçamento nem valores de outros fornecedores/);
});
