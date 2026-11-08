// Nome de exibição das 4 etapas da cotação (as colunas do quadro). A chave continua a do
// núcleo (`Coluna`, em src/nucleo/orquestrador/estados.ts); só o texto da tela muda.
// Sem banco: serve ao servidor e às peças de cliente.

import type { Coluna } from "./dados";

export const ROTULO_COLUNA: Record<Coluna, string> = {
  Solicitado: "Solicitada",
  Cotando: "Propostas",
  Comparando: "Comparação",
  Decidido: "Pedido",
};
