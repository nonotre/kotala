import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AbaBusca } from "@/components/pedido/AbaBusca";
import { AbaComparacao } from "@/components/pedido/AbaComparacao";
import { AbaCotacoes } from "@/components/pedido/AbaCotacoes";
import { AbaDecisao } from "@/components/pedido/AbaDecisao";
import { AbaHistorico } from "@/components/pedido/AbaHistorico";
import { AbaNegociacao } from "@/components/pedido/AbaNegociacao";
import { pedidoCompleto, type DadosPedido } from "@/lib/dados-pedido";

export const dynamic = "force-dynamic";

const TELAS: Record<string, (props: { d: DadosPedido }) => ReactNode> = {
  busca: AbaBusca,
  cotacoes: AbaCotacoes,
  comparacao: AbaComparacao,
  negociacao: AbaNegociacao,
  decisao: AbaDecisao,
  historico: AbaHistorico,
};

/** As abas do pedido além do Resumo, cada uma em `/pedidos/<id>/<aba>`. */
export default async function AbaDoPedido({ params }: { params: Promise<{ id: string; aba: string }> }) {
  const { id, aba } = await params;
  const Tela = Object.hasOwn(TELAS, aba) ? TELAS[aba] : undefined;
  if (!Tela) notFound();
  const d = await pedidoCompleto(Number(id));
  if (!d) notFound();
  return <Tela d={d} />;
}
