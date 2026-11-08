// Revisão 80 (Ester, 08/11/2026): os erros que ela achou testando, virados em regressão.
// - desconto-total: "10% no valor total da proposta" lido como condicionado e não aplicado;
// - pos-pedido: resposta ao pedido de compra ("o desconto vale") caía em "cotação encerrada"
//   e a compra fechava sem o desconto; o comprador que escrevia "confirmar" ouvia "em cotação";
// - especificacao: "classe A e branco" anotado no banco, mas fora do resumo; a pergunta
//   "vc anotou a cor?" recebia o mesmo resumo, sem resposta.

import { personaDireta, proposta, recusaDesconto, texto, tocarPrimeiroBotao, verdade, CONFIRMA_PEDIDO } from "./falas.ts";
import { PEDE_E_CONFIRMA, QTD_CIMENTO } from "./comum.ts";
import { custoNoMapa, estadoDoItem, evento, linhaDoMapa, mapaSai, mensagem, nuncaMensagem, semAlertaNoMapa } from "./gabarito.ts";
import type { Cenario, PersonaCenario } from "./tipos.ts";

// ---------- "10% no valor total da proposta" é desconto firme, sobre produto e frete ----------

/** A IA real leu "no valor total da proposta" como condição: a leitura simulada repete o erro, e o código tem de corrigir. */
const total: PersonaCenario = {
  chave: "cen-total",
  nome: "Casa do Total (cenário)",
  verdade: verdade(30, { frete: 20 }),
  roteiro: [
    { ao: "cotacao", falas: [proposta({ atrasoSeg: 1 })] },
    { ao: "negociacao", falas: [texto("Dou 10% de desconto no valor total da proposta", { classificacao: "outro", descontoPercentual: 10, descontoCondicao: "no valor total da proposta" }, 1)] },
    CONFIRMA_PEDIDO,
  ],
};

export const descontoTotal: Cenario = {
  chave: "desconto-total",
  titulo: "\"10% no valor total da proposta\" entra no total",
  descricao: "O fornecedor dá 10% no valor total da proposta. Não é desconto condicionado: entra no custo (produto e frete) e o mapa mostra bruto, percentual e valor com desconto.",
  fornecedores: [
    total,
    personaDireta("cen-beta", "Materiais Beta (cenário)", verdade(31), { atrasoSeg: 1.5, desconto: recusaDesconto() }),
    personaDireta("cen-gama", "Casa Gama (cenário)", verdade(32), { atrasoSeg: 2, desconto: recusaDesconto() }),
  ],
  passos: [...PEDE_E_CONFIRMA, { espera: "aguardando_decisao", timeoutSeg: 60 }],
  gabarito: [
    mapaSai({ validas: 3, recomendada: "cen-total" }),
    // 10% sobre (40 × R$ 30,00 + R$ 20,00) = R$ 1.098,00.
    custoNoMapa("cen-total", (30 * QTD_CIMENTO + 20) * 0.9, "Revisão 80/4"),
    linhaDoMapa("cen-total", /\(10%\) · valor bruto R\$\s1\.220,00 · com desconto R\$\s1\.098,00/, "Revisão 80/5", "negociacao"),
    semAlertaNoMapa(/condicionado/i, "Revisão 80/4", "cen-total"),
    evento(/Desconto obtido/, { fornecedor: "cen-total", vezes: 1, regra: "Revisão 80/4" }),
  ],
};

// ---------- Resposta ao pedido de compra: o desconto pendente passa a valer ----------

/** Oferece 10% "se fechar hoje" (condicionado: fica fora do total). No pedido de compra, diz que vale; no pedido atualizado, confirma. */
const fechaHoje: PersonaCenario = {
  chave: "cen-hoje",
  nome: "Depósito Hoje (cenário)",
  verdade: verdade(29),
  roteiro: [
    { ao: "cotacao", falas: [proposta({ atrasoSeg: 1 })] },
    { ao: "negociacao", falas: [texto("Faço 10% de desconto se fechar hoje.", { classificacao: "outro", descontoPercentual: 10, descontoCondicao: "se fechar hoje" }, 1)] },
    { ao: "pedido_compra", falas: [texto("Fechando hoje, o desconto vale sim.", undefined, 1)] },
    { ao: "pedido_compra", falas: [tocarPrimeiroBotao(1)] },
  ],
};

const DESCONTO_HOJE = 29 * QTD_CIMENTO * 0.9 + 60;

export const posPedido: Cenario = {
  chave: "pos-pedido",
  titulo: "Resposta ao pedido de compra muda o total, com o aceite do comprador",
  descricao:
    "O vencedor tinha um desconto condicionado (fora do total). No pedido de compra ele diz que o desconto vale: o comprador recebe antes e depois com Aceitar, aceita, o pedido de compra atualizado sai e o fornecedor confirma pelo total novo. \"confirmar\" do comprador nessa hora recebe o estado certo.",
  fornecedores: [
    fechaHoje,
    personaDireta("cen-beta", "Materiais Beta (cenário)", verdade(31), { atrasoSeg: 1.5, desconto: recusaDesconto() }),
    personaDireta("cen-gama", "Casa Gama (cenário)", verdade(32), { atrasoSeg: 2, desconto: recusaDesconto() }),
  ],
  passos: [
    ...PEDE_E_CONFIRMA,
    { espera: "aguardando_decisao", timeoutSeg: 60 },
    { clica: /^Aprovar/ },
    { clica: /^Sim, aprovar/ },
    { espera: "pedido_enviado", timeoutSeg: 20 },
    { diz: "confirmar", interpretacao: { classe: "consulta", itens: [] } },
    { clica: /^Aceitar/, timeoutSeg: 20 },
    { espera: "confirmado", timeoutSeg: 30 },
  ],
  gabarito: [
    mapaSai({ validas: 3, recomendada: "cen-hoje" }),
    linhaDoMapa("cen-hoje", /condicionado/i, "I1"),
    mensagem({ com: "cen-hoje", tipo: "pedido_compra", texto: /desconto com condição/i, regra: "Revisão 80/7", descricao: "o pedido de compra pergunta se o desconto condicionado vale, sem jargão" }),
    nuncaMensagem({ com: "cen-hoje", texto: /não aplicado ao total/i, regra: "Revisão 80/7", descricao: "nenhum jargão interno ao fornecedor" }),
    nuncaMensagem({ com: "cen-hoje", texto: /já foi encerrada/i, regra: "Revisão 80/7", descricao: "a resposta ao pedido de compra não vira \"cotação encerrada\"" }),
    mensagem({ com: "comprador", texto: /Condição nova: desconto de 10%/, botoes: [/^Aceitar/, /^Manter/], regra: "Revisão 80/7", descricao: "o comprador recebe a condição nova com Aceitar e Manter" }),
    mensagem({ com: "comprador", texto: /pedido de compra enviado, esperando a confirmação do fornecedor/, regra: "Revisão 80", descricao: "\"confirmar\" com o pedido enviado recebe o estado certo" }),
    nuncaMensagem({ com: "comprador", texto: /está em cotação/, regra: "Revisão 80", descricao: "nunca \"está em cotação\" com o pedido de compra enviado" }),
    mensagem({ com: "cen-hoje", tipo: "pedido_compra", texto: /aceitou a condição nova/, vezes: 1, regra: "Revisão 80/7", descricao: "pedido de compra atualizado ao fornecedor" }),
    evento(/Aceitou a condição nova/, { vezes: 1, regra: "Revisão 80/7" }),
    mensagem({ com: "comprador", texto: new RegExp(`total R\\$\\s${DESCONTO_HOJE.toLocaleString("pt-BR", { minimumFractionDigits: 2 }).replace(".", "\\.")}`), regra: "Revisão 80/4", descricao: "o total novo tem o desconto (produto)" }),
    estadoDoItem("confirmado"),
  ],
};

// ---------- O resumo mostra as especificações; a pergunta recebe conferência ----------

const TEXTO_CAPACETE = "30 capacete de segurança com carneira classe A branco";
const CAPACETE = {
  itens: [{ descricao: "Capacete de segurança com carneira", quantidade: 30, unidade: "unidade", especificacao: [{ nome: "Classe", valor: "A" }, { nome: "Cor", valor: "branco" }] }],
  setor: "QSMS",
};

export const especificacaoNoResumo: Cenario = {
  chave: "especificacao",
  titulo: "Especificações no resumo e pergunta \"vc anotou?\" com resposta",
  descricao: "Pedido com classe e cor: o resumo mostra as duas. \"vc anotou a cor?\" não repete o resumo calado: diz que conferiu. \"não aceito similar\" diz o que mudou.",
  fornecedores: [],
  passos: [
    { diz: TEXTO_CAPACETE, interpretacao: CAPACETE },
    { dorme: 1 },
    { diz: "vc anotou a cor?", interpretacao: CAPACETE },
    { dorme: 1 },
    { diz: "não aceito similar", interpretacao: { ...CAPACETE, itens: CAPACETE.itens.map((i) => ({ ...i, aceitaSimilar: false })) } },
    { dorme: 1 },
  ],
  calmaSeg: 2,
  gabarito: [
    mensagem({ com: "comprador", texto: /^(?=[\s\S]*Classe: A)(?=[\s\S]*Cor: branco)/, regra: "Revisão 80/resumo", descricao: "o resumo mostra classe e cor" }),
    mensagem({ com: "comprador", texto: /^Conferi: está tudo anotado/, vezes: 1, regra: "Revisão 80/resumo", descricao: "a pergunta recebe conferência" }),
    mensagem({ com: "comprador", texto: /^Anotei: não aceita similar/, vezes: 1, regra: "Revisão 80/resumo", descricao: "a correção diz o que mudou" }),
    mensagem({ com: "comprador", texto: /\(não aceita similar\)/, regra: "Revisão 80/resumo", descricao: "o resumo diz \"não aceita similar\"" }),
    nuncaMensagem({ com: "comprador", texto: /risco regulado|entendimento anterior/i, regra: "Revisão 80/jargão", descricao: "sem jargão interno nas suposições" }),
  ],
};
