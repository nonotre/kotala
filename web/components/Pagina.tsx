"use client";

import { Breadcrumb, BreadcrumbItem, Grid, Layer } from "@carbon/react";
import NextLink from "next/link";
import type { ComponentProps, ReactNode } from "react";
import s from "./comum.module.scss";

/** Raiz de toda tela. A casca tira o próprio preenchimento quando ela está lá. */
export function Pagina({ children }: { children: ReactNode }) {
  return (
    <div className={s.pagina} data-pagina="">
      {children}
    </div>
  );
}

type PropsCabecalho = {
  /** O único `h1` da tela. */
  titulo: ReactNode;
  /** Linha abaixo do título. */
  contexto?: ReactNode;
  /** Só em nível 2. O último é a página atual, sem link. */
  trilha?: { rotulo: string; href?: string }[];
  /** À direita: a ação da página, ou o progresso. */
  lado?: ReactNode;
  /** `Abas`, coladas no pé. */
  abas?: ReactNode;
};

/** Faixa do topo: onde estou, o que é isto e o que fazer. */
export function CabecalhoPagina({ titulo, contexto, trilha, lado, abas }: PropsCabecalho) {
  return (
    <Layer as="header" className={abas ? s.cabecalho : `${s.cabecalho} ${s.cabecalhoSemAbas}`}>
      <div className={s.cabecalhoTexto}>
        {trilha?.length ? (
          <Breadcrumb noTrailingSlash aria-label="Trilha" className={s.trilha}>
            {trilha.map((t, i) => (
              <BreadcrumbItem key={t.rotulo} isCurrentPage={i === trilha.length - 1}>
                {t.href && i < trilha.length - 1 ? <NextLink href={t.href}>{t.rotulo}</NextLink> : <span>{t.rotulo}</span>}
              </BreadcrumbItem>
            ))}
          </Breadcrumb>
        ) : null}
        <h1 className={s.titulo}>{titulo}</h1>
        {contexto ? <p className={s.contexto}>{contexto}</p> : null}
      </div>
      {lado ? <div className={s.cabecalhoLado}>{lado}</div> : null}
      {abas ? <div className={s.cabecalhoAbas}>{abas}</div> : null}
    </Layer>
  );
}

/** Conteúdo abaixo do cabeçalho, sobre o fundo. */
export function CorpoPagina({ children }: { children: ReactNode }) {
  return <div className={s.corpo}>{children}</div>;
}

/** `Grid fullWidth narrow`, com as duas bordas iguais. Um por grupo lógico. Toda `Column` com sm, md e lg. */
export function GradePagina({ className, children, ...resto }: ComponentProps<typeof Grid>) {
  return (
    <Grid fullWidth narrow className={className ? `${s.grade} ${className}` : s.grade} {...resto}>
      {children}
    </Grid>
  );
}
