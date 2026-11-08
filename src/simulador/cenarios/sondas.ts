// Sondas: cenários curtos que cutucam pontos frágeis já vistos nas rodadas anteriores
// (frente-3-simulador.md, "O que os testes e as rodadas acharam"), para virarem regressão.

import { completarFrete, descontoNovoPreco, descontoPercentual, parar as falaParar, personaDireta, proposta, recusaDesconto, texto, verdade, CONFIRMA_PEDIDO } from "./falas.ts";
import { PEDE_E_CONFIRMA, QTD_CIMENTO } from "./comum.ts";
import { contatoAtivo, custoNoMapa, estadoDoItem, evento, linhaDoMapa, mapaSai, mensagem, nuncaMensagem, semAlertaNoMapa } from "./gabarito.ts";
import type { Cenario, PersonaCenario } from "./tipos.ts";

// ---------- Proposta em duas mensagens quase juntas (I1) ----------

/** Manda a proposta sem frete e, logo em seguida, o frete, sem esperar o pedido do que falta. */
const picado: PersonaCenario = {
  chave: "cen-picado",
  nome: "Distribuidora Picada (cenário)",
  verdade: verdade(29),
  roteiro: [
    { ao: "cotacao", falas: [proposta({ atrasoSeg: 1, semFrete: true }), completarFrete(0.3)] },
    { ao: "negociacao", falas: [descontoPercentual(2, 1.5)] },
    CONFIRMA_PEDIDO,
  ],
};

export const duasMensagens: Cenario = {
  chave: "duas-mensagens",
  titulo: "Proposta em duas mensagens quase juntas",
  descricao: "O fornecedor manda o preço e, 0,3 s depois, o frete. Um pedido de desconto só, nunca junto do pedido do que falta, e o mapa com o frete e o desconto.",
  // Corrigido na junção do Bloco 4: as mensagens do mesmo fornecedor são tratadas uma de cada vez.
  // A IA real leva ~1,5 s por leitura; com a IA falsa instantânea a corrida não aparece.
  ambiente: { SIM_IA_LATENCIA_MS: "1200" },
  fornecedores: [
    picado,
    personaDireta("cen-beta", "Materiais Beta (cenário)", verdade(31), { atrasoSeg: 2.5, desconto: recusaDesconto() }),
    personaDireta("cen-gama", "Casa Gama (cenário)", verdade(32), { atrasoSeg: 3, desconto: recusaDesconto() }),
  ],
  passos: [...PEDE_E_CONFIRMA, { espera: "aguardando_decisao", timeoutSeg: 60 }],
  gabarito: [
    evento(/Pediu desconto ao fornecedor/, { fornecedor: "cen-picado", vezes: 1, regra: "I1", descricao: "um pedido de desconto só ao fornecedor das duas mensagens" }),
    mensagem({ com: "cen-picado", tipo: "negociacao", vezes: 1, regra: "I1", descricao: "uma mensagem de desconto só" }),
    nuncaMensagem({ com: "cen-picado", texto: /desconto[\s\S]*(para completar|me diga também)|(para completar|me diga também)[\s\S]*desconto/i, regra: "R13/desconto", descricao: "desconto nunca junto do pedido do que falta" }),
    mapaSai({ validas: 3, recomendada: "cen-picado" }),
    custoNoMapa("cen-picado", 29 * 0.98 * QTD_CIMENTO + 60, "I1"),
    nuncaMensagem({ com: "cen-picado", texto: /Não encontrei preço/, regra: "I1", descricao: "o complemento não é tratado como mensagem sem preço" }),
    semAlertaNoMapa(/Frete não informado/, "I1", "cen-picado"),
  ],
};

// ---------- "Vou ver com o gerente" no meio do desconto (I1) ----------

/** Ao pedido de desconto: "vou ver com o gerente" (o Extrator real lê como pedido de pessoa) e, depois, o preço novo. */
const gerente: PersonaCenario = {
  chave: "cen-gerente",
  nome: "Loja do Gerente (cenário)",
  verdade: verdade(31),
  roteiro: [
    { ao: "cotacao", falas: [proposta({ atrasoSeg: 1 })] },
    {
      ao: "negociacao",
      falas: [texto("Vou ver com o gerente e te retorno.", { classificacao: "responsavel" }, 1), descontoNovoPreco(4, 2.5)],
    },
    CONFIRMA_PEDIDO,
  ],
};

export const vouVer: Cenario = {
  chave: "vou-ver",
  titulo: "\"Vou ver com o gerente\" no meio do desconto",
  descricao: "O fornecedor responde ao desconto que vai ver com o gerente e volta com preço menor. Não é pedido de pessoa: nada vai ao comprador e o mapa espera o preço novo.",
  fornecedores: [
    gerente,
    personaDireta("cen-beta", "Materiais Beta (cenário)", verdade(30.5), { atrasoSeg: 1.5, desconto: recusaDesconto() }),
    personaDireta("cen-gama", "Casa Gama (cenário)", verdade(32), { atrasoSeg: 2, desconto: recusaDesconto() }),
  ],
  passos: [...PEDE_E_CONFIRMA, { espera: "aguardando_decisao", timeoutSeg: 60 }],
  gabarito: [
    evento(/vai responder o desconto depois/, { fornecedor: "cen-gerente", vezes: 1, regra: "I1" }),
    evento(/Fornecedor pediu uma pessoa/, { vezes: 0, regra: "I1", descricao: "não vira pedido de pessoa" }),
    nuncaMensagem({ com: "comprador", texto: /falar com uma pessoa/i, regra: "I1", descricao: "nada ao comprador sobre falar com uma pessoa" }),
    nuncaMensagem({ com: "cen-gerente", texto: /comprador respons[áa]vel/i, regra: "I1", descricao: "não responde \"vou avisar o comprador responsável\"" }),
    mapaSai({ validas: 3, recomendada: "cen-gerente" }),
    // 4% sobre R$ 31,00 = R$ 29,76 × 40 + frete.
    custoNoMapa("cen-gerente", 29.76 * QTD_CIMENTO + 60, "I1"),
  ],
};

// ---------- PARAR numa cotação e a próxima continua chegando ----------

const TEXTO_ARGAMASSA = "30 sacos de argamassa AC-II 20 kg pra obra alfa, setor estrutura";

export const pararProxima: Cenario = {
  chave: "parar-proxima",
  titulo: "Depois do PARAR, a próxima cotação continua chegando",
  descricao: "Delta diz PARAR na primeira cotação; o comprador faz outro pedido; Delta recebe a cotação nova, como a confirmação de saída prometeu.",
  fornecedores: [
    personaDireta("cen-alfa", "Depósito Alfa (cenário)", verdade(32), { atrasoSeg: 1, desconto: recusaDesconto() }),
    personaDireta("cen-beta", "Materiais Beta (cenário)", verdade(30), { atrasoSeg: 1.5, desconto: recusaDesconto() }),
    personaDireta("cen-gama", "Casa Gama (cenário)", verdade(31), { atrasoSeg: 2, desconto: recusaDesconto() }),
    { chave: "cen-delta", nome: "Atacado Delta (cenário)", verdade: verdade(29), roteiro: [{ ao: "cotacao", falas: [falaParar(1)] }] },
  ],
  passos: [
    ...PEDE_E_CONFIRMA,
    { espera: "aguardando_decisao", timeoutSeg: 60 },
    { diz: TEXTO_ARGAMASSA, interpretacao: { itens: [{ descricao: "Argamassa AC-II 20 kg", quantidade: 30, unidade: "saco" }], destino: "obra alfa", setor: "estrutura" } },
    { clica: /^Confirmar/ },
    { espera: "cotando", timeoutSeg: 20 },
  ],
  gabarito: [
    evento(/Saiu desta cotação \(PARAR\)/, { fornecedor: "cen-delta", vezes: 1, regra: "PARAR" }),
    contatoAtivo("cen-delta", true, "PARAR"),
    mensagem({ com: "cen-delta", tipo: "cotacao", vezes: 2, regra: "PARAR", descricao: "delta recebe as duas cotações (a segunda depois do PARAR)" }),
    estadoDoItem("cotando", "PARAR"),
  ],
};

// ---------- À vista no recebimento (R13) não é pagamento antecipado ----------

export const pagamentoAVista: Cenario = {
  chave: "a-vista",
  titulo: "À vista no recebimento não vira \"pagamento antecipado\"",
  descricao: "Três propostas no padrão da empresa (à vista, no recebimento) e uma com depósito antecipado. Só a antecipada leva o alerta no mapa.",
  // Corrigido na junção do Bloco 4: só o antecipado de verdade leva o alerta (R13).
  fornecedores: [
    personaDireta("cen-alfa", "Depósito Alfa (cenário)", verdade(32), { atrasoSeg: 1, desconto: recusaDesconto() }),
    personaDireta("cen-beta", "Materiais Beta (cenário)", verdade(30), { atrasoSeg: 1.5, desconto: recusaDesconto() }),
    personaDireta("cen-gama", "Casa Gama (cenário)", verdade(31), { atrasoSeg: 2, desconto: recusaDesconto() }),
    personaDireta("cen-sinal", "Atacado Sinal (cenário)", verdade(29, { pagamento: "depósito antecipado" }), { atrasoSeg: 2.5, desconto: recusaDesconto() }),
  ],
  passos: [...PEDE_E_CONFIRMA, { espera: "aguardando_decisao", timeoutSeg: 60 }],
  gabarito: [
    mapaSai({ validas: 4 }),
    linhaDoMapa("cen-sinal", /antecipado/i, "R13"),
    semAlertaNoMapa(/antecipado/i, "R13", "cen-alfa"),
    semAlertaNoMapa(/antecipado/i, "R13", "cen-beta"),
    semAlertaNoMapa(/antecipado/i, "R13", "cen-gama"),
  ],
};
