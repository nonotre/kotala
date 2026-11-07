"use client";

import { InlineLoading, Layer, preview__IconIndicator as IconIndicator } from "@carbon/react";
import { usePathname } from "next/navigation";
import { BarraAcao } from "@/components/BarraAcao";
import { BotaoLink } from "./BotaoLink";
import type { ProximoPasso, Quem } from "./textos";
import s from "./pedido.module.scss";

const ICONE: Record<Exclude<Quem, "sistema">, "informative" | "pending" | "succeeded"> = { comprador: "informative", fornecedor: "pending", fim: "succeeded" };

/** O ícone diz de quem é a vez; o texto ao lado diz o quê. Etapa do assistente em andamento mostra o carregamento. */
function IconeDaVez({ quem }: { quem: Quem }) {
  if (quem === "sistema") {
    return (
      <span className={s.faixaIcone}>
        <InlineLoading status="active" iconDescription="Em andamento" />
      </span>
    );
  }
  return (
    <span className={s.faixaIcone} aria-hidden="true">
      <IconIndicator kind={ICONE[quem]} label="" size={20} />
    </span>
  );
}

/**
 * A faixa que sempre diz o que falta no pedido. Presa abaixo do Header a partir de `lg`;
 * abaixo disso, o botão vai para a barra do pé. Na aba de destino, o botão some: a ação já está na tela.
 */
export function FaixaProximoPasso({ passo }: { passo: ProximoPasso }) {
  const rota = usePathname();
  const destino = passo.botao?.href.split("#")[0];
  const botao = passo.botao && destino !== rota ? passo.botao : null;
  const rotulo = passo.quem === "fim" ? null : passo.quem === "comprador" ? "O que falta agora" : "Agora";
  const tipo = passo.quem === "comprador" ? "primary" : "secondary";
  return (
    <>
      <Layer as="section" aria-label="O que falta agora" className={s.faixa}>
        <IconeDaVez quem={passo.quem} />
        <p className={s.faixaTexto} role="status">
          {rotulo ? <span className={s.faixaRotulo}>{rotulo} </span> : null}
          <span className={s.faixaFrase}>{passo.texto}</span>
        </p>
        {botao ? (
          <div className={s.faixaBotao}>
            <BotaoLink href={botao.href} kind={tipo}>
              {botao.texto}
            </BotaoLink>
          </div>
        ) : null}
      </Layer>
      {botao ? (
        <BarraAcao>
          <BotaoLink href={botao.href} kind={tipo} size="lg">
            {botao.texto}
          </BotaoLink>
        </BarraAcao>
      ) : null}
    </>
  );
}
