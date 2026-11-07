"use client";

import { Button } from "@carbon/react";
import { NoDataEmptyState } from "@carbon/ibm-products";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useTema } from "@/lib/tema";
import { useCelular } from "./useCelular";
import s from "./comum.module.scss";

type Acao = {
  texto: string;
  href?: string;
  aoClicar?: () => void;
  /** `tertiary` quando há vários estados vazios na mesma tela. */
  tipo?: "primary" | "secondary" | "tertiary";
};

type Props = {
  titulo: string;
  /** O próximo passo, em uma frase. Nunca beco sem saída. */
  proximoPasso?: ReactNode;
  acao?: Acao;
  tamanho?: "lg" | "sm";
  /** Uma frase, sem caixa nem ilustração: raia vazia, tabela vazia. */
  compacto?: boolean;
  headingAs?: "h1" | "h2" | "h3" | "h4";
};

/** Vazio de qualquer tela: título curto, próximo passo e ação. */
export function EstadoVazio({ titulo, proximoPasso, acao, tamanho = "lg", compacto = false, headingAs = "h2" }: Props) {
  const { escuro } = useTema();
  const router = useRouter();
  const celular = useCelular();
  const aoClicar = acao ? acao.aoClicar ?? (acao.href ? () => router.push(acao.href as string) : undefined) : undefined;

  if (compacto) {
    return (
      <div className={s.vazioFrase}>
        <span>{titulo}</span>
        {proximoPasso ? <span>{proximoPasso}</span> : null}
        {acao?.href ? <Link href={acao.href}>{acao.texto}</Link> : null}
        {acao && !acao.href && aoClicar ? (
          <Button kind="ghost" size="sm" onClick={aoClicar}>
            {acao.texto}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className={s.vazio}>
      <NoDataEmptyState
        title={titulo}
        subtitle={proximoPasso}
        size={tamanho}
        headingAs={headingAs}
        illustrationTheme={escuro ? "dark" : "light"}
      />
      {/* O botão do pacote é sempre pequeno, e a prop não deixa mudar: abaixo de md, o alvo precisa de 48 px. */}
      {acao && aoClicar ? (
        <div className={s.vazioAcao}>
          <Button kind={acao.tipo ?? "primary"} size={celular ? "lg" : "sm"} onClick={aoClicar}>
            {acao.texto}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
