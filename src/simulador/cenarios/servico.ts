// Pedido de serviço (mão de obra). No main de hoje o fluxo responde que ainda cota só
// produtos (src/fluxo/comprador.ts, subtipo "servico"), então o cenário roda marcado como
// esperado falhar: ele mede o que falta e passa a valer quando o recurso entrar.

import { personaDireta, recusaDesconto, verdade } from "./falas.ts";
import { estadoDoItem, mensagem } from "./gabarito.ts";
import type { Cenario } from "./tipos.ts";

const TEXTO = "preciso contratar um eletricista para trocar a fiação da sala de reuniões, setor manutenção";

const E1 = personaDireta("cen-eletrica", "Elétrica Ômega Serviços (cenário)", verdade(1800, { frete: 0, prazoDias: 5 }), { desconto: recusaDesconto() });
const E2 = personaDireta("cen-instala", "Instala Já Serviços (cenário)", verdade(1650, { frete: 0, prazoDias: 7 }), { desconto: recusaDesconto() });
const E3 = personaDireta("cen-fio", "Fio Certo Serviços (cenário)", verdade(1900, { frete: 0, prazoDias: 4 }), { desconto: recusaDesconto() });

export const servico: Cenario = {
  chave: "servico",
  titulo: "Pedido de serviço (mão de obra)",
  descricao: "Comprador pede um eletricista. Esperado: o pedido vira item de serviço, vai a prestadores e o mapa sai como o de produto.",
  esperadoFalhar: "cotação de serviço ainda não existe no main: o fluxo responde \"ainda cotamos só produtos\" (src/fluxo/comprador.ts).",
  fornecedores: [E1, E2, E3],
  passos: [
    {
      diz: TEXTO,
      // O que o Interpretador de hoje devolve para serviço (instrução da classe "ambiguo", subtipo "servico").
      interpretacao: { classe: "ambiguo", subtipo: "servico", itens: [], setor: "manutenção" },
    },
    { clica: /^Confirmar/, timeoutSeg: 10 },
    { espera: "aguardando_decisao", timeoutSeg: 60 },
  ],
  gabarito: [
    mensagem({ com: "comprador", texto: /servi[çc]o|m[ãa]o de obra|produtos/i, regra: "Serviço", descricao: "o comprador recebe resposta sobre o serviço (não fica sem resposta)" }),
    mensagem({ com: "comprador", texto: /só produtos/i, vezes: 0, regra: "Serviço", descricao: "não recusa o serviço por ser serviço" }),
    mensagem({ com: "cen-eletrica", tipo: "cotacao", regra: "Serviço", descricao: "a cotação do serviço vai aos prestadores" }),
    estadoDoItem("aguardando_decisao", "Serviço"),
  ],
};
