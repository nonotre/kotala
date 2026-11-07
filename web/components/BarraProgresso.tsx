import type { ReactNode } from "react";
import s from "./comum.module.scss";

type Props = {
  rotulo: string;
  /** O rótulo fica só para leitor de tela. */
  semRotulo?: boolean;
  apoio?: ReactNode;
  valor: number;
  maximo: number;
};

/**
 * Barra de andamento, com a forma do `ProgressBar` pequeno do Carbon.
 * O do pacote escreve `Loading` e `Done` por conta própria, sem prop para traduzir, e leitor de tela lê em inglês.
 */
export function BarraProgresso({ rotulo, semRotulo = false, apoio, valor, maximo }: Props) {
  const fracao = maximo > 0 ? Math.min(Math.max(valor / maximo, 0), 1) : 0;
  return (
    <div className={s.barraProgresso}>
      {semRotulo ? null : <span className={s.barraProgressoRotulo}>{rotulo}</span>}
      <div className={s.barraProgressoTrilho} role="progressbar" aria-label={rotulo} aria-valuemin={0} aria-valuemax={maximo} aria-valuenow={Math.min(valor, maximo)}>
        <div className={s.barraProgressoValor} style={{ inlineSize: `${fracao * 100}%` }} />
      </div>
      {apoio ? <span className={s.barraProgressoApoio}>{apoio}</span> : null}
    </div>
  );
}
