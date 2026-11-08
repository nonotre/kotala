import { notFound } from "next/navigation";
import { PaginaVoz } from "@/components/consulta/PaginaVoz";
import { Ligacao } from "@/components/Ligacao";
import { conferirPedidoDaLigacao, dadosDaLigacao, FERRAMENTA_REGISTRAR, instrucoesDaLigacao, ligacaoAberta, MODELO_VOZ } from "../../../../src/agentes/voz/index.ts";
import { quantidade } from "@/lib/formato";

export const dynamic = "force-dynamic";

/** X5: ligação por voz com um fornecedor que não respondeu ao texto. */
export default async function Voz({ params }: { params: Promise<{ cotacao: string }> }) {
  const { cotacao } = await params;
  if (!/^[0-9a-f-]{36}$/.test(cotacao)) notFound();
  const d = await dadosDaLigacao(cotacao);
  if (!d) notFound();
  const aberta = ligacaoAberta({ item: d.item, cotacao: { rodada: d.rodada, situacao: d.situacao } });
  // S: os dados do pedido vêm do comprador e vão ao fornecedor: passam pela conferência de saída.
  const saida = conferirPedidoDaLigacao(d);
  return (
    <PaginaVoz
      pedidoId={d.pedido.id}
      itemId={d.item.id}
      fornecedor={d.fornecedor}
      simulado={d.simulado}
      pedidoTexto={`${quantidade(d.item.quantidade, d.item.unidade)} de ${d.item.descricao}`}
      ligacao={aberta && saida.ok ? <Ligacao cotacaoId={cotacao} modelo={MODELO_VOZ()} instrucoes={instrucoesDaLigacao(d)} ferramenta={FERRAMENTA_REGISTRAR} /> : null}
    />
  );
}
