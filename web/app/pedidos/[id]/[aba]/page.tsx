import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AbaBusca } from "@/components/pedido/AbaBusca";
import { AbaComparacao } from "@/components/pedido/AbaComparacao";
import { AbaCotacoes } from "@/components/pedido/AbaCotacoes";
import { AbaDecisao } from "@/components/pedido/AbaDecisao";
import { AbaHistorico } from "@/components/pedido/AbaHistorico";
import { AbaNegociacao } from "@/components/pedido/AbaNegociacao";
import { AbaSolicitado } from "@/components/pedido/AbaSolicitado";
import { navegacaoDoPedido } from "@/components/pedido/textos";
import { pedidoCompleto, type DadosPedido } from "@/lib/dados-pedido";

export const dynamic = "force-dynamic";

/** Pedido › Histórico e as telas das etapas da Compra. Os endereços de antes das etapas são os mesmos. */
const TELAS: Record<string, (props: { d: DadosPedido }) => ReactNode> = {
  historico: AbaHistorico,
  solicitado: AbaSolicitado,
  busca: AbaBusca,
  cotacoes: AbaCotacoes,
  comparacao: AbaComparacao,
  negociacao: AbaNegociacao,
  decisao: AbaDecisao,
};

/** Cada tela em `/pedidos/<id>/<aba>`. `/pedidos/<id>/compra` leva à etapa atual. */
export default async function AbaDoPedido({ params }: { params: Promise<{ id: string; aba: string }> }) {
  const { id, aba } = await params;
  const d = await pedidoCompleto(Number(id));
  if (!d) notFound();
  if (aba === "compra") redirect(navegacaoDoPedido(d).hrefCompra);
  const Tela = Object.hasOwn(TELAS, aba) ? TELAS[aba] : undefined;
  if (!Tela) notFound();
  return <Tela d={d} />;
}
