"use client";
// Pedaços que o chat desenha dentro das mensagens: os botões que o assistente mandou e o aviso de envio que falhou.

import { Button, preview__IconIndicator as IconIndicator } from "@carbon/react";
import { createContext, useContext } from "react";
import { useCelular } from "@/components/useCelular";
import { useEstadoChat, type Botao } from "./estado";
import s from "./conversa.module.scss";

export type AcoesConversa = {
  /** Toque num botão do assistente: vai como `botao` para enviarChat. */
  tocar: (botao: Botao) => void;
  /** Manda de novo o envio que falhou. */
  tentarDeNovo: (envioId: string) => void;
};

export const ContextoConversa = createContext<AcoesConversa | null>(null);

/** Botões de uma mensagem do assistente. Só valem na última mensagem que trouxe botões. */
export function BotoesDoAssistente({ mensagemId, botoes }: { mensagemId: string; botoes: Botao[] }) {
  const acoes = useContext(ContextoConversa);
  const vale = useEstadoChat((e) => e.ultimaComBotoes === mensagemId);
  const enviando = useEstadoChat((e) => e.enviando > 0);
  const celular = useCelular();
  if (!vale || !acoes || !botoes.length) return null;
  return (
    <div className={s.botoes}>
      {botoes.map((b) => (
        <Button key={b.dado} kind="tertiary" size={celular ? "lg" : "sm"} disabled={enviando} onClick={() => acoes.tocar(b)}>
          {b.rotulo}
        </Button>
      ))}
    </div>
  );
}

/** Abaixo da mensagem do comprador, quando o envio não deu certo. */
export function RodapeEnvio({ id }: { id: string }) {
  const falha = useEstadoChat((e) => e.falhas[id]);
  const acoes = useContext(ContextoConversa);
  if (!falha) return null;
  return (
    <div className={s.rodapeEnvio} role="status">
      <IconIndicator kind="failed" size={16} label={falha.podeTentar ? "Não enviada" : "Sem resposta"} />
      <span className={s.rodapeErro}>{falha.erro}</span>
      {falha.podeTentar && acoes ? (
        <button type="button" className={s.linkBotao} onClick={() => acoes.tentarDeNovo(id)}>
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}
