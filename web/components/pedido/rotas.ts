// Rotas do pedido, sem banco: servem ao servidor e às peças de cliente (abas, etapas).
// Dois níveis na tela, um só nível no endereço: cada tela é `/pedidos/<id>/<aba>`.

export type AbaId = "resumo" | "historico" | "solicitado" | "busca" | "cotacoes" | "comparacao" | "negociacao" | "decisao";

export type EtapaId = "solicitado" | "cotando" | "comparando" | "decidido";

export type AreaId = "pedido" | "compra";

/** A etapa de cada tela da Compra. Resumo e Histórico são do Pedido. */
export const ETAPA_DA_ABA: Partial<Record<AbaId, EtapaId>> = {
  solicitado: "solicitado",
  busca: "cotando",
  cotacoes: "cotando",
  comparacao: "comparando",
  negociacao: "comparando",
  decisao: "decidido",
};

export const areaDaAba = (aba: string): AreaId => (Object.hasOwn(ETAPA_DA_ABA, aba) ? "compra" : "pedido");

/** A aba pela rota: `/pedidos/14` é o Resumo; `/pedidos/14/busca`, a Busca. Rota de fora do pedido: null. */
export function abaDaRota(rota: string): string | null {
  const m = rota.match(/^\/pedidos\/\d+(?:\/([a-z]+))?\/?$/);
  return m ? (m[1] ?? "resumo") : null;
}

export const hrefAba = (pedidoId: number, aba: AbaId, itemId?: number) =>
  `/pedidos/${pedidoId}${aba === "resumo" ? "" : `/${aba}`}${itemId !== undefined ? `#item-${itemId}` : ""}`;
