"use client";
// Pedaços que o chat desenha dentro das mensagens: os botões que o assistente mandou e o aviso de envio que falhou.

import { Button, preview__IconIndicator as IconIndicator } from "@carbon/react";
import { ArrowRight } from "@carbon/react/icons";
import { createContext, useContext } from "react";
import { useCelular } from "@/components/useCelular";
import { ehLink, rotaDoLink, useEstadoChat, type Botao } from "./estado";
import s from "./conversa.module.scss";

export type AcoesConversa = {
  /** Toque num botão do assistente: vai como `botao` para enviarChat. */
  tocar: (botao: Botao) => void;
  /** Toque num botão de link: navega para a rota, sem mandar nada ao assistente. */
  abrir: (rota: string) => void;
  /** Manda de novo o envio que falhou. */
  tentarDeNovo: (envioId: string) => void;
};

export const ContextoConversa = createContext<AcoesConversa | null>(null);

/**
 * Botões de uma mensagem do assistente. Os de ação só valem na última mensagem que trouxe botões de ação;
 * os de link valem sempre, em qualquer mensagem e durante um envio, porque só navegam.
 */
export function BotoesDoAssistente({ mensagemId, botoes }: { mensagemId: string; botoes: Botao[] }) {
  const acoes = useContext(ContextoConversa);
  const vale = useEstadoChat((e) => e.ultimaComBotoes === mensagemId);
  const enviando = useEstadoChat((e) => e.enviando > 0);
  const celular = useCelular();
  if (!acoes) return null;
  const tamanho = celular ? "lg" : "sm";
  const acao = vale ? botoes.filter((b) => !ehLink(b)) : [];
  // Rota fora do site vira nada: o botão não aparece.
  const links = botoes.flatMap((b) => {
    const rota = rotaDoLink(b);
    return rota ? [{ botao: b, rota }] : [];
  });
  if (!acao.length && !links.length) return null;
  return (
    <div className={s.botoes}>
      {acao.map((b) => (
        <Button key={b.dado} kind="tertiary" size={tamanho} disabled={enviando} onClick={() => acoes.tocar(b)}>
          {b.rotulo}
        </Button>
      ))}
      {links.map(({ botao, rota }) => (
        <Button key={botao.dado} kind="ghost" size={tamanho} renderIcon={ArrowRight} onClick={() => acoes.abrir(rota)}>
          {botao.rotulo}
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
