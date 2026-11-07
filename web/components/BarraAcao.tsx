"use client";

import { Layer } from "@carbon/react";
import type { ReactNode } from "react";
import s from "./comum.module.scss";

type Props = {
  /** Uma linha: nome, selo e custo. */
  resumo?: ReactNode;
  /** O botão, de ponta a ponta. */
  children: ReactNode;
};

/** Ação principal fixa no pé, abaixo de `lg`. A partir daí, some: a ação mora na faixa ou no painel. Reserva o próprio espaço. */
export function BarraAcao({ resumo, children }: Props) {
  return (
    <>
      <div className={s.barraEspaco} aria-hidden="true" />
      <Layer className={s.barra}>
        {resumo ? <div className={s.barraResumo}>{resumo}</div> : null}
        <div className={s.barraAcao}>{children}</div>
      </Layer>
    </>
  );
}
