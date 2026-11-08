"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CorpoPagina } from "@/components/Pagina";
import { EtapasCompra } from "./EtapasCompra";
import { FaixaProximoPasso } from "./FaixaProximoPasso";
import { abaDaRota, ETAPA_DA_ABA, type AbaId } from "./rotas";
import type { NavegacaoPedido, ProximoPasso } from "./textos";
import { TrocaVista } from "./TrocaVista";

/**
 * O que fica entre o cabeçalho e a tela, conforme a parte aberta. Fica no layout: se a tela quebrar,
 * etapas e o que falta agora continuam ali.
 * - Compra: as etapas, o que falta agora e, na etapa com mais de uma tela, o alternador.
 * - Pedido: o alternador entre Resumo e Histórico.
 */
export function AreaDoPedido({ nav, passo, children }: { nav: NavegacaoPedido; passo: ProximoPasso; children: ReactNode }) {
  const aba = abaDaRota(usePathname()) ?? "resumo";
  const etapaId = ETAPA_DA_ABA[aba as AbaId] ?? null;
  const etapa = nav.etapas.find((e) => e.id === etapaId);

  if (etapa) {
    return (
      <>
        <EtapasCompra etapas={nav.etapas} aberta={etapa.id} />
        <FaixaProximoPasso passo={passo} />
        <CorpoPagina>
          <TrocaVista rotulo={`Telas da etapa ${etapa.rotulo}`} itens={etapa.vistas} ativa={aba} />
          {children}
        </CorpoPagina>
      </>
    );
  }
  return (
    <CorpoPagina>
      <TrocaVista rotulo="Telas da cotação" itens={nav.vistasPedido} ativa={aba} />
      {children}
    </CorpoPagina>
  );
}
