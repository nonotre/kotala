"use client";

import { Button, InlineNotification } from "@carbon/react";
import { ErrorEmptyState } from "@carbon/ibm-products";
import Link from "next/link";
import type { ReactNode } from "react";
import { useTema } from "@/lib/tema";
import s from "./comum.module.scss";

type Props = {
  /** O que parou. */
  titulo: string;
  /** O que fazer. */
  texto?: ReactNode;
  /** Com ele, aparece o botão `Tentar de novo`. */
  aoTentar?: () => void;
  /** Tela quebrada: `ErrorEmptyState`, em vez do aviso junto do que falhou. */
  tela?: boolean;
  /** Link de saída, na tela quebrada. */
  saida?: { texto: string; href: string };
};

/** Erro junto do que falhou, acima dos botões, ou de tela inteira. Sem código e sem piada. */
export function EstadoErro({ titulo, texto, aoTentar, tela = false, saida }: Props) {
  const { escuro } = useTema();
  if (tela) {
    return (
      <div className={s.vazio}>
        <ErrorEmptyState
          title={titulo}
          subtitle={texto}
          headingAs="h1"
          illustrationTheme={escuro ? "dark" : "light"}
          {...(aoTentar ? { action: { text: "Tentar de novo", onClick: aoTentar, kind: "primary" as const } } : {})}
        />
        {saida ? <p><Link href={saida.href}>{saida.texto}</Link></p> : null}
      </div>
    );
  }
  return (
    <div className={s.confirmar}>
      <InlineNotification kind="error" lowContrast hideCloseButton title={titulo} subtitle={typeof texto === "string" ? texto : undefined} statusIconDescription="Erro">
        {typeof texto === "string" ? null : texto}
      </InlineNotification>
      {aoTentar ? (
        <div className={s.botoes}>
          <Button kind="tertiary" size="sm" onClick={aoTentar}>
            Tentar de novo
          </Button>
        </div>
      ) : null}
    </div>
  );
}
