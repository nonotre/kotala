"use client";
// Cliente: o ícone (função) passa para o Button/Link do Carbon, e telas de servidor usam este link.
import { Button, Link as CarbonLink } from "@carbon/react";
import { Launch } from "@carbon/react/icons";
import type { ReactNode } from "react";
import s from "./comum.module.scss";

type TipoBotao = "primary" | "secondary" | "tertiary" | "ghost";

type Props = {
  href: string;
  children: ReactNode;
  /** Vira botão, com este tipo. Sem ele, é um link com o ícone. */
  botao?: TipoBotao;
  tamanho?: "sm" | "md" | "lg";
  /** Padrão: nova guia. */
  target?: string;
  title?: string;
};

/**
 * Link que abre em outra guia, com o ícone `Launch` e o aviso para leitor de tela.
 */
export function LinkExterno({ href, children, botao, tamanho, target, title }: Props) {
  const tipo = botao;
  const guia = target ?? "_blank";
  const aviso = <span className={s.somenteLeitor}> (abre em outra guia)</span>;
  if (tipo) {
    return (
      <Button href={href} target={guia} rel="noreferrer" title={title} kind={tipo} size={tamanho ?? "md"} renderIcon={Launch} data-link-externo="">
        {children}
        {aviso}
      </Button>
    );
  }
  return (
    <CarbonLink href={href} target={guia} rel="noreferrer" title={title} renderIcon={Launch} className={s.linkExterno} data-link-externo="">
      {children}
      {aviso}
    </CarbonLink>
  );
}

/** Legenda única acima de tabela com links curtos para outra guia. */
export function LegendaOutraGuia() {
  return (
    <span className={s.legendaGuia}>
      <Launch size={16} aria-hidden="true" />
      Links com este ícone abrem em outra guia
    </span>
  );
}
