// Dados do quadro para o Início, que é uma tela de servidor: o que sai daqui é serializável.

import type { AvisoSerial, ExtraDoItem } from "@/lib/dados-operacao";
import { COLUNAS, quadro, type Coluna } from "@/lib/dados";
import { avisosComContexto, extrasDosItens, pedeAcao } from "@/lib/dados-operacao";
import type { CartaoSerial } from "./Quadro";

export type DadosQuadro = {
  colunas: Record<Coluna, CartaoSerial[]>;
  extras: Record<number, ExtraDoItem>;
  /** Só o que pede ação do comprador. */
  avisos: AvisoSerial[];
};

/** `donoId` ("Só os meus"): só os cards e os avisos das cotações dessa pessoa. */
export async function dadosDoQuadro(mostrarCanceladas: boolean, donoId?: string | null): Promise<DadosQuadro> {
  const bruto = await quadro(mostrarCanceladas, donoId);
  const ids = COLUNAS.flatMap((c) => bruto[c].map((x) => x.itemId));
  const [extras, avisos] = await Promise.all([extrasDosItens(ids), avisosComContexto(donoId)]);

  const colunas = Object.fromEntries(
    COLUNAS.map((c) => [
      c,
      bruto[c].map(
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
          // Frente 2: quem é o responsável pelo card (o usuário de quem pediu, ou o posto no lugar dele).
          dono: x.dono,
        }),
      ),
    ]),
  ) as Record<Coluna, CartaoSerial[]>;

  return { colunas, extras, avisos: avisos.filter((a) => pedeAcao(a.tipo)) };
}

/** Só o "Precisa de você", para a vista em lista, que não monta o quadro. */
export async function avisosQuePedemAcao(donoId?: string | null): Promise<AvisoSerial[]> {
  return (await avisosComContexto(donoId)).filter((a) => pedeAcao(a.tipo));
}
