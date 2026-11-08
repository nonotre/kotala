"use client";

import { ContentSwitcher, SkeletonText, Switch } from "@carbon/react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import s from "@/components/comum.module.scss";
import { useSessao } from "@/components/conta/sessao";
import { contatosLigados } from "@/lib/contas";
import { EspelhoTelegram } from "./EspelhoTelegram";
import c from "./conversa.module.scss";

// O pacote do chat registra custom elements e usa window: só carrega no navegador.
const Conversa = dynamic(() => import("./Conversa").then((m) => m.Conversa), {
  ssr: false,
  loading: () => (
    <div className={s.esqueletoConversa} aria-hidden="true">
      <SkeletonText paragraph lineCount={3} />
    </div>
  ),
});

type Vista = "site" | "telegram";
const VISTAS: Vista[] = ["site", "telegram"];

/**
 * Conversar com o assistente, no navegador. Cada usuário tem o seu chat; trocar de conta troca a conversa.
 * Quem tem Telegram ligado também vê o espelho do Telegram, só para ler (Frente 2).
 */
export function ChatWeb({ linkTelegram = null }: { linkTelegram?: string | null }) {
  const sessao = useSessao();
  const [temTelegram, setTemTelegram] = useState(false);
  const [vista, setVista] = useState<Vista>("site");

  useEffect(() => {
    if (!sessao) return;
    let vivo = true;
    contatosLigados(sessao.id)
      .then((l) => vivo && setTemTelegram(l.some((x) => x.canal === "telegram" && x.papel === "comprador")))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [sessao]);

  if (!sessao) return null;
  const topo = temTelegram ? (
    <div className={c.trocaCanal}>
      <ContentSwitcher size="sm" selectedIndex={VISTAS.indexOf(vista)} onChange={({ index }) => setVista(VISTAS[index ?? 0] ?? "site")}>
        <Switch name="site" text="Chat do site" />
        <Switch name="telegram" text="Espelho do Telegram" />
      </ContentSwitcher>
    </div>
  ) : undefined;
  if (temTelegram && vista === "telegram") return <EspelhoTelegram usuarioId={sessao.id} linkTelegram={linkTelegram} topo={topo} />;
  return <Conversa key={sessao.id} endereco={sessao.id} topo={topo} />;
}
