// Casos de regressão dos erros de docs/plano-ia.md que dependem da leitura da IA.
// A parte sem IA está em testes/regressao-plano.test.ts. Rodam no `npm run regressao:avaliar`.

import type { Interpretacao } from "../../agentes/interpretador/index.ts";
import type { Extracao, ItemSolicitado } from "../../agentes/extrator/index.ts";

export type CasoInterpretador = { id: string; plano: string; texto: string; checar: (i: Interpretacao) => string | null };
export type CasoExtrator = { id: string; plano: string; item: ItemSolicitado; texto: string; checar: (e: Extracao) => string | null };

const temItem = (i: Interpretacao, r: RegExp) => i.itens.some((it) => r.test(it.descricao));

export const CASOS_INTERPRETADOR: CasoInterpretador[] = [
  {
    id: "clips-nome",
    plano: "Q3",
    texto: "clips de papel",
    checar: (i) => (i.ehPedido ? "abriu pedido só com o nome do produto" : !temItem(i, /clip/i) ? "não leu o item para o \"Quer que eu cote?\"" : null),
  },
  {
    id: "clips-pedido",
    plano: "Q3",
    texto: "quero 10000 clipes de papel",
    checar: (i) => (!i.ehPedido ? `não é pedido (${i.classe})` : i.itens[0]?.quantidade !== 10000 ? `quantidade ${i.itens[0]?.quantidade}` : null),
  },
  {
    id: "extintor-sem-kg",
    plano: "Q4",
    texto: "2 extintores ABC pro galpão",
    checar: (i) => (!temItem(i, /extintor/i) ? "não leu o extintor" : i.itens.some((it) => /\d\s?kg/i.test(`${it.descricao} ${JSON.stringify(it.especificacao)}`)) ? "inventou a capacidade" : null),
  },
  {
    id: "foto-com-marca",
    plano: "Q5",
    texto: "20 sacos de argamassa\n[Foto] Argamassa AC-II cinza 20 kg (marca Quartzolit)",
    checar: (i) => (!temItem(i, /argamassa/i) ? "não leu a argamassa" : i.itens.some((it) => it.marcaExigida) ? "tratou a marca da foto como exigida sem perguntar" : null),
  },
  {
    id: "escritorio-nicho-trocado",
    plano: "G",
    texto: "50 resmas de papel A4 75g e 10 caixas de caneta azul pro escritório até sexta",
    checar: (i) => (!i.ehPedido ? `não é pedido (${i.classe})` : i.itens.length !== 2 ? `${i.itens.length} itens` : null),
  },
];

const cimento: ItemSolicitado = { descricao: "Cimento Portland CP II 50 kg", quantidade: 40, unidade: "saco", aceitaSimilar: true, destino: "Rua de Exemplo, 100", modoEntrega: "entrega" };
const cinco: ItemSolicitado = { descricao: "Extintor de incêndio pó ABC 4 kg", quantidade: 5, unidade: "unidade", aceitaSimilar: true, destino: "Rua de Exemplo, 100", modoEntrega: "entrega" };
const parafuso: ItemSolicitado = { descricao: "Parafuso sextavado 1/4 x 2", quantidade: 10, unidade: "unidade", aceitaSimilar: true, destino: "Rua de Exemplo, 100", modoEntrega: "entrega" };

export const CASOS_EXTRATOR: CasoExtrator[] = [
  {
    id: "300-cada",
    plano: "Q1",
    item: { ...cinco, descricao: "Extintor de incêndio pó ABC 6 kg" },
    texto: "Extintor ABC 6 kg R$ 300 cada, frete grátis, entrego em 2 dias, boleto 28, validade 7 dias.",
    checar: (e) => (e.precoUnitario !== 300 ? `unitário ${e.precoUnitario}` : e.aConfirmar?.includes("preco") ? "pediu confirmação de preço sem precisar" : null),
  },
  {
    id: "300-ambiguo",
    plano: "Q1",
    item: { ...cinco, descricao: "Extintor de incêndio pó ABC 6 kg" },
    texto: "Extintor ABC 6 kg: R$ 300. Frete grátis, entrego em 2 dias.",
    checar: (e) => (!e.aConfirmar?.includes("preco") ? `leu como ${e.leituraPreco} sem perguntar` : null),
  },
  {
    id: "kg-sem-unidade",
    plano: "Q2",
    item: parafuso,
    texto: "Parafuso sext. 1/4x2 zincado: R$ 38,00 o kg (dá umas 60 peças por kg). Frete R$ 20, 1 dia, boleto 28, validade 7 dias.",
    checar: (e) => (e.aderencia === "diferente" ? "cortou a proposta em kg como item diferente" : null),
  },
  {
    id: "marca-nao-exigida",
    plano: "Q2",
    item: cimento,
    texto: "Cimento Votoran CP II-E 32 50kg R$ 39,90 o saco, frete R$ 60, 2 dias, boleto 28, validade 7 dias.",
    checar: (e) => (e.aderencia === "diferente" || !e.itemExato ? `aderência ${e.aderencia}` : null),
  },
  {
    id: "capacidade-diferente",
    plano: "Q2",
    item: cinco,
    texto: "Extintor ABC 6 kg R$ 210 cada, frete grátis, 2 dias, boleto 28, validade 7 dias.",
    checar: (e) => (e.aderencia !== "diferente" ? `6 kg para pedido de 4 kg ficou ${e.aderencia}` : null),
  },
  {
    id: "so-pix",
    plano: "U1",
    item: cimento,
    texto: "R$ 37,50 o saco, frete R$ 40, 1 dia. Pagamento só no Pix à vista, não trabalhamos com boleto. Validade 3 dias.",
    checar: (e) => (!/pix/i.test(e.pagamento ?? "") ? `pagamento "${e.pagamento}"` : e.prazoPagamentoDias !== 0 ? `prazo de pagamento ${e.prazoPagamentoDias}` : null),
  },
];

/** Rubrica do juiz de clareza (U4), a da Ester: organizada, clara, coesa. */
export const RUBRICA_CLAREZA =
  "Você avalia mensagens que um assistente de compras manda a fornecedores. Dê nota de 1 a 5 em cada critério: " +
  "organizada (blocos e ordem fáceis de seguir), clara (o fornecedor sabe exatamente o que responder), coesa (sem repetição nem frase solta). " +
  "Seja exigente: 5 só para mensagem que um comprador experiente mandaria sem mexer. Diga em uma frase o que melhorar.";
