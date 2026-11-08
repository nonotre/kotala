// R3b (alteração de valor): o fornecedor manda proposta nova mais cara que a anterior antes
// do mapa. Vale a mais recente, o comprador é avisado na hora (só vale se ele aprovar) e o
// mapa marca "Subiu" na linha do fornecedor.

import { descontoPercentual, personaDireta, recusaDesconto, sobePreco, verdade } from "./falas.ts";
import { PEDE_E_CONFIRMA, QTD_CIMENTO } from "./comum.ts";
import { custoNoMapa, estadoDoItem, evento, linhaDoMapa, mapaSai, mensagem } from "./gabarito.ts";
import type { Cenario } from "./tipos.ts";

/** Ao pedido de desconto, responde com o preço 10% mais alto ("o fabricante reajustou"). */
const A = personaDireta("cen-alfa", "Depósito Alfa (cenário)", verdade(30), { atrasoSeg: 1, desconto: sobePreco(10) });
const B = personaDireta("cen-beta", "Materiais Beta (cenário)", verdade(31), { atrasoSeg: 2, desconto: descontoPercentual(2) });
const C = personaDireta("cen-gama", "Casa Gama (cenário)", verdade(32), { atrasoSeg: 2.5, desconto: recusaDesconto() });

export const sobe: Cenario = {
  chave: "sobe-preco",
  titulo: "Preço que sobe gera aviso e \"Subiu\" no mapa",
  descricao: "Alfa responde ao pedido de desconto com o unitário 10% mais caro: aviso ao comprador, registro de alteração de valor e \"Subiu\" na linha do mapa.",
  fornecedores: [A, B, C],
  passos: [...PEDE_E_CONFIRMA, { espera: "aguardando_decisao", timeoutSeg: 60 }],
  gabarito: [
    evento(/aumentou a proposta/, { fornecedor: "cen-alfa", dadosTipo: "alteracao_valor", vezes: 1, regra: "R3b" }),
    mensagem({ com: "comprador", tipo: "aviso", texto: /mudou a proposta .*produto de R\$\s1\.200,00 para R\$\s1\.320,00.*só vale se você aprovar/, vezes: 1, regra: "R3b", descricao: "aviso ao comprador com o antes e o depois e \"só vale se você aprovar\"" }),
    mapaSai({ validas: 3 }),
    linhaDoMapa("cen-alfa", /^Subiu/, "R3b"),
    // Vale a proposta mais recente: R$ 33,00 × 40 + frete.
    custoNoMapa("cen-alfa", 33 * QTD_CIMENTO + 60, "R3b"),
    estadoDoItem("aguardando_decisao"),
  ],
};
