"use client";

import { SkeletonText } from "@carbon/react";
import dynamic from "next/dynamic";
import s from "@/components/comum.module.scss";
import { useSessao } from "@/components/conta/sessao";

// O pacote do chat registra custom elements e usa window: só carrega no navegador.
const Conversa = dynamic(() => import("./Conversa").then((m) => m.Conversa), {
  ssr: false,
  loading: () => (
    <div className={s.esqueletoConversa} aria-hidden="true">
      <SkeletonText paragraph lineCount={3} />
    </div>
  ),
});

/** Conversar com o assistente, no navegador. Cada usuário tem o seu chat; trocar de conta troca a conversa. */
export function ChatWeb() {
  const sessao = useSessao();
  if (!sessao) return null;
  return <Conversa key={sessao.id} endereco={sessao.id} />;
}
