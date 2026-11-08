"use client";

import { SkeletonText } from "@carbon/react";
import dynamic from "next/dynamic";
import s from "@/components/comum.module.scss";
import type { ModoConversa } from "./Conversa";

// O pacote do chat registra custom elements e usa window: só carrega no navegador.
const Conversa = dynamic(() => import("./Conversa").then((m) => m.Conversa), {
  ssr: false,
  loading: () => (
    <div className={s.esqueletoConversa} aria-hidden="true">
      <SkeletonText paragraph lineCount={3} />
    </div>
  ),
});

/**
 * Conversar com o assistente, no navegador: a conversa deste navegador, com envio.
 * Ocupa a altura do elemento pai. `painel` é a versão compacta, para uma coluna lateral.
 */
export function ChatWeb({ modo = "pagina" }: { modo?: ModoConversa }) {
  return <Conversa modo={modo} />;
}
