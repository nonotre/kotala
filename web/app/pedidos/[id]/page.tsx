import { notFound } from "next/navigation";
import { AbaResumo } from "@/components/pedido/AbaResumo";
import { pedidoCompleto } from "@/lib/dados-pedido";

export const dynamic = "force-dynamic";

/** Resumo: o que foi pedido, a confirmação e onde cada item está. */
export default async function ResumoDoPedido({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await pedidoCompleto(Number(id));
  if (!d) notFound();
  return <AbaResumo d={d} />;
}
