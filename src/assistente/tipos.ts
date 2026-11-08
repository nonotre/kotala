// Contrato do Assistente do chat web (Frente 3). As peças são feitas em paralelo:
//   consultas.ts         leitura do banco para as ferramentas (implementa Consultas)
//   agente.ts            o turno: modelo, ferramentas, validação (exporta responder)
//   roteador.ts          decide se a mensagem vai ao Assistente ou ao fluxo de hoje
//   validador.ts         confere números, pedidos e links da resposta
//   avaliacao/           casos e consultas de mentira para avaliar o Assistente
// Mudar um tipo daqui muda o contrato de todas: combine antes.

import type { Botao } from "../nucleo/mensagens/index.ts";

export type { Botao };

/** Quem está conversando. Vem do canal, nunca do modelo. */
export type ContextoAssistente = {
  /** Contato do chat web (o comprador desta conversa). */
  contatoId: string;
  agora: Date;
};

/** Estados do item, em linguagem do comprador, para filtro de busca. */
export type FiltroEstado = "aberto" | "aguardando_voce" | "cotando" | "concluido" | "cancelado" | "todos";

export type Urgencia = "normal" | "urgente" | "parada";

/** Tudo que tem tela leva o link relativo dela (ver ROTAS_PERMITIDAS). */
export type ComLink = { href: string };

export type ItemResumo = ComLink & {
  itemId: number;
  ordem: number;
  descricao: string;
  quantidade: number;
  unidade: string;
  /** Estado técnico (aguardando_decisao, cotando...). */
  estado: string;
  /** Coluna do quadro: Solicitado, Cotando, Comparando, Decidido (ou Cancelado). */
  coluna: string;
  /**
   * Categoria do item (base de itens ou catálogo), que decide quem recebe a cotação: fornecedor real
   * que disse o que vende só cota a própria categoria. Null quando não se sabe (aí vai a todos).
   */
  categoria: string | null;
  /** Revisão 80: o que foi anotado do item (classe, cor, bitola...). Sem isto o Assistente dizia "anotei tudo" sem ver. */
  especificacao?: Record<string, string>;
  aceitaSimilar?: boolean;
};

export type ResumoPedido = ComLink & {
  pedidoId: number;
  /** nomePedido(): "Pedido 11 · Placa de Inox 304 · setor comunicação". */
  nome: string;
  estado: string;
  setor: string | null;
  urgencia: Urgencia;
  criadoEm: string;
  atualizadoEm: string;
  /** O pedido foi feito nesta conversa (só esses aceitam botão de ação aqui). */
  daConversa: boolean;
  itens: ItemResumo[];
};

export type Pendencia = ComLink & {
  tipo: "confirmar_pedido" | "decidir" | "recompra" | "sem_proposta";
  pedidoId: number;
  itemId: number | null;
  titulo: string;
  texto: string;
  urgencia: Urgencia;
  em: string;
  daConversa: boolean;
};

export type CotacaoResumo = {
  fornecedor: string;
  fornecedorId: string;
  simulado: boolean;
  /** situacao_cotacao: enviada, respondida, sem_resposta, recusou... */
  situacao: string;
  rodada: number;
};

export type DetalhePedido = ResumoPedido & {
  destino: string | null;
  cep: string | null;
  prazoTexto: string | null;
  prazoMaxDias: number | null;
  entregas: string | null;
  suposicoes: string[];
  motivoCancelamento: string | null;
  itens: (ItemResumo & { rodada: number; cotacoes: CotacaoResumo[] })[];
};

export type PropostaResumo = {
  ofertaId: string;
  fornecedor: string;
  fornecedorId: string;
  simulado: boolean;
  lojaOnline: boolean;
  /** Em reais. */
  precoUnitario: number | null;
  frete: number | null;
  freteOrigem: string | null;
  custoTotal: number | null;
  prazoDias: number | null;
  pagamento: string | null;
  validade: string | null;
  confianca: string | null;
  nota: number | null;
};

export type MapaResumo = ComLink & {
  itemId: number;
  pedidoId: number;
  descricao: string;
  quantidade: number;
  unidade: string;
  estado: string;
  rodada: number;
  daConversa: boolean;
  validas: PropostaResumo[];
  cortadas: { fornecedor: string; simulado: boolean; motivos: string[] }[];
  /** ofertaId da recomendada, ou null (com menos de 3 válidas nunca diz "melhor"). */
  recomendada: string | null;
  justificativa: string | null;
  pesos: Record<string, number> | null;
  referenciaPublica: { loja: string; preco: number; unidade: string | null; link: string | null; em: string }[];
};

export type EventoResumo = { em: string; agente: string; acao: string; motivo: string; itemId: number | null };

export type FornecedorResumo = ComLink & {
  id: string;
  nome: string;
  origem: "real" | "simulado";
  categorias: string[];
  homologado: boolean;
  bloqueado: boolean;
  confianca: { nivel: string | null; pontos: number | null; motivos: string[]; alertas: string[] };
  /** Quantas compras confirmadas temos com ele. */
  compras: number;
};

export type CategoriaResumo = {
  categoria: string;
  /** Itens da base e do catálogo nessa categoria. */
  itens: number;
  /** Fornecedores ativos (não bloqueados, sem PARAR) que vendem essa categoria; simulados contam e vêm separados. */
  fornecedores: number;
  simulados: number;
};

export type CompraResumo = ComLink & {
  pedidoId: number;
  itemId: number | null;
  item: string;
  fornecedor: string;
  simulado: boolean;
  precoUnitario: number;
  quantidade: number;
  unidade: string;
  data: string;
  prazoCumprido: boolean | null;
};

export type EconomiaResumo = ComLink & {
  periodoDias: number;
  comprasConfirmadas: number;
  /** Em reais. */
  totalPago: number;
  /** Quanto abaixo da referência pública (positivo = economizou). Null sem referência. */
  economiaVsReferencia: number | null;
  /** Quanto abaixo da proposta mais cara de cada compra. */
  economiaVsMaisCara: number | null;
  /** Quanto a negociação baixou nas compras escolhidas. */
  economiaNegociacao: number | null;
  /** Contra o que cada número compara, em uma frase. */
  observacao: string;
};

/** Resumo gerado em código a cada turno; responde as perguntas simples sem ferramenta. */
export type CartaoEstado = {
  pendencias: Pendencia[];
  pedidosAbertos: ResumoPedido[];
  /** Pedido desta conversa em "confirma?" (a próxima mensagem pode ser correção). */
  pedidoEmConfirmacao: { pedidoId: number; nome: string } | null;
  /** Há dúvida de fornecedor esperando resposta deste comprador. */
  duvidaFornecedorPendente: { itemId: number; fornecedor: string; pergunta: string } | null;
};

/** Leitura do banco para as ferramentas. Tudo devolve objetos pequenos e serializáveis, valores em reais. */
export interface Consultas {
  cartaoDeEstado(ctx: ContextoAssistente): Promise<CartaoEstado>;
  pendencias(ctx: ContextoAssistente): Promise<Pendencia[]>;
  buscarPedidos(ctx: ContextoAssistente, filtro: { texto?: string; estado?: FiltroEstado; limite?: number }): Promise<ResumoPedido[]>;
  detalhePedido(ctx: ContextoAssistente, pedidoId: number): Promise<DetalhePedido | null>;
  mapaCotacao(ctx: ContextoAssistente, itemId: number): Promise<MapaResumo | null>;
  linhaDoTempo(ctx: ContextoAssistente, pedidoId: number, limite?: number): Promise<EventoResumo[] | null>;
  /** Por id, por nome, ou por categoria (quem vende; um fornecedor pode ter várias). Sem filtro: os mais confiáveis. */
  fornecedores(ctx: ContextoAssistente, busca: { id?: string; nome?: string; categoria?: string }): Promise<FornecedorResumo[]>;
  /** Categorias de material que a empresa compra, com quantos itens da base e quantos fornecedores ativos cada uma tem. */
  categorias(ctx: ContextoAssistente): Promise<CategoriaResumo[]>;
  historicoCompras(ctx: ContextoAssistente, texto: string): Promise<CompraResumo[]>;
  economia(ctx: ContextoAssistente, dias?: number): Promise<EconomiaResumo>;
}

/** Mensagem anterior da conversa, só texto. */
export type MensagemHistorico = { papel: "comprador" | "assistente"; texto: string };

export type ChamadaFerramenta = { nome: string; args: unknown; ok: boolean; ms: number };

export type RespostaAssistente =
  /** O fluxo de hoje cuida (pedido novo, correção, confirmação, resposta a fornecedor). */
  | { tipo: "encaminhar"; motivo: string; ferramentas: ChamadaFerramenta[]; modelo: string | null; ms: number }
  | {
      tipo: "resposta";
      texto: string;
      /** Ações (`dado` do fluxo) e links (`dado` = "link:/rota"). */
      botoes: Botao[];
      ferramentas: ChamadaFerramenta[];
      modelo: string;
      escalou: boolean;
      validacao: { ok: boolean; problemas: string[] };
      tokens: { entrada: number; saida: number };
      ms: number;
    };

export type EntradaAssistente = {
  ctx: ContextoAssistente;
  texto: string;
  historico: MensagemHistorico[];
};

export type OpcoesAssistente = {
  /** Consultas de mentira na avaliação; sem isso, as do banco. */
  consultas?: Consultas;
  /** Cadeias fixas no lugar das do .env (avaliação compara modelos assim). */
  modelos?: { conversa?: string[]; forte?: string[] };
  /** Nunca escala (para medir um modelo sozinho). */
  semEscalar?: boolean;
};

// ---------- Links ----------

/** Prefixo do `dado` de botão que é link: o chat web navega, nada vai ao assistente. */
export const PREFIXO_LINK = "link:";

/** Rotas que o Assistente pode citar. Ids conferidos à parte (pedido e fornecedor têm de existir). */
export const ROTAS_PERMITIDAS: readonly RegExp[] = [
  /^\/$/,
  /^\/(quadro|pedidos|avisos|fornecedores|economia|dashboard|itens|convite|chat|conversas|conduta|configuracoes)$/,
  /^\/pedidos\/\d+(#item-\d+)?$/,
  /^\/pedidos\/\d+\/(solicitado|busca|cotacoes|comparacao|negociacao|decisao|historico)(#item-\d+)?$/,
  /^\/fornecedores\/[0-9a-f-]{36}$/,
];

export function rotaPermitida(href: string): boolean {
  return ROTAS_PERMITIDAS.some((r) => r.test(href));
}

export const botaoLink = (rotulo: string, href: string): Botao => ({ rotulo, dado: `${PREFIXO_LINK}${href}` });
