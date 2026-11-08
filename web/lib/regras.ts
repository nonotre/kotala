// Regras de compra em vigor, para a tela só de leitura em Configurações. Lidas das mesmas
// constantes que os agentes usam (src/config.ts e o comparador), no mesmo .env: o que a
// tela mostra é o que vale. Para mudar, edita-se o .env (ou a constante) e reinicia.

import {
  EMPRESA,
  EMPRESA_NICHO,
  ESPERA_PERGUNTA_FRACAO,
  FRACAO_LEMBRETE,
  JANELA_CONFIRMACAO_MIN,
  LIMITE_COMPRA_MAIOR,
  MAX_AMPLIACOES,
  MAX_FORNECEDORES,
  ESPERA_RESPOSTA_PRAZO_FRACAO,
  MAX_PRORROGACOES,
  NEGOCIACAO_ESPERA_FRACAO,
  PAGAMENTO_PADRAO,
  PRAZO_MODO,
  PRAZO_RESPOSTAS_SEG,
} from "../../src/config.ts";
import { FRETE_ESTIMADO_FRACAO, LIMITE_RETENCAO, MINIMO_PROPOSTAS_VALIDAS, PESOS_BASE, ROTULO_CRITERIO, type Criterio } from "../../src/agentes/comparador/calculo.ts";
import { brl } from "./formato";

export type Regra = {
  nome: string;
  valor: string;
  explicacao: string;
  /** Variável do .env que muda a regra; null quando é fixa no código. */
  variavel: string | null;
  /** Regra nova da rodada 2 (IA da conversa, Frente 4). */
  nova?: boolean;
};

export type GrupoRegras = { titulo: string; descricao: string; regras: Regra[] };

const pct = (f: number) => `${Math.round(f * 100)}%`;
const minutos = (seg: number) => (seg % 60 === 0 ? `${seg / 60} min` : `${seg} s`);

export function regrasDeCompra(): GrupoRegras[] {
  const demo = PRAZO_MODO() === "demo";
  const prazo = PRAZO_RESPOSTAS_SEG();
  const nicho = EMPRESA_NICHO();
  return [
    {
      titulo: "Prazos",
      descricao: "Quanto tempo cada lado tem para responder.",
      regras: [
        {
          nome: "Modo do prazo",
          valor: demo ? "Demonstração" : "Real",
          explicacao: demo
            ? "Todo prazo de resposta dos fornecedores é o da linha abaixo."
            : `3 dias para compras menores, 5 para as acima do limite de compra maior, 2 para negociação. A cotação fecha antes se todos responderem.`,
          variavel: "PRAZO_MODO",
        },
        { nome: "Prazo de respostas na demonstração", valor: minutos(prazo), explicacao: "Tempo dos fornecedores para responder, no modo demonstração.", variavel: "PRAZO_RESPOSTAS_SEG" },
        { nome: "Limite de compra maior", valor: brl(LIMITE_COMPRA_MAIOR()), explicacao: "Acima deste valor estimado, a compra ganha o prazo longo (modo real).", variavel: "LIMITE_COMPRA_MAIOR" },
        { nome: "Lembrete ao fornecedor", valor: `${pct(FRACAO_LEMBRETE)} do prazo`, explicacao: "Quem não respondeu recebe um lembrete neste ponto do prazo.", variavel: null },
        {
          nome: "Janela para confirmar o pedido",
          valor: `${JANELA_CONFIRMACAO_MIN()} min`,
          explicacao: "Tempo do comprador para responder às perguntas e confirmar. Nesse tempo, toda mensagem completa o pedido em aberto.",
          variavel: "JANELA_CONFIRMACAO_MIN",
        },
        {
          nome: "Espera de uma pergunta ao fornecedor",
          valor: `${pct(ESPERA_PERGUNTA_FRACAO)} do prazo`,
          explicacao: "Uma pergunta por vez ao fornecedor; sem resposta por mais que isso, a pergunta deixa de segurar a fila.",
          variavel: null,
          nova: true,
        },
      ],
    },
    {
      titulo: "Fornecedores consultados",
      descricao: "Quantos fornecedores entram em cada cotação.",
      regras: [
        { nome: "Teto de fornecedores por item", valor: String(MAX_FORNECEDORES()), explicacao: "Máximo de fornecedores consultados em cada item.", variavel: "MAX_FORNECEDORES" },
        {
          nome: "Mínimo de propostas válidas",
          valor: String(MINIMO_PROPOSTAS_VALIDAS),
          explicacao: "Com menos que isso, o mapa nunca diz \"melhor\" e a busca automática procura mais fornecedores.",
          variavel: null,
        },
        {
          nome: "Levas de busca automática",
          valor: `${MAX_AMPLIACOES()} por rodada (urgente: 1)`,
          explicacao: "Quando faltam propostas válidas no fim do prazo, o assistente procura mais fornecedores sozinho até este número de vezes.",
          variavel: "MAX_AMPLIACOES",
          nova: true,
        },
      ],
    },
    {
      titulo: "Negociação automática",
      descricao: "O pedido de desconto que vai junto do \"Recebi sua proposta\".",
      regras: [
        {
          nome: "Janela para responder ao desconto",
          valor: `${pct(NEGOCIACAO_ESPERA_FRACAO)} do prazo`,
          explicacao: "Tempo do fornecedor para responder ao pedido de desconto; a cotação espera essa janela antes de fechar.",
          variavel: null,
          nova: true,
        },
        {
          nome: "Pagamento padrão da empresa (R13)",
          valor: PAGAMENTO_PADRAO,
          explicacao: "Vai na solicitação de proposta quando o comprador não diz a forma dele, e é o argumento do pedido de desconto. Pagamento antecipado é condição a negociar.",
          variavel: null,
          nova: true,
        },
        {
          nome: "Prazo vencido com menos de 3 propostas (R14b)",
          valor: `até ${MAX_PRORROGACOES()} prorrogações`,
          explicacao: `O comprador escolhe encerrar ou estender; sem resposta em ${pct(ESPERA_RESPOSTA_PRAZO_FRACAO)} do prazo, encerra com o que houver. Estender dá prioridade à cotação e busca mais fornecedores.`,
          variavel: "MAX_PRORROGACOES",
          nova: true,
        },
      ],
    },
    {
      titulo: "Mapa de cotação",
      descricao: "Como as propostas são comparadas. As contas são feitas em código; a IA não calcula.",
      regras: [
        {
          nome: "Pesos da nota",
          valor: (Object.keys(PESOS_BASE) as Criterio[]).map((c) => `${ROTULO_CRITERIO[c]} ${PESOS_BASE[c]}`).join(", "),
          explicacao: "Peso de cada critério na nota da proposta. Ainda a confirmar com a Ester.",
          variavel: null,
        },
        {
          nome: "Preço muito abaixo da referência",
          valor: `${pct(LIMITE_RETENCAO)} abaixo`,
          explicacao: "A proposta fica retida até o fornecedor confirmar o preço.",
          variavel: null,
        },
        { nome: "Frete estimado", valor: `${pct(FRETE_ESTIMADO_FRACAO)} do produto`, explicacao: "Sem frete informado nem outros fretes para comparar, o mapa estima este valor.", variavel: null },
      ],
    },
    {
      titulo: "Empresa",
      descricao: "Dados da empresa usados nas mensagens e no frete.",
      regras: [
        { nome: "Empresa", valor: `${EMPRESA.nome} (CNPJ ${EMPRESA.cnpj})`, explicacao: "Nome e CNPJ que vão para os fornecedores.", variavel: "EMPRESA_NOME, EMPRESA_CNPJ" },
        { nome: "Entrega padrão", valor: `${EMPRESA.enderecoEntrega}, CEP ${EMPRESA.cep}`, explicacao: "Reserva: vale quando o pedido não diz o destino e a empresa de quem pediu não tem local padrão em Configurações › Endereços (ou o contato não tem conta).", variavel: "EMPRESA_ENDERECO, EMPRESA_CEP" },
        {
          nome: "Nicho da empresa",
          valor: nicho.join(", ") || "geral",
          explicacao: "Só escolhe os exemplos e o jargão das mensagens; nunca limita o que pode ser pedido.",
          variavel: "EMPRESA_NICHO",
          nova: true,
        },
      ],
    },
  ];
}
