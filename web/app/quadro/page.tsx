import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { Quadro, type CartaoSerial } from "@/components/operacao/Quadro";
import { COLUNAS, quadro, type Coluna } from "@/lib/dados";
import { avisosComContexto, extrasDosItens, pedeAcao } from "@/lib/dados-operacao";

export const dynamic = "force-dynamic";

export default async function PaginaQuadro({ searchParams }: { searchParams: Promise<{ canceladas?: string }> }) {
  const mostrarCanceladas = (await searchParams).canceladas === "1";
  const colunas = await quadro(mostrarCanceladas);
  const ids = COLUNAS.flatMap((c) => colunas[c].map((x) => x.itemId));
  const [extras, avisos] = await Promise.all([extrasDosItens(ids), avisosComContexto()]);

  // Só dados serializáveis para o cliente.
  const serial = Object.fromEntries(
    COLUNAS.map((c) => [
      c,
      colunas[c].map(
        (x): CartaoSerial => ({
          itemId: x.itemId,
          pedidoId: x.pedidoId,
          descricao: x.descricao,
          quantidade: x.quantidade,
          unidade: x.unidade,
          estado: x.estado,
          estadoPedido: x.estadoPedido,
          coluna: x.coluna,
          etiquetas: x.etiquetas,
        }),
      ),
    ]),
  ) as Record<Coluna, CartaoSerial[]>;

  return (
    <>
      <AtualizaSozinho segundos={3} />
      <Quadro colunas={serial} extras={extras} avisos={avisos.filter((a) => pedeAcao(a.tipo))} mostrarCanceladas={mostrarCanceladas} />
    </>
  );
}
