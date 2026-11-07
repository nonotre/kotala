"use client";

import { Layer } from "@carbon/react";
import type { ReactNode } from "react";
import s from "./comum.module.scss";

type Props = {
  titulo: string;
  /** Uma frase abaixo do título. */
  descricao?: ReactNode;
  /** À direita do título, como um botão `ghost` ou uma contagem. */
  acao?: ReactNode;
  /** Sem superfície: o conteúdo já traz a sua. */
  plano?: boolean;
  /** Com `plano`: o corpo é texto solto, e não cartão. Título e texto ficam na mesma borda. */
  solto?: boolean;
  id?: string;
  children?: ReactNode;
};

/** Trecho de tela com título, sobre uma superfície. */
export function Bloco({ titulo, descricao, acao, plano = false, solto = false, id, children }: Props) {
  const conteudo = (
    <>
      <header className={s.blocoTopo}>
        <div className={s.blocoTitulos}>
          <h2 className={s.blocoTitulo}>{titulo}</h2>
          {descricao ? <p className={s.blocoDescricao}>{descricao}</p> : null}
        </div>
        {acao}
      </header>
      {children}
    </>
  );
  if (plano) {
    return (
      <section id={id} className={`${s.bloco} ${s.blocoPlano} ${solto ? s.blocoSolto : ""}`}>
        {conteudo}
      </section>
    );
  }
  // A superfície é um nível acima: campo e Tile aqui dentro sobem junto e não somem nela.
  return (
    <Layer as="section" id={id} className={s.bloco}>
      {conteudo}
    </Layer>
  );
}
