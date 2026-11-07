import Link from "next/link";
import { notFound } from "next/navigation";
import { Ligacao } from "@/components/Ligacao";
import { Tag } from "@/components/carbon";
import { dadosDaLigacao, FERRAMENTA_REGISTRAR, instrucoesDaLigacao, MODELO_VOZ } from "../../../../src/agentes/voz/index.ts";
import { quantidade } from "@/lib/formato";
import estilos from "../../comum.module.scss";

export const dynamic = "force-dynamic";

/** X5: ligação por voz com um fornecedor que não respondeu ao texto. */
export default async function Voz({ params }: { params: Promise<{ cotacao: string }> }) {
  const { cotacao } = await params;
  if (!/^[0-9a-f-]{36}$/.test(cotacao)) notFound();
  const d = await dadosDaLigacao(cotacao);
  if (!d) notFound();
  const aberta = d.item.estado === "cotando" && ["aguardando", "respondeu"].includes(d.situacao);
  return (
    <>
      <p className={estilos.ajuda}>
        <Link href={`/pedidos/${d.pedido.id}#item-${d.item.id}`}>Pedido {d.pedido.id}</Link>
      </p>
      <h1 className={estilos.titulo}>
        Ligar para {d.fornecedor} {d.simulado ? <Tag size="sm" type="gray">simulado</Tag> : null}
      </h1>
      <p className={estilos.sub}>
        Cotação de {quantidade(d.item.quantidade, d.item.unidade)} de {d.item.descricao}. O assistente se apresenta, pergunta preço, frete, prazo e pagamento, confirma os valores e registra a proposta, que entra no mapa como resposta por voz. Use fone de ouvido. Na demonstração, uma pessoa do time faz o papel do fornecedor.
      </p>
      {aberta ? (
        <Ligacao cotacaoId={cotacao} modelo={MODELO_VOZ()} instrucoes={instrucoesDaLigacao(d)} ferramenta={FERRAMENTA_REGISTRAR} />
      ) : (
        <p className={estilos.sub}>Esta cotação não está mais aberta: não dá para ligar agora.</p>
      )}
    </>
  );
}
