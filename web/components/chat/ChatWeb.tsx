"use client";

import { SkeletonText } from "@carbon/react";
import dynamic from "next/dynamic";
import s from "@/components/comum.module.scss";
import { useSessao } from "@/components/conta/sessao";
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
 * Conversar com o assistente, no navegador: a conversa de quem entrou, com envio (Frente 2: cada
 * usuário tem o seu chat; trocar de conta troca a conversa). Ocupa a altura do elemento pai.
 * `painel` é a versão compacta, para uma coluna lateral.
 */
export function ChatWeb({ modo = "pagina", endereco }: { modo?: ModoConversa; endereco?: string }) {
  const sessao = useSessao();
  if (!sessao) return null;
  // Sem endereço, a conversa principal da pessoa (o endereço é o id do usuário); com ele, uma das "Nova conversa".
  const e = endereco ?? sessao.id;
  return <Conversa key={e} endereco={e} modo={modo} />;
}
