// R14b: o prazo vence com menos de 3 propostas válidas. O Cotador pergunta ao comprador se
// encerra ou estende; ele estende; quem não respondeu recebe a pergunta do motivo; um manda
// proposta, o outro explica que não atende (vai ao comprador). Sem mais ninguém para
// consultar, o mapa sai com as duas, com o aviso de "menos de 3" e sem dizer "melhor".

import { personaDireta, proposta, recusaDesconto, texto, verdade, CONFIRMA_PEDIDO } from "./falas.ts";
import { PEDE_E_CONFIRMA } from "./comum.ts";
import { estadoDoItem, evento, mapaSai, mensagem, nuncaMensagem } from "./gabarito.ts";
import type { Cenario, Expectativa, PersonaCenario } from "./tipos.ts";

const A = personaDireta("cen-alfa", "Depósito Alfa (cenário)", verdade(32), { atrasoSeg: 1, desconto: recusaDesconto() });

/** Não responde à cotação nem ao lembrete; responde à pergunta do motivo com a proposta. */
const B: PersonaCenario = {
  chave: "cen-beta",
  nome: "Materiais Beta (cenário)",
  verdade: verdade(30),
  roteiro: [{ ao: "lembrete", texto: /impedimento/i, falas: [proposta({ atrasoSeg: 1.5 })] }, { ao: "negociacao", falas: [recusaDesconto()] }, CONFIRMA_PEDIDO],
};

/** Não responde à cotação; à pergunta do motivo, diz que não atende a região. */
const C: PersonaCenario = {
  chave: "cen-gama",
  nome: "Casa Gama (cenário)",
  verdade: verdade(31),
  roteiro: [
    {
      ao: "lembrete",
      texto: /impedimento/i,
      falas: [texto("Boa tarde, desculpe a demora. Não atendemos essa região de entrega, por isso não mandei proposta.", { classificacao: "recusa" }, 2.5)],
    },
  ],
};

const ESPERA = 15;

/** Nenhum mapa antes de o comprador escolher (R14b: a pergunta segura o item). */
const mapaSoDepoisDaEscolha: Expectativa = {
  descricao: "nenhum mapa antes de o comprador responder à pergunta do prazo",
  regra: "R14b",
  conferir: (r) => {
    const escolha = r.eventos.find((e) => e.dados?.tipo === "prazo_resposta");
    if (!escolha) return { ok: false, detalhe: "o comprador não respondeu à pergunta" };
    const cedo = r.mapas.find((m) => m.em < escolha.em);
    return cedo ? { ok: false, detalhe: `mapa ${((escolha.em - cedo.em) / 1000).toFixed(1)}s antes da escolha` } : { ok: true };
  },
};

export const prazo: Cenario = {
  chave: "prazo",
  titulo: "Prazo com menos de 3: pergunta, estende e fecha",
  descricao: "Só um responde no prazo; o comprador estende; quem não respondeu recebe a pergunta do motivo; mapa com 2 e o aviso de menos de 3.",
  ambiente: { PRAZO_RESPOSTAS_SEG: String(ESPERA) },
  fornecedores: [A, B, C],
  passos: [...PEDE_E_CONFIRMA, { clica: /^Estender/, timeoutSeg: ESPERA + 30 }, { espera: "aguardando_decisao", timeoutSeg: ESPERA * 2 + 30 }],
  gabarito: [
    evento(/Perguntou ao comprador se encerra ou estende/, { dadosTipo: "prazo_pergunta", vezes: 1, regra: "R14b", descricao: "uma pergunta do prazo ao comprador" }),
    mensagem({ com: "comprador", texto: /venceu com só 1 proposta válida \(o mínimo para comparar é 3\); 2 fornecedores não responderam/, botoes: [/^Encerrar/, /^Estender/], regra: "R14b", descricao: "pergunta ao comprador: 1 válida, 2 sem resposta, botões Encerrar e Estender" }),
    mapaSoDepoisDaEscolha,
    evento(/Estendeu o prazo de respostas/, { dadosTipo: "prazo_resposta", vezes: 1, regra: "R14b" }),
    evento(/Perguntou a 2 fornecedores por que não mandou proposta/, { dadosTipo: "prazo_motivo", fornecedor: "cen-beta", regra: "R14b", descricao: "pergunta do motivo a quem não respondeu" }),
    mensagem({ com: "cen-gama", tipo: "lembrete", texto: /Aconteceu algum impedimento/, vezes: 1, regra: "R14b", descricao: "pergunta do motivo chega a gama, uma vez" }),
    mensagem({ com: "cen-alfa", texto: /impedimento/, vezes: 0, regra: "R14b", descricao: "quem respondeu não recebe a pergunta do motivo" }),
    evento(/Repassou ao comprador o motivo/, { fornecedor: "cen-gama", dadosTipo: "prazo_motivo_resposta", regra: "R14b", descricao: "a explicação de gama vai ao comprador" }),
    mensagem({ com: "comprador", texto: /região/i, regra: "R14b", descricao: "comprador recebe o motivo de gama" }),
    mapaSai({ validas: 2, contem: ["cen-alfa", "cen-beta"] }),
    nuncaMensagem({ com: "comprador", texto: /\bmelhor\b/i, regra: "R14", descricao: "com menos de 3, nada ao comprador diz \"melhor\"" }),
    estadoDoItem("aguardando_decisao", "R14b"),
  ],
};
