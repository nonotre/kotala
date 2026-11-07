import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { CorpoPagina, Pagina } from "@/components/Pagina";
import { CabecalhoPedido } from "@/components/pedido/CabecalhoPedido";
import { pedidoCompleto } from "@/lib/dados-pedido";

export const dynamic = "force-dynamic";

/** Tudo o que as abas do pedido têm em volta. Pedido que não existe para aqui. */
export default async function LayoutPedido({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const d = await pedidoCompleto(Number(id));
  if (!d) notFound();
  return (
    <Pagina>
      <AtualizaSozinho segundos={4} />
      <CabecalhoPedido d={d} />
      <CorpoPagina>{children}</CorpoPagina>
    </Pagina>
  );
}
