"use client";
// Q1: baixa o PDF do último mapa da cotação (o mesmo que vai anexado no Telegram e no e-mail).

import { Button } from "@carbon/react";
import { Download } from "@carbon/react/icons";

export function BaixarMapaPdf({ itemPedidoId }: { itemPedidoId: number }) {
  return (
    <Button as="a" href={`/api/mapa/${itemPedidoId}`} download kind="ghost" size="md" renderIcon={Download}>
      Baixar PDF
    </Button>
  );
}
