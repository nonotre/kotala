"use client";
// Início: as cotações, em quadro (?vista=quadro, padrão) ou em lista (?vista=lista). As conversas com o
// assistente voltaram a ser uma tela própria (Conversar, /chat), a pedido do dono.

import { Column, Toggle } from "@carbon/react";
import { useRouter, useSearchParams } from "next/navigation";
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

/** "Só os meus" vale nas duas vistas: vai junto em todo endereço do Início. */
function comMeus(href: string, meus: boolean): string {
  if (!meus) return href;
  return `${href}${href.includes("?") ? "&" : "?"}meus=1`;
}

type Props = {
  vista: VistaDoInicio;
  filtroInicial: Filtro;
  mostrarCanceladas: boolean;
  /** Só as cotações de que quem entrou é dono ou responsável (?meus=1). */
  meus: boolean;
  /** Só o que pede ação do comprador. */
  avisos: AvisoSerial[];
  /** Só vem a base da vista aberta. */
  quadro?: DadosQuadro;
  linhas?: LinhaPedido[];
};

export function InicioQuadro({ vista, filtroInicial, mostrarCanceladas, meus, avisos, quadro, linhas }: Props) {
  const c = useSearchParams().get("c");
  const router = useRouter();
  // O filtro mora aqui para sobreviver à troca de vista: quem vai ao quadro e volta à lista a acha como deixou.
  // A lista grava o filtro no endereço sem tirar o resto (a conversa aberta, em `c`, e o "Só os meus").
  const [filtro, setFiltro] = useState<Filtro>(filtroInicial);
  const hrefQuadroCom = (canceladas: boolean, soMeus = meus) => comMeus(hrefQuadro(canceladas), soMeus);
  const quadroHref = hrefQuadroCom(mostrarCanceladas);
  const listaHref = comMeus(hrefLista(filtro), meus);
  // A última vista não leva a conversa: voltar de uma cotação abre a lateral na conversa deste navegador.
  useGuardaVista(vista === "quadro" ? quadroHref : listaHref);

  // A escolha vai para o endereço (sem passo novo no histórico); o servidor filtra pela sessão.
  const trocarMeus = (soMeus: boolean) => {
    const destino = vista === "quadro" ? hrefQuadroCom(mostrarCanceladas, soMeus) : comMeus(hrefLista(filtro), soMeus);
    router.replace(comConversa(destino, c), { scroll: false });
  };

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
                  <Toggle id="inicio-so-os-meus" size="sm" labelText="Só os meus" hideLabel toggled={meus} onToggle={trocarMeus} />
                  {vista === "quadro" ? (
                    <AlternarCanceladas mostrando={mostrarCanceladas} hrefMostrar={comConversa(hrefQuadroCom(true), c)} hrefOcultar={comConversa(hrefQuadroCom(false), c)} />
                  ) : null}
                  <VistaPedidos atual={vista} hrefQuadro={comConversa(quadroHref, c)} hrefLista={comConversa(listaHref, c)} />
                </div>
              </div>
            </Column>
            <Column sm={4} md={8} lg={16}>
              {vista === "quadro" && quadro ? <QuadroRaias colunas={quadro.colunas} extras={quadro.extras} meus={meus} /> : null}
              {vista === "lista" && linhas ? <ListaPedidos linhas={linhas} filtro={filtro} aoMudarFiltro={setFiltro} meus={meus} /> : null}
            </Column>
          </GradePagina>
        </div>
      </div>
    </Pagina>
  );
}
