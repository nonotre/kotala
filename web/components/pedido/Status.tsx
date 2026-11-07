import { preview__IconIndicator as IconIndicator } from "@carbon/react";
import { ESTADO_ITEM, ESTADO_PEDIDO, INDICADOR_ITEM, INDICADOR_PEDIDO, INDICADOR_SITUACAO, SITUACAO, type Indicador } from "./textos";

type Tamanho = 16 | 20;

/** Situação com ícone e texto: nunca só cor. */
export function Status({ tipo, rotulo, tamanho = 16 }: { tipo: Indicador; rotulo: string; tamanho?: Tamanho }) {
  return <IconIndicator kind={tipo} label={rotulo} size={tamanho} />;
}

export function StatusItem({ estado, tamanho }: { estado: string; tamanho?: Tamanho }) {
  return <Status tipo={INDICADOR_ITEM[estado] ?? "unknown"} rotulo={ESTADO_ITEM[estado] ?? estado} tamanho={tamanho} />;
}

export function StatusPedido({ estado, tamanho }: { estado: string; tamanho?: Tamanho }) {
  return <Status tipo={INDICADOR_PEDIDO[estado] ?? "unknown"} rotulo={ESTADO_PEDIDO[estado] ?? estado} tamanho={tamanho} />;
}

export function StatusCotacao({ situacao }: { situacao: string }) {
  return <Status tipo={INDICADOR_SITUACAO[situacao] ?? "unknown"} rotulo={SITUACAO[situacao] ?? situacao} />;
}
