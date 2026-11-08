"use client";
// Frente 2: espelho do Telegram do usuário, só para ler. Não há campo de envio:
// para responder, o botão leva ao bot no Telegram.

import { Button, InlineNotification, SkeletonText } from "@carbon/react";
import { Launch } from "@carbon/react/icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MensagemChat } from "./estado";
import s from "./conversa.module.scss";

const INTERVALO_MS = 4000;

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

function textoDaMensagem(m: MensagemChat): string {
  const anexos = (m.anexos ?? []).map((a) => `📎 ${a.nome ?? a.tipo}`).join("\n");
  if (m.texto) return anexos ? `${m.texto}\n${anexos}` : m.texto;
  if (anexos) return anexos;
  return m.direcao === "entrada" ? "(tocou num botão)" : "";
}

export function EspelhoTelegram({ usuarioId, linkTelegram, topo }: { usuarioId: string; linkTelegram: string | null; topo?: ReactNode }) {
  const [msgs, setMsgs] = useState<MensagemChat[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const total = useRef(0);

  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      try {
        const r = await fetch(`/api/chat?endereco=${usuarioId}&canal=telegram`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const lista = (await r.json()) as MensagemChat[];
        if (!vivo) return;
        setMsgs(lista);
        setFalhou(false);
      } catch {
        if (vivo) setFalhou(true);
      }
    };
    void ler();
    const t = setInterval(ler, INTERVALO_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [usuarioId]);

  // Chegou mensagem nova: desce até ela.
  useEffect(() => {
    if (!msgs || msgs.length === total.current) return;
    total.current = msgs.length;
    fim.current?.scrollIntoView({ block: "end" });
  }, [msgs]);

  const visiveis = (msgs ?? []).filter((m) => textoDaMensagem(m));

  return (
    <div className={s.tela}>
      <h1 className={s.tituloOculto}>Espelho do Telegram</h1>
      {topo}
      <div className={s.espelhoLista} aria-live="polite">
        {falhou ? <InlineNotification kind="warning" lowContrast hideCloseButton title="Não deu para ler o Telegram agora. Tentando de novo." /> : null}
        {msgs === null ? (
          <SkeletonText paragraph lineCount={4} />
        ) : visiveis.length === 0 ? (
          <p className={s.espelhoVazio}>Nenhuma mensagem no Telegram ainda.</p>
        ) : (
          visiveis.map((m) => (
            <div key={m.id} className={m.direcao === "entrada" ? s.espelhoVoce : s.espelhoAssistente}>
              <p className={s.espelhoQuem}>
                {m.direcao === "entrada" ? "Você" : "Assistente"} · {hora(m.criadoEm)}
              </p>
              <p className={s.espelhoTexto}>{textoDaMensagem(m)}</p>
              {m.botoes?.length ? (
                <p className={s.espelhoBotoes}>{m.botoes.map((b) => `[${b.rotulo}]`).join("  ")}</p>
              ) : null}
            </div>
          ))
        )}
        <div ref={fim} />
      </div>
      <div className={s.espelhoRodape}>
        <p className={s.espelhoAviso}>Só leitura. Para responder, continue no Telegram.</p>
        {linkTelegram ? (
          <Button href={linkTelegram} target="_blank" rel="noreferrer" renderIcon={Launch} size="md">
            Continuar no Telegram
          </Button>
        ) : null}
      </div>
    </div>
  );
}
