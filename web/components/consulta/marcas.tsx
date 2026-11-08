"use client";
// Marcas comuns à lista e à ficha do fornecedor: confiança e canal, sempre com ícone e texto.

import { preview__IconIndicator as IconIndicator } from "@carbon/react";
import type { ComponentProps } from "react";
import type { Verificacao } from "@/lib/dados-consulta";
import s from "./consulta.module.scss";

export type Kind = ComponentProps<typeof IconIndicator>["kind"];

const NIVEL: Record<string, { kind: Kind; rotulo: string; peso: number }> = {
  alta: { kind: "succeeded", rotulo: "Alta", peso: 0 },
  media: { kind: "caution-minor", rotulo: "Média", peso: 1 },
  baixa: { kind: "caution-major", rotulo: "Baixa", peso: 2 },
};

export const ROTULO_CANAL: Record<string, string> = { telegram: "Telegram", whatsapp: "WhatsApp", email: "E-mail", web: "Chat web", voz: "Voz", simulado: "Canal simulado" };

/** Canal como lib/dados devolve ("telegram (parou)"), em português. */
export function canalEmTexto(c: string): string {
  const [nome, resto] = c.split(" ");
  return `${ROTULO_CANAL[nome ?? ""] ?? nome}${resto ? ` ${resto}` : ""}`;
}

/** Para ordenar: alta, média, baixa, sem verificação e, por fim, simulado. */
export function pesoConfianca(simulado: boolean, v: Verificacao | null): number {
  if (simulado) return 5;
  return v?.nivel && NIVEL[v.nivel] ? NIVEL[v.nivel]!.peso : 4;
}

/** Simulado não tem o que conferir: a tela diz isso em palavras. */
export function Confianca({ simulado, verificacao }: { simulado: boolean; verificacao: Verificacao | null }) {
  if (simulado) return <span className={s.semValor}>Não se aplica: simulado</span>;
  const n = verificacao?.nivel ? NIVEL[verificacao.nivel] : undefined;
  if (!n) return <IconIndicator kind="not-started" label="Ainda não verificado" size={16} />;
  return <IconIndicator kind={n.kind} label={`${n.rotulo}${verificacao?.pontos !== undefined ? ` · ${verificacao.pontos} pontos` : ""}`} size={16} />;
}

export type EstadoCanal = { kind: Kind; rotulo: string; apoio: string; peso: number };

/** Pesos de `estadoDoCanal`, na ordem da tabela. Sem conversa aberta: e-mail, site próprio e sem canal. */
export const PESO_CANAL = { ativo: 0, email: 1, site: 2, nenhum: 3, parou: 4, pediuParar: 5, bloqueado: 6 } as const;

/** Endereço do site sem o protocolo, ou null quando a fonte não é um site. */
function dominio(fonte: string | null | undefined): string | null {
  return fonte?.startsWith("http") ? fonte.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
}

/**
 * O que importa para cotar: dá para mandar mensagem, ou não, e por quê.
 * "Sem canal" só quando não há forma nenhuma de contato: nem conversa, nem e-mail, nem site.
 */
export function estadoDoCanal(f: { bloqueadoEm: string | null; parouEm: string | null; canais: string[]; canaisAtivos: number; email?: string | null; fonte?: string | null }): EstadoCanal {
  const lista = f.canais.map(canalEmTexto).join(", ");
  const site = dominio(f.fonte);
  if (f.bloqueadoEm) return { kind: "failed", rotulo: "Bloqueado", apoio: lista || "Não entra em busca nem recompra", peso: PESO_CANAL.bloqueado };
  if (f.parouEm) return { kind: "failed", rotulo: "Pediu para parar", apoio: "Não recebe mais nada, em nenhum canal", peso: PESO_CANAL.pediuParar };
  if (f.canaisAtivos > 0) {
    const ativos = f.canais.filter((c) => !c.endsWith("(parou)")).map(canalEmTexto).join(", ");
    return { kind: "succeeded", rotulo: ativos, apoio: "Recebe as cotações", peso: PESO_CANAL.ativo };
  }
  if (f.canais.length) return { kind: "failed", rotulo: "Parou", apoio: lista, peso: PESO_CANAL.parou };
  if (f.email) return { kind: "pending", rotulo: "E-mail", apoio: "Recebe o convite; ainda não entrou", peso: PESO_CANAL.email };
  if (site) return { kind: "not-started", rotulo: "Site próprio", apoio: `${site} · só referência de preço`, peso: PESO_CANAL.site };
  return { kind: "not-started", rotulo: "Sem canal", apoio: "Nenhum contato conhecido", peso: PESO_CANAL.nenhum };
}

export function Canal({ estado }: { estado: EstadoCanal }) {
  return (
    <span className={s.duasLinhas}>
      <IconIndicator kind={estado.kind} label={estado.rotulo} size={16} />
      <span className={s.apoioRecuado}>{estado.apoio}</span>
    </span>
  );
}
