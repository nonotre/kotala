"use client";

import { Tab, TabList, TabPanel, TabPanels, Tabs, useLayer } from "@carbon/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import s from "./comum.module.scss";

export type Aba = {
  id: string;
  rotulo: string;
  href?: string;
  desabilitada?: boolean;
  /** Por que está desabilitada: vira o `title`. */
  motivo?: string;
};

/** Fora de `Layer`, o nível é 1. Dentro do `Layer` de um Bloco ou da faixa, 2: as abas estão sobre superfície. */
const NIVEL_SOBRE_SUPERFICIE = 2;

/** Espera a rolagem do próprio Carbon terminar, depois de montar ou de trocar de aba. */
const ESPERA_ROLAGEM_MS = 250;

/**
 * Traz a aba marcada para dentro da área visível. O `Tabs` para antes do fim e deixa o rótulo sob a seta.
 * A folga é a largura da seta; na última aba, vai até o fim, e a seta some.
 */
function mostrarAbaMarcada(raiz: HTMLElement | null) {
  const lista = raiz?.querySelector<HTMLElement>('[role="tablist"]');
  const aba = lista?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (!lista || !aba || lista.scrollWidth <= lista.clientWidth) return;
  const seta = raiz?.querySelector<HTMLElement>("button[aria-hidden='true'][tabindex='-1']")?.offsetWidth ?? 0;
  const ultima = !aba.nextElementSibling;
  const fimVisivel = lista.scrollLeft + lista.clientWidth - (ultima ? 0 : seta);
  const inicioVisivel = lista.scrollLeft + seta;
  if (aba.offsetLeft + aba.offsetWidth > fimVisivel) lista.scrollLeft = ultima ? lista.scrollWidth : aba.offsetLeft + aba.offsetWidth - lista.clientWidth + seta;
  else if (aba.offsetLeft < inicioVisivel) lista.scrollLeft = aba.offsetLeft - seta;
}

type Props = {
  itens: Aba[];
  /** Aba marcada. Com href, o padrão é a que bate com a rota. */
  ativa?: string;
  aoSelecionar?: (id: string) => void;
  rotulo?: string;
};

/** Abas por rota (com href) ou na própria página (com ativa e aoSelecionar). Sem painel: o conteúdo vem abaixo. */
export function Abas({ itens, ativa, aoSelecionar, rotulo = "Seções" }: Props) {
  const rota = usePathname();
  const router = useRouter();
  const { level } = useLayer();
  const marcada = itens.findIndex((a) => (ativa !== undefined ? a.id === ativa : a.href === rota));
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => mostrarAbaMarcada(raiz.current), ESPERA_ROLAGEM_MS);
    return () => clearTimeout(t);
  }, [marcada]);
  return (
    <div ref={raiz}>
    <Tabs
      selectedIndex={marcada >= 0 ? marcada : 0}
      onChange={({ selectedIndex }) => {
        const a = itens[selectedIndex];
        if (!a || a.desabilitada) return;
        if (a.href) router.push(a.href);
        else aoSelecionar?.(a.id);
      }}
    >
      <TabList aria-label={rotulo} activation="manual" className={level >= NIVEL_SOBRE_SUPERFICIE ? s.abasSobreSuperficie : undefined}>
        {itens.map((a) => (
          <Tab key={a.id} disabled={a.desabilitada} title={a.desabilitada ? a.motivo : undefined}>
            {a.rotulo}
          </Tab>
        ))}
      </TabList>
      {/* O conteúdo vem abaixo, fora daqui. Painéis ocultos, porque cada aba aponta para um por aria-controls. */}
      <TabPanels>
        {itens.map((a) => (
          <TabPanel key={a.id} className={s.painelOculto} />
        ))}
      </TabPanels>
    </Tabs>
    </div>
  );
}
