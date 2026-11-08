"use client";

import { ProgressIndicator, ProgressStep } from "@carbon/react";
import { BarraProgresso } from "@/components/BarraProgresso";
import { ROTULO_COLUNA } from "@/lib/colunas";
import type { Coluna } from "@/lib/dados";
import s from "./operacao.module.scss";

// As 4 colunas do quadro, na ordem da esteira (mesma lista de estados.ts).
const COLUNAS: Coluna[] = ["Solicitado", "Cotando", "Comparando", "Decidido"];

const TEXTO_PASSO: Record<string, string> = {
  "carbon.progress-step.complete": "Concluída",
  "carbon.progress-step.incomplete": "Ainda não",
  "carbon.progress-step.current": "Agora",
  "carbon.progress-step.invalid": "Com problema",
};
const traduzirPasso = (id: string) => TEXTO_PASSO[id] ?? id;

const AINDA_NAO = "Ainda não começou";

type Props = {
  coluna: Coluna;
  estadoPedido: string;
  estadoItem: string | null;
  respostas: { consultados: number; respostas: number } | null;
  /** Propostas válidas no mapa, quando já há mapa. */
  validas: number | null;
};

/** O andamento do item nas 4 colunas. `ProgressIndicator` a partir de `lg`; abaixo, a barra. Só diz o que o banco tem. */
export function ProgressoPedido({ coluna, estadoPedido, estadoItem, respostas, validas }: Props) {
  const fechado = estadoItem === "confirmado";
  const atual = fechado ? COLUNAS.length : COLUNAS.indexOf(coluna);

  const solicitado =
    estadoPedido === "interpretando" ? "Lendo a cotação" : estadoPedido === "aguardando_confirmacao" ? "Falta confirmar" : estadoItem === "na_fila" ? "Na fila" : "Você confirmou";
  const cotando =
    respostas && respostas.consultados > 0
      ? respostas.respostas === 1
        ? `1 de ${respostas.consultados} respondeu`
        : `${respostas.respostas} de ${respostas.consultados} responderam`
      : estadoItem === "buscando"
        ? "Procurando fornecedores"
        : atual > 1
          ? "Sem proposta nesta rodada"
          : AINDA_NAO;
  const comparando =
    validas !== null
      ? validas === 0
        ? "Nenhuma proposta válida"
        : validas === 1
          ? "1 proposta válida"
          : `${validas} propostas válidas`
      : estadoItem === "comparando"
        ? "Montando o mapa"
        : estadoItem === "aguardando_recompra"
          ? "Falta escolher"
          : AINDA_NAO;
  const decidido =
    estadoItem === "confirmado"
      ? "Fornecedor confirmou o pedido"
      : estadoItem === "pedido_enviado"
        ? "Pedido enviado ao fornecedor"
        : estadoItem === "aprovado"
          ? "Você aprovou"
          : estadoItem === "sem_proposta"
            ? "Sem proposta válida"
            : estadoItem === "aguardando_decisao"
              ? "Falta a sua aprovação"
              : "Só com a sua aprovação";
  const apoio = [solicitado, cotando, comparando, decidido];
  const nome = fechado ? "Compra fechada" : `Etapa: ${ROTULO_COLUNA[coluna]}`;
  return (
    <>
      <div className={s.progressoGrande}>
        <ProgressIndicator currentIndex={atual} spaceEqually>
          {COLUNAS.map((c, i) => (
            <ProgressStep key={c} label={ROTULO_COLUNA[c]} secondaryLabel={apoio[i]} translateWithId={traduzirPasso} />
          ))}
        </ProgressIndicator>
      </div>
      <div className={s.progressoPequeno}>
        <BarraProgresso rotulo={nome} valor={Math.min(atual + 1, COLUNAS.length)} maximo={COLUNAS.length} apoio={apoio[Math.min(atual, COLUNAS.length - 1)]} />
      </div>
    </>
  );
}
