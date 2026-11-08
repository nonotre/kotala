// Liria (erros_chat.md): PARAR com cotação aberta sai só desta cotação. O contato continua
// ativo para as próximas, nada mais desta cotação vai a ele, e o mapa sai com os outros três.

import { parar as falaParar, personaDireta, recusaDesconto, descontoPercentual, verdade } from "./falas.ts";
import { PEDE_E_CONFIRMA } from "./comum.ts";
import { contatoAtivo, estadoDoItem, evento, mapaSai, mensagem, situacaoDaCotacao } from "./gabarito.ts";
import type { Cenario, Expectativa, PersonaCenario } from "./tipos.ts";

const A = personaDireta("cen-alfa", "Depósito Alfa (cenário)", verdade(32), { atrasoSeg: 1.5, desconto: recusaDesconto() });
const B = personaDireta("cen-beta", "Materiais Beta (cenário)", verdade(30), { atrasoSeg: 2, desconto: descontoPercentual(2) });
const C = personaDireta("cen-gama", "Casa Gama (cenário)", verdade(31), { atrasoSeg: 2.5, desconto: recusaDesconto() });
const D: PersonaCenario = { chave: "cen-delta", nome: "Atacado Delta (cenário)", verdade: verdade(29), roteiro: [{ ao: "cotacao", falas: [falaParar(1)] }] };

/** Depois da resposta ao PARAR, nada mais vai a delta. */
const nadaDepoisDoParar: Expectativa = {
  descricao: "depois do PARAR, nenhuma mensagem desta cotação a delta (nem lembrete nem resultado)",
  regra: "PARAR",
  conferir: (r) => {
    const conversa = r.mensagens.filter((m) => m.com === "cen-delta");
    const i = conversa.findIndex((m) => m.direcao === "entrada" && m.texto === "PARAR");
    if (i < 0) return { ok: false, detalhe: "delta não disse PARAR" };
    const saidas = conversa.slice(i + 1).filter((m) => m.direcao === "saida");
    const extra = saidas.slice(1); // a primeira é a confirmação de saída
    return extra.length ? { ok: false, detalhe: extra.map((m) => `[${m.tipo ?? "-"}] ${m.texto.slice(0, 60)}`).join(" | ") } : { ok: true };
  },
};

export const pararCotacao: Cenario = {
  chave: "parar",
  titulo: "Fornecedor diz PARAR com a cotação aberta",
  descricao: "Delta responde PARAR à cotação: sai só dela (cotação desistiu, contato ativo); o mapa sai com os outros três.",
  fornecedores: [A, B, C, D],
  passos: [...PEDE_E_CONFIRMA, { espera: "aguardando_decisao", timeoutSeg: 60 }],
  gabarito: [
    evento(/Saiu desta cotação \(PARAR\)/, { fornecedor: "cen-delta", vezes: 1, regra: "PARAR" }),
    evento(/Pediu para parar de receber mensagens/, { vezes: 0, regra: "PARAR", descricao: "não marca o contato como parado de vez" }),
    situacaoDaCotacao("cen-delta", "desistiu", "PARAR"),
    contatoAtivo("cen-delta", true, "PARAR"),
    mensagem({ com: "cen-delta", texto: /você saiu desta cotação.*ENCERRAR CONTATO/, vezes: 1, regra: "PARAR", descricao: "delta recebe a confirmação de saída, com como sair de vez" }),
    nadaDepoisDoParar,
    mapaSai({ validas: 3, semFornecedor: ["cen-delta"] }),
    estadoDoItem("aguardando_decisao"),
  ],
};
