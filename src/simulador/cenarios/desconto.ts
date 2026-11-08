// Ester (revisaodochat.md) e R13: o pedido de desconto sai em mensagem própria, depois do
// recebimento, nunca junto de outra pergunta. Com proposta incompleta, primeiro vai o pedido
// do que falta; o desconto espera o fornecedor completar e sai depois, sozinho. Depois dele,
// nada sai ao fornecedor por ESPERA_MIN_DESCONTO_SEG, a menos que ele responda.

import { completarFrete, descontoNovoPreco, descontoPercentual, personaDireta, proposta, recusaDesconto, verdade, CONFIRMA_PEDIDO } from "./falas.ts";
import { PEDE_E_CONFIRMA, QTD_CIMENTO } from "./comum.ts";
import { custoNoMapa, descontoEmMensagemPropria, estadoDoItem, evento, linhaDoMapa, mapaSai, mensagem, nuncaMensagem, ordem } from "./gabarito.ts";
import type { Cenario, PersonaCenario } from "./tipos.ts";

const ESPERA_DESCONTO = 5;

/** Esquece o frete; completa quando pedem; responde ao desconto devagar, com preço novo (5%). */
const A: PersonaCenario = {
  chave: "cen-alfa",
  nome: "Depósito Alfa (cenário)",
  verdade: verdade(32),
  roteiro: [
    { ao: "cotacao", falas: [proposta({ atrasoSeg: 1, semFrete: true })] },
    { ao: "completar_proposta", falas: [completarFrete(1.5)] },
    { ao: "negociacao", falas: [descontoNovoPreco(5, ESPERA_DESCONTO + 2)] },
    CONFIRMA_PEDIDO,
  ],
};
const B = personaDireta("cen-beta", "Materiais Beta (cenário)", verdade(31), { atrasoSeg: 2, desconto: descontoPercentual(1) });
const C = personaDireta("cen-gama", "Casa Gama (cenário)", verdade(33), { atrasoSeg: 2.5, desconto: recusaDesconto() });

export const desconto: Cenario = {
  chave: "desconto",
  titulo: "Desconto em mensagem separada (com proposta incompleta)",
  descricao: "Alfa esquece o frete: primeiro o pedido do frete, sem desconto junto; depois de completar, o desconto sai sozinho, e Alfa baixa 5% só depois da espera mínima.",
  ambiente: { ESPERA_MIN_DESCONTO_SEG: String(ESPERA_DESCONTO), PRAZO_RESPOSTAS_SEG: "40" },
  fornecedores: [A, B, C],
  passos: [...PEDE_E_CONFIRMA, { espera: "aguardando_decisao", timeoutSeg: 70 }],
  gabarito: [
    mensagem({ com: "cen-alfa", tipo: "completar_proposta", texto: /frete/i, vezes: 1, regra: "R13/desconto", descricao: "pede o frete que faltou a alfa" }),
    nuncaMensagem({ com: "cen-alfa", tipo: "completar_proposta", texto: /desconto/i, regra: "R13/desconto", descricao: "o pedido do que falta não leva desconto junto" }),
    ordem("cen-alfa", { direcao: "entrada", texto: /faltou o frete/ }, { tipo: "negociacao" }, "R13/desconto", "o desconto a alfa só sai depois de ele completar o frete"),
    descontoEmMensagemPropria("cen-alfa", ESPERA_DESCONTO),
    descontoEmMensagemPropria("cen-beta", ESPERA_DESCONTO),
    descontoEmMensagemPropria("cen-gama", ESPERA_DESCONTO),
    evento(/Pediu desconto ao fornecedor/, { fornecedor: "cen-alfa", vezes: 1, regra: "R13/desconto", descricao: "um pedido de desconto a alfa" }),
    mapaSai({ validas: 3, recomendada: "cen-alfa" }),
    // Alfa: 5% sobre R$ 32,00 = R$ 30,40 × 40 + frete R$ 60,00.
    custoNoMapa("cen-alfa", 30.4 * QTD_CIMENTO + 60, "I1"),
    linhaDoMapa("cen-alfa", /desconto/i, "I1", "negociacao"),
    custoNoMapa("cen-beta", 31 * 0.99 * QTD_CIMENTO + 60, "I1"),
    estadoDoItem("aguardando_decisao"),
  ],
};
