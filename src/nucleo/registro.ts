// N5: registra o que cada agente fez e por quê. A tela e o pitch leem daqui.

import { evento } from "./db/schema.ts";
import type { Executor } from "./db/cliente.ts";

export const AGENTES = [
  "Acompanhamento do pedido", // orquestrador
  "Interpretador",
  "Busca",
  "Cotador",
  "Extrator",
  "Comparador",
  "Negociador",
  "Voz",
  "Comprador", // ação humana
  "Fornecedor",
] as const;
export type Agente = (typeof AGENTES)[number];

export type NovoEvento = {
  agente: Agente;
  acao: string;
  motivo: string;
  pedidoId?: number;
  itemPedidoId?: number;
  deEstado?: string;
  paraEstado?: string;
  fornecedorIds?: string[];
  dados?: unknown;
};

export async function registrar(exec: Executor, e: NovoEvento) {
  const [linha] = await exec
    .insert(evento)
    .values({
      agente: e.agente,
      acao: e.acao,
      motivo: e.motivo,
      pedidoId: e.pedidoId,
      itemPedidoId: e.itemPedidoId,
      deEstado: e.deEstado,
      paraEstado: e.paraEstado,
      fornecedorIds: e.fornecedorIds,
      dados: e.dados,
    })
    .returning();
  return linha!;
}
