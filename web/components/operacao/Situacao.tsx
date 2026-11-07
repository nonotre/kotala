"use client";
// Peças comuns das telas de operação: etapa, situação, urgência, fornecedor e a troca Quadro | Lista.

import { ContentSwitcher, Switch, preview__IconIndicator as IconIndicator } from "@carbon/react";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { SeloSimulado } from "@/components/SeloSimulado";
import type { Coluna, Etiqueta } from "@/lib/dados";
import c from "../comum.module.scss";
import s from "./operacao.module.scss";

type Kind = NonNullable<ComponentProps<typeof IconIndicator>["kind"]>;

const KIND_ETAPA: Record<Coluna, Kind> = {
  Solicitado: "not-started",
  Cotando: "in-progress",
  Comparando: "pending",
  Decidido: "succeeded",
};

/** Um mapa só: a mesma etiqueta tem o mesmo ícone em toda tela. */
function kindDa(e: Etiqueta): Kind {
  if (e.tipo === "atencao") return e.texto === "Em negociação" ? "in-progress" : "informative";
  if (e.tipo === "alerta") return e.texto.startsWith("Sem proposta") ? "incomplete" : "caution-minor";
  if (e.tipo === "ok") return e.texto.startsWith("Pedido enviado") ? "in-progress" : "succeeded";
  if (e.texto === "Na fila") return "not-started";
  if (e.texto === "Cancelado") return "undefined";
  if (e.texto.startsWith("Fecha às")) return "pending";
  if (e.texto.startsWith("Rodada")) return "normal";
  return "in-progress";
}

/** Coluna do quadro em que o item está. */
export function EtapaIndicador({ coluna, tamanho = 16 }: { coluna: Coluna; tamanho?: 16 | 20 }) {
  return <IconIndicator kind={KIND_ETAPA[coluna]} label={coluna} size={tamanho} />;
}

/** As etiquetas do quadro como indicador com ícone e texto. Urgência fica de fora: vai em `Urgencia`. */
export function Situacao({ lista, sem = [] }: { lista: Etiqueta[]; sem?: string[] }) {
  const visiveis = lista.filter((e) => e.tipo !== "urgente" && !sem.includes(e.texto));
  if (!visiveis.length) return null;
  return (
    <span className={c.etiquetas}>
      {visiveis.map((e) => (
        <IconIndicator key={e.texto} kind={kindDa(e)} label={e.texto} size={16} />
      ))}
    </span>
  );
}

const TEXTO_URGENCIA: Record<string, string> = { obra_parada: "Obra parada", urgente: "Urgente" };

/** Urgência alta, em vermelho e por escrito. Normal não mostra nada. */
export function Urgencia({ urgencia }: { urgencia: string }) {
  const texto = TEXTO_URGENCIA[urgencia];
  return texto ? <span className={c.obraParada}>{texto}</span> : null;
}

/** Urgência a partir das etiquetas do quadro, que já trazem "Obra parada" ou "Urgente". */
export function UrgenciaDasEtiquetas({ lista }: { lista: Etiqueta[] }) {
  const e = lista.find((x) => x.tipo === "urgente");
  return e ? <span className={c.obraParada}>{e.texto}</span> : null;
}

/** Nome do fornecedor, com o selo quando é simulado. */
export function NomeFornecedor({ nome, simulado }: { nome: string; simulado: boolean }) {
  return (
    <span className={c.fornecedor}>
      <span>{nome}</span>
      {simulado ? <SeloSimulado /> : null}
    </span>
  );
}

/** Os mesmos pedidos, em quadro ou em lista. */
export function VistaPedidos({ atual }: { atual: "quadro" | "lista" }) {
  const router = useRouter();
  return (
    <ContentSwitcher
      size="md"
      className={s.vista}
      selectedIndex={atual === "quadro" ? 0 : 1}
      aria-label="Forma de ver os pedidos"
      onChange={({ name }) => {
        if (name === "quadro" && atual !== "quadro") router.push("/quadro");
        if (name === "lista" && atual !== "lista") router.push("/pedidos");
      }}
    >
      <Switch name="quadro" text="Quadro" />
      <Switch name="lista" text="Lista" />
    </ContentSwitcher>
  );
}
