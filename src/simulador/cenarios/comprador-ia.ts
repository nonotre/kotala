// 3.3: comprador guiado por IA. Na rodada com IA real (--ia), a IA escreve as mensagens do
// comprador a partir de quem ele é e do que quer (uma chamada por mensagem), e o resto do
// sistema roda de verdade. Na determinística, vale o texto de reserva com a interpretação
// declarada, e o cenário vira um caminho feliz com obra parada.

import { descontoPercentual, personaDireta, recusaDesconto, verdade } from "./falas.ts";
import { INTERPRETACAO_CIMENTO, TEXTO_CIMENTO } from "./comum.ts";
import { estadoDoItem, itemPedido, mapaSai, urgenciaDoPedido } from "./gabarito.ts";
import type { Cenario, CompradorIa } from "./tipos.ts";

export const APRESSADO: CompradorIa = {
  quem: "Mestre de obras apressado, escreve curto e com jargão; a obra está parada esperando o material.",
  objetivo: "Pedir 40 sacos de cimento CP II de 50 kg para a obra alfa, setor estrutura, dizendo que a obra está parada. Não cite marca nem preço.",
};

export const compradorIa: Cenario = {
  chave: "comprador-ia",
  titulo: "Comprador apressado guiado por IA (obra parada)",
  descricao: "A IA escreve o pedido do mestre de obras (só com --ia); o Interpretador precisa achar 40 sacos de cimento e a urgência \"parada\", e o mapa sai com 3.",
  fornecedores: [
    personaDireta("cen-alfa", "Depósito Alfa (cenário)", verdade(32, { prazoDias: 1 }), { atrasoSeg: 1, desconto: recusaDesconto() }),
    personaDireta("cen-beta", "Materiais Beta (cenário)", verdade(30, { prazoDias: 4 }), { atrasoSeg: 1.5, desconto: descontoPercentual(2) }),
    personaDireta("cen-gama", "Casa Gama (cenário)", verdade(31, { prazoDias: 2 }), { atrasoSeg: 2, desconto: recusaDesconto() }),
  ],
  passos: [
    { comprador: APRESSADO, reserva: `${TEXTO_CIMENTO}, a obra tá parada`, interpretacao: { ...INTERPRETACAO_CIMENTO, urgencia: "parada" } },
    { clica: /^Confirmar/ },
    { espera: "aguardando_decisao", timeoutSeg: 60 },
  ],
  gabarito: [
    itemPedido({ descricao: /cimento/i, quantidade: 40, unidade: /saco/i }),
    urgenciaDoPedido("parada"),
    mapaSai({ validas: 3 }),
    estadoDoItem("aguardando_decisao"),
  ],
};
