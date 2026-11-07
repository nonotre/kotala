import { Tag } from "@carbon/react";
import s from "./comum.module.scss";

/** Selo obrigatório em todo fornecedor simulado. Em frase corrida, um por bloco: texto "simulados". */
export function SeloSimulado({ texto = "simulado" }: { texto?: string }) {
  return (
    <Tag as="span" type="gray" size="sm" className={s.selo}>
      {texto}
    </Tag>
  );
}
