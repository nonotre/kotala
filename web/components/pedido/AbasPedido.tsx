"use client";

import { usePathname } from "next/navigation";
import { Abas } from "@/components/Abas";
import { abaDaRota, areaDaAba, hrefAba } from "./rotas";

/**
 * O primeiro nível do pedido: Pedido (Resumo e Histórico) e Compra (as etapas).
 * A aba marcada sai da área da tela aberta; Compra leva à etapa atual.
 */
export function AbasPedido({ pedidoId, hrefCompra }: { pedidoId: number; hrefCompra: string }) {
  const aba = abaDaRota(usePathname()) ?? "resumo";
  return (
    <Abas
      rotulo="Partes da cotação"
      ativa={areaDaAba(aba)}
      itens={[
        { id: "pedido", rotulo: "Cotação", href: hrefAba(pedidoId, "resumo") },
        { id: "compra", rotulo: "Compra", href: hrefCompra },
      ]}
    />
  );
}
