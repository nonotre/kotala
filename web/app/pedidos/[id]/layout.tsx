import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { Pagina } from "@/components/Pagina";
import { AreaDoPedido } from "@/components/pedido/AreaDoPedido";
import { CabecalhoPedido } from "@/components/pedido/CabecalhoPedido";
import { navegacaoDoPedido, proximoPasso } from "@/components/pedido/textos";
import { pedidoCompleto } from "@/lib/dados-pedido";

export const dynamic = "force-dynamic";

/** Tudo o que as telas do pedido têm em volta. Pedido que não existe para aqui. */
export default async function LayoutPedido({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const d = await pedidoCompleto(Number(id));
  if (!d) notFound();
  const nav = navegacaoDoPedido(d);
  return (
    <Pagina>
      <AtualizaSozinho segundos={4} />
      <CabecalhoPedido d={d} nav={nav} />
      <AreaDoPedido nav={nav} passo={proximoPasso(d)}>
        {children}
      </AreaDoPedido>
    </Pagina>
  );
}
