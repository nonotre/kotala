// 3.4: cenário do simulador. Um arquivo TypeScript por cenário, com o comprador, os
// fornecedores de mentira (verdade + roteiro de cada um), os passos no tempo e o gabarito.

import type { EstadoItem } from "../../nucleo/orquestrador/estados.ts";
import type { TipoEnvio } from "../../nucleo/mensagens/index.ts";
import type { InterpretacaoSimulada, LeituraSimulada } from "../ia-falsa.ts";

/** A verdade de um fornecedor de mentira: o que ele cobra e como entrega. Alimenta o texto e o gabarito. */
export type Verdade = {
  /** Unitário, na unidade pedida. */
  preco: number;
  /** null: não informa o frete na proposta. 0: grátis. */
  frete: number | null;
  prazoDias: number;
  pagamento: string;
  validadeDias: number;
};

export type ItemDaConversa = { id: number; descricao: string; quantidade: number; unidade: string; rodada: number };

/** O que a persona escreve: texto (ou botão) e, para a IA falsa, a leitura certa do texto. */
export type Escrita = { texto: string; botao?: string; leitura?: LeituraSimulada };

export type ContextoFala = {
  item: ItemDaConversa;
  persona: PersonaCenario;
  /** A mensagem do sistema que provocou a fala (texto, tipo e botões). */
  recebida: { texto: string; tipo?: TipoEnvio; botoes?: { rotulo: string; dado: string }[] };
};

/** Uma mensagem da persona, com o atraso (segundos, depois da anterior do mesmo gatilho). */
export type Fala = { atrasoSeg: number; escrever: (c: ContextoFala) => Escrita | null; descricao: string };

/**
 * Gatilho do roteiro: o tipo da mensagem que o sistema mandou ao fornecedor
 * ("cotacao", "negociacao", "lembrete", "pedido_compra"...), e opcionalmente um trecho do texto.
 * Cada gatilho dispara uma vez, na ordem; `sempre` repete.
 */
export type Gatilho = { ao: TipoEnvio | "sem_tipo"; texto?: RegExp; sempre?: boolean; falas: Fala[] };

export type PersonaCenario = {
  /** Chave do fornecedor e endereço no canal "simulado". Use o prefixo "cen-". */
  chave: string;
  nome: string;
  verdade: Verdade;
  roteiro: Gatilho[];
};

/**
 * Comprador guiado por IA (3.3): quem ele é e o que quer. Na rodada com IA real, a IA escreve
 * a mensagem dele a partir disto e da conversa até aqui; na determinística, vale a `reserva`.
 */
export type CompradorIa = { quem: string; objetivo: string };

/** Passos do comprador. `clica` espera o botão aparecer (até o tempo limite). */
export type Passo =
  | { diz: string; interpretacao?: InterpretacaoSimulada }
  | { comprador: CompradorIa; reserva: string; interpretacao?: InterpretacaoSimulada }
  | { clica: RegExp; timeoutSeg?: number }
  | { espera: EstadoItem | EstadoItem[]; timeoutSeg?: number }
  | { esperaEvento: RegExp; timeoutSeg?: number }
  | { dorme: number };

export type ItemRastro = { id: number; descricao: string; quantidade: number; unidade: string; estado: string; rodada: number };

export type MensagemRastro = {
  /** "comprador" ou a chave da persona. */
  com: string;
  direcao: "saida" | "entrada";
  texto: string;
  tipo?: TipoEnvio;
  botoes?: { rotulo: string; dado: string }[];
  /** ms desde o início do cenário. */
  em: number;
};

export type EventoRastro = {
  agente: string;
  acao: string;
  motivo: string;
  dados: Record<string, unknown> | null;
  fornecedores: string[];
  itemPedidoId: number | null;
  paraEstado: string | null;
  em: number;
};

export type LinhaMapaRastro = { fornecedor: string; custo: number | null; alertas: string[]; motivos: string[]; negociacao: string | null; aConfirmar: boolean };

export type MapaRastro = { itemPedidoId: number; rodada: number; validas: LinhaMapaRastro[]; cortadas: LinhaMapaRastro[]; recomendada: string | null; em: number };

/** Tudo o que a conferência lê depois da rodada: memória (mensagens com tipo) e banco (estados, eventos, mapas). */
export type Rastro = {
  cenario: string;
  pedidoId: number | null;
  pedidoEstado: string | null;
  pedidoUrgencia: string | null;
  itens: ItemRastro[];
  mensagens: MensagemRastro[];
  eventos: EventoRastro[];
  mapas: MapaRastro[];
  cotacoes: { fornecedor: string; situacao: string; rodada: number }[];
  contatos: { fornecedor: string; ativo: boolean }[];
  verdades: Record<string, Verdade>;
  rede: { bloqueadas: string[]; geminiReais: number; geminiFalsas: number };
  iaSemResposta: { agente: string; texto: string }[];
  usoIa: { chamadas: number; falhas: number };
  /** Passos do comprador que não se cumpriram (botão que não apareceu, estado que não chegou). */
  passosFalhos: string[];
  erros: string[];
  duracaoMs: number;
};

export type ResultadoExpectativa = { ok: boolean; detalhe?: string };

export type Expectativa = {
  descricao: string;
  /** Regra de negócio que a expectativa confere (R14b, R13, I1...), para o resumo por regra. */
  regra: string;
  conferir: (r: Rastro) => ResultadoExpectativa;
};

export type Cenario = {
  chave: string;
  titulo: string;
  /** O que o cenário exercita, em uma ou duas frases. */
  descricao: string;
  /** Recurso que ainda não existe no main: o cenário roda, falha e o relatório marca "falhou (esperado)". */
  esperadoFalhar?: string;
  /** Variáveis de ambiente da rodada (prazos curtos etc.), por cima dos padrões do simulador. */
  ambiente?: Record<string, string>;
  fornecedores: PersonaCenario[];
  passos: Passo[];
  gabarito: Expectativa[];
  /** Segundos de calma (sem mensagem nova) no fim, antes de ler o rastro. */
  calmaSeg?: number;
};
