// N3: estados e transições, em dados puros. Sem banco e sem IA: serve para o
// orquestrador, para as telas (coluna do quadro) e para gerar o diagrama.

// ---------- Pedido (a mensagem do comprador, com N itens) ----------

export const ESTADOS_PEDIDO = [
  "interpretando", // R2 lendo o texto
  "aguardando_confirmacao", // "Entendi assim, confirma?"
  "em_andamento", // confirmado; os itens são cotados um por vez
  "concluido", // todos os itens chegaram a um estado final
  "cancelado",
] as const;
export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

export const EVENTOS_PEDIDO = [
  "interpretado",
  "comprador_corrigiu",
  "comprador_confirmou",
  "itens_finalizados",
  "cancelar",
] as const;
export type EventoPedido = (typeof EVENTOS_PEDIDO)[number];

// ---------- Item do pedido (a unidade que anda no quadro) ----------

export const ESTADOS_ITEM = [
  "na_fila", // espera o item anterior terminar
  "buscando", // R3
  "cotando", // R4 enviou; esperando respostas até o prazo (Q4)
  "comparando", // R7, R8, R9 montando o mapa
  "aguardando_decisao", // mapa pronto; o comprador decide (a IA nunca fecha a compra)
  "aprovado",
  "pedido_enviado", // R11 mandou o pedido ao vencedor
  "confirmado", // o vencedor confirmou
  "sem_proposta", // nenhuma proposta válida
  "cancelado",
] as const;
export type EstadoItem = (typeof ESTADOS_ITEM)[number];

export const EVENTOS_ITEM = [
  "iniciar_busca",
  "busca_concluida",
  "busca_sem_resultado",
  "encerrar_cotacao", // prazo venceu ou já há respostas suficientes
  "mapa_pronto",
  "sem_propostas_validas",
  "aprovar",
  "reprovar", // N6: volta para nova rodada de cotação
  "voltar_busca", // N6: volta para buscar mais fornecedores
  "negociar", // X3: nova rodada só com os fornecedores escolhidos para negociar
  "reavaliar", // refaz o mapa (preço confirmado, fornecedor tirado do mapa)
  "pedido_enviado",
  "fornecedor_confirmou",
  "fornecedor_desistiu", // volta ao mapa, sem o desistente
  "cancelar",
] as const;
export type EventoItem = (typeof EVENTOS_ITEM)[number];

export const FINAIS_ITEM: readonly EstadoItem[] = ["confirmado", "sem_proposta", "cancelado"];
export const FINAIS_PEDIDO: readonly EstadoPedido[] = ["concluido", "cancelado"];

type Transicao<E extends string, V extends string> = { de: readonly E[]; evento: V; para: E };

export const TRANSICOES_PEDIDO: readonly Transicao<EstadoPedido, EventoPedido>[] = [
  { de: ["interpretando"], evento: "interpretado", para: "aguardando_confirmacao" },
  { de: ["aguardando_confirmacao"], evento: "comprador_corrigiu", para: "interpretando" },
  { de: ["aguardando_confirmacao"], evento: "comprador_confirmou", para: "em_andamento" },
  { de: ["em_andamento"], evento: "itens_finalizados", para: "concluido" },
  { de: ["interpretando", "aguardando_confirmacao", "em_andamento"], evento: "cancelar", para: "cancelado" },
];

const NAO_FINAIS_ITEM = ESTADOS_ITEM.filter((e) => !FINAIS_ITEM.includes(e));

export const TRANSICOES_ITEM: readonly Transicao<EstadoItem, EventoItem>[] = [
  { de: ["na_fila"], evento: "iniciar_busca", para: "buscando" },
  { de: ["buscando"], evento: "busca_concluida", para: "cotando" },
  { de: ["buscando"], evento: "busca_sem_resultado", para: "sem_proposta" },
  { de: ["cotando"], evento: "encerrar_cotacao", para: "comparando" },
  { de: ["comparando"], evento: "mapa_pronto", para: "aguardando_decisao" },
  { de: ["comparando"], evento: "sem_propostas_validas", para: "sem_proposta" },
  { de: ["aguardando_decisao"], evento: "aprovar", para: "aprovado" },
  { de: ["aguardando_decisao"], evento: "reprovar", para: "cotando" },
  { de: ["aguardando_decisao", "comparando"], evento: "voltar_busca", para: "buscando" },
  { de: ["aguardando_decisao"], evento: "negociar", para: "cotando" },
  { de: ["aguardando_decisao"], evento: "reavaliar", para: "comparando" },
  { de: ["aprovado"], evento: "pedido_enviado", para: "pedido_enviado" },
  { de: ["pedido_enviado"], evento: "fornecedor_confirmou", para: "confirmado" },
  { de: ["pedido_enviado"], evento: "fornecedor_desistiu", para: "comparando" },
  { de: NAO_FINAIS_ITEM, evento: "cancelar", para: "cancelado" },
];

function proximo<E extends string, V extends string>(
  tabela: readonly Transicao<E, V>[],
  atual: E,
  evento: V,
): E | null {
  return tabela.find((t) => t.evento === evento && t.de.includes(atual))?.para ?? null;
}

export const proximoEstadoPedido = (atual: EstadoPedido, evento: EventoPedido) =>
  proximo(TRANSICOES_PEDIDO, atual, evento);

export const proximoEstadoItem = (atual: EstadoItem, evento: EventoItem) =>
  proximo(TRANSICOES_ITEM, atual, evento);

// ---------- Quadro (R10): as 4 colunas do site não mudam ----------

export const COLUNAS = ["Solicitado", "Cotando", "Comparando", "Decidido"] as const;
export type Coluna = (typeof COLUNAS)[number];

export const COLUNA_DO_ITEM: Record<EstadoItem, Coluna> = {
  na_fila: "Solicitado",
  buscando: "Cotando",
  cotando: "Cotando",
  comparando: "Comparando",
  aguardando_decisao: "Comparando",
  aprovado: "Decidido",
  pedido_enviado: "Decidido",
  confirmado: "Decidido",
  sem_proposta: "Decidido",
  cancelado: "Decidido",
};

/** Enquanto o pedido não foi confirmado, todos os itens ficam em Solicitado. */
export function colunaDoItem(estadoPedido: EstadoPedido, estadoItem: EstadoItem): Coluna {
  if (estadoPedido === "interpretando" || estadoPedido === "aguardando_confirmacao") return "Solicitado";
  return COLUNA_DO_ITEM[estadoItem];
}

/** Diagrama Mermaid gerado da tabela, para o pitch (Q6). */
export function diagramaMermaid(): string {
  const linhas = ["stateDiagram-v2", "  [*] --> na_fila"];
  for (const t of TRANSICOES_ITEM) {
    if (t.evento === "cancelar") continue;
    for (const de of t.de) linhas.push(`  ${de} --> ${t.para}: ${t.evento}`);
  }
  for (const f of FINAIS_ITEM) linhas.push(`  ${f} --> [*]`);
  return linhas.join("\n");
}
