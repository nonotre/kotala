"use client";

import { AILabel, AILabelActions, AILabelContent } from "@carbon/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCelular } from "./useCelular";
import s from "./comum.module.scss";

type Props = {
  /** O que a IA concluiu, em uma linha. */
  titulo: string;
  /** Por quê: os dados que sustentam. */
  children: ReactNode;
  /** Botão ao pé da explicação. */
  acao?: ReactNode;
  tamanho?: "mini" | "2xs" | "xs" | "sm";
  /** `inline`, junto de um texto. Padrão: canto de um `Tile`, como `decorator`. */
  tipo?: "default" | "inline";
  /** Texto ao lado do selo, no tipo inline. */
  texto?: string;
};

/**
 * Selo de IA, com a explicação em português. Vai em todo conteúdo gerado ou sugerido.
 * Em `Tile`: `<Tile decorator={<SeloIA titulo="...">...</SeloIA>}>`. `Explicar` é botão separado, nunca o selo.
 */
export function SeloIA({ titulo, children, acao, tamanho = "xs", tipo = "default", texto }: Props) {
  const raiz = useRef<HTMLDivElement>(null);
  const celular = useCelular();
  const [lado, setLado] = useState<"bottom-start" | "bottom-end">("bottom-end");
  // No celular, o alinhamento automático do pacote só recalcula depois de rolar, e o balão abriria cortado: o lado sai de onde o selo está.
  useEffect(() => {
    const el = raiz.current;
    if (!el || !celular) return;
    const medir = () => setLado(el.getBoundingClientRect().left < window.innerWidth / 2 ? "bottom-start" : "bottom-end");
    medir();
    el.addEventListener("click", medir);
    return () => el.removeEventListener("click", medir);
  }, [celular]);
  return (
    <AILabel ref={raiz} aiText="IA" textLabel={tipo === "inline" ? texto ?? "Mostrar explicação" : "Mostrar explicação"} revertLabel="Voltar ao valor da IA" size={tamanho} kind={tipo} autoAlign={!celular} align={celular ? lado : undefined}>
      <AILabelContent>
        <div className={s.seloConteudo}>
          <p className={s.seloRotulo}>Explicação da IA</p>
          <p className={s.seloTitulo}>{titulo}</p>
          <div className={s.seloTexto}>{children}</div>
        </div>
        {acao ? <AILabelActions>{acao}</AILabelActions> : null}
      </AILabelContent>
    </AILabel>
  );
}
