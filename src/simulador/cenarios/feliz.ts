// Caminho feliz: três fornecedores respondem completos, cada um responde ao pedido
// automático de desconto de um jeito, o mapa sai com as três e a compra fecha.

import { descontoNovoPreco, descontoPercentual, personaDireta, recusaDesconto, verdade } from "./falas.ts";
import { APROVA_E_COMPRA, PEDE_E_CONFIRMA, QTD_CIMENTO } from "./comum.ts";
import { custoNoMapa, descontoEmMensagemPropria, estadoDoItem, evento, linhaDoMapa, mapaSai, mensagem } from "./gabarito.ts";
import type { Cenario } from "./tipos.ts";

const A = personaDireta("cen-alfa", "Depósito Alfa (cenário)", verdade(32), { atrasoSeg: 1, desconto: recusaDesconto() });
const B = personaDireta("cen-beta", "Materiais Beta (cenário)", verdade(30), { atrasoSeg: 2, desconto: descontoPercentual(3) });
const C = personaDireta("cen-gama", "Casa Gama (cenário)", verdade(31), { atrasoSeg: 3, desconto: descontoNovoPreco(2) });

export const feliz: Cenario = {
  chave: "feliz",
  titulo: "Caminho feliz com 3 propostas",
  descricao: "Três propostas completas; desconto pedido a cada um em mensagem própria; mapa com as três; aprova a mais barata e o fornecedor confirma.",
  fornecedores: [A, B, C],
  passos: [...PEDE_E_CONFIRMA, ...APROVA_E_COMPRA],
  gabarito: [
    mensagem({ com: "cen-alfa", tipo: "cotacao", regra: "Cotador", descricao: "cotação enviada aos três (alfa)" }),
    mensagem({ com: "cen-gama", tipo: "cotacao", regra: "Cotador", descricao: "cotação enviada aos três (gama)" }),
    evento(/Pediu desconto ao fornecedor/, { vezes: 3, regra: "R13/desconto", descricao: "pediu desconto uma vez a cada fornecedor" }),
    descontoEmMensagemPropria("cen-alfa", 3),
    descontoEmMensagemPropria("cen-beta", 3),
    descontoEmMensagemPropria("cen-gama", 3),
    mapaSai({ validas: 3, cortadas: 0, recomendada: "cen-beta" }),
    // Beta: 3% sobre 40 × R$ 30,00 = R$ 1.164,00 + frete R$ 60,00.
    custoNoMapa("cen-beta", 30 * 0.97 * QTD_CIMENTO + 60, "I1"),
    linhaDoMapa("cen-beta", /desconto/i, "I1", "negociacao"),
    // Gama: 2% no unitário (R$ 30,38) × 40 + frete.
    custoNoMapa("cen-gama", 30.38 * QTD_CIMENTO + 60, "I1"),
    linhaDoMapa("cen-alfa", /manteve/i, "I1", "negociacao"),
    mensagem({ com: "comprador", botoes: [/^Aprovar/, /^Escolher outra/], regra: "Decisão", descricao: "mapa ao comprador com Aprovar e Escolher outra" }),
    mensagem({ com: "cen-beta", tipo: "pedido_compra", regra: "Decisão", descricao: "pedido de compra só ao vencedor" }),
    mensagem({ com: "cen-alfa", tipo: "pedido_compra", vezes: 0, regra: "Decisão", descricao: "perdedor não recebe pedido de compra" }),
    estadoDoItem("confirmado"),
  ],
};
