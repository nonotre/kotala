"use client";
// Início: as cotações, em quadro (?vista=quadro, padrão) ou em lista (?vista=lista). As conversas com o
// assistente voltaram a ser uma tela própria (Conversar, /chat), a pedido do dono.

import { Column } from "@carbon/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { GradePagina, Pagina } from "@/components/Pagina";
import type { AvisoSerial, LinhaPedido } from "@/lib/dados-operacao";
import { useGuardaVista } from "@/lib/ultima-vista";
import type { DadosQuadro } from "./dados-quadro";
import { hrefLista, ListaPedidos, type Filtro } from "./ListaPedidos";
import { AlternarCanceladas, PrecisaDeVoce, QuadroRaias } from "./Quadro";
import { VistaPedidos } from "./Situacao";
import s from "./inicio-quadro.module.scss";

export type VistaDoInicio = "quadro" | "lista";

const hrefQuadro = (canceladas: boolean) => (canceladas ? "/?canceladas=1" : "/");

/** Leva junto a conversa aberta na lateral: trocar de vista não fecha a conversa. */
function comConversa(href: string, c: string | null): string {
  if (!c) return href;
  return `${href}${href.includes("?") ? "&" : "?"}c=${encodeURIComponent(c)}`;
}

type Props = {
  vista: VistaDoInicio;
  filtroInicial: Filtro;
  mostrarCanceladas: boolean;
  /** Só o que pede ação do comprador. */
  avisos: AvisoSerial[];
  /** Só vem a base da vista aberta. */
  quadro?: DadosQuadro;
  linhas?: LinhaPedido[];
};

export function InicioQuadro({ vista, filtroInicial, mostrarCanceladas, avisos, quadro, linhas }: Props) {
  const c = useSearchParams().get("c");
  // O filtro mora aqui para sobreviver à troca de vista: quem vai ao quadro e volta à lista a acha como deixou.
  // A lista grava o filtro no endereço sem tirar o resto (a conversa aberta, em `c`).
  const [filtro, setFiltro] = useState<Filtro>(filtroInicial);
  const quadroHref = hrefQuadro(mostrarCanceladas);
  const listaHref = hrefLista(filtro);
  // A última vista não leva a conversa: voltar de uma cotação abre a lateral na conversa deste navegador.
  useGuardaVista(vista === "quadro" ? quadroHref : listaHref);

  return (
    <Pagina>
      <div className={s.layout}>
        <div className={s.principal}>
          <GradePagina>
            <Column sm={4} md={8} lg={16}>
              <PrecisaDeVoce avisos={avisos} />
            </Column>
            <Column sm={4} md={8} lg={16}>
              <div className={s.topo}>
                <h1 className={s.titulo}>Cotações</h1>
                <div className={s.controles}>
                  {vista === "quadro" ? (
                    <AlternarCanceladas mostrando={mostrarCanceladas} hrefMostrar={comConversa(hrefQuadro(true), c)} hrefOcultar={comConversa(hrefQuadro(false), c)} />
                  ) : null}
                  <VistaPedidos atual={vista} hrefQuadro={comConversa(quadroHref, c)} hrefLista={comConversa(listaHref, c)} />
                </div>
              </div>
            </Column>
            <Column sm={4} md={8} lg={16}>
              {vista === "quadro" && quadro ? <QuadroRaias colunas={quadro.colunas} extras={quadro.extras} /> : null}
              {vista === "lista" && linhas ? <ListaPedidos linhas={linhas} filtro={filtro} aoMudarFiltro={setFiltro} /> : null}
            </Column>
          </GradePagina>
        </div>
      </div>
    </Pagina>
  );
}
