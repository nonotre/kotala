"use client";
// Moldura da ligação por voz: trilha de volta ao pedido, quem recebe a ligação e o que se cota.

import { Column, Link as CarbonLink } from "@carbon/react";
import NextLink from "next/link";
import type { ReactNode } from "react";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { CabecalhoPagina, CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { SeloSimulado } from "@/components/SeloSimulado";
import s from "./consulta.module.scss";

type Props = {
  pedidoId: number;
  itemId: number;
  fornecedor: string;
  simulado: boolean;
  /** "40 sacos de Cimento CP II". */
  pedidoTexto: string;
  /** A ligação em si; null quando a cotação não está mais aberta. */
  ligacao: ReactNode;
};

export function PaginaVoz({ pedidoId, itemId, fornecedor, simulado, pedidoTexto, ligacao }: Props) {
  const voltar = `/pedidos/${pedidoId}#item-${itemId}`;
  return (
    <Pagina>
      <CabecalhoPagina
        trilha={[{ rotulo: `Pedido ${pedidoId}`, href: voltar }, { rotulo: "Ligação por voz" }]}
        titulo={
          <span className={s.titulo}>
            Ligar para {fornecedor}
            {simulado ? <SeloSimulado /> : null}
          </span>
        }
        contexto={`Cotação de ${pedidoTexto}.`}
      />
      <CorpoPagina>
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco
              titulo="Ligação"
              descricao="O assistente se apresenta, pergunta preço, frete, prazo e pagamento, confirma os valores e registra a proposta, que entra no mapa como resposta por voz. Use fone de ouvido. Na demonstração, uma pessoa do time faz o papel do fornecedor."
            >
              {ligacao ?? (
                <EstadoVazio
                  compacto
                  titulo="Esta cotação não está mais aberta: não dá para ligar agora."
                  proximoPasso={
                    <CarbonLink as={NextLink} href={voltar} inline>
                      Voltar ao pedido {pedidoId}
                    </CarbonLink>
                  }
                />
              )}
            </Bloco>
          </Column>
        </GradePagina>
      </CorpoPagina>
    </Pagina>
  );
}
