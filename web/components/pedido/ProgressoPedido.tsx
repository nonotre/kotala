"use client";

import { ProgressIndicator, ProgressStep } from "@carbon/react";
import { BarraProgresso } from "@/components/BarraProgresso";
import s from "@/components/comum.module.scss";
import type { Progresso } from "./textos";

const ETAPAS = ["Solicitado", "Cotando", "Comparando", "Decidido"];

const TEXTO_PASSO: Record<string, string> = {
  "carbon.progress-step.complete": "Concluído",
  "carbon.progress-step.incomplete": "Ainda não",
  "carbon.progress-step.current": "Agora",
  "carbon.progress-step.invalid": "Com problema",
};
const traduzirPasso = (id: string) => TEXTO_PASSO[id] ?? id;

/** As 4 etapas do pedido. `ProgressIndicator` a partir de `lg`; abaixo, a barra. */
export function ProgressoPedido({ progresso }: { progresso: Progresso }) {
  const { atual, apoio, nome, invalido } = progresso;
  return (
    <>
      <div className={s.progressoGrande}>
        <ProgressIndicator currentIndex={atual} spaceEqually>
          {ETAPAS.map((c, i) => (
            <ProgressStep key={c} label={c} secondaryLabel={apoio[i]} invalid={invalido && i === atual} translateWithId={traduzirPasso} />
          ))}
        </ProgressIndicator>
      </div>
      <div className={s.progressoPequeno}>
        <BarraProgresso rotulo={nome} valor={Math.min(atual + 1, ETAPAS.length)} maximo={ETAPAS.length} apoio={apoio[Math.min(atual, ETAPAS.length - 1)]} />
      </div>
    </>
  );
}
