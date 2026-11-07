"use client";

import { usePathname } from "next/navigation";
import { Abas } from "@/components/Abas";
import type { AbaPedido } from "./textos";

/**
 * Abas do pedido, pela rota. A aba aberta por endereço direto fica marcada e livre,
 * mesmo desabilitada ou oculta: o Tabs pularia para a primeira livre, e isso viraria navegação.
 */
export function AbasPedido({ itens }: { itens: AbaPedido[] }) {
  const rota = usePathname();
  const visiveis = itens.filter((a) => !a.oculta || a.href === rota).map((a) => (a.href === rota ? { ...a, desabilitada: false } : a));
  return <Abas rotulo="Abas do pedido" itens={visiveis} />;
}
