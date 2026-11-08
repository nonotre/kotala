"use client";

import Link from "next/link";
import { Button } from "@carbon/react";
import s from "../telegram.module.scss";

/** O chat não abriu (banco fora, por exemplo): sem o erro na tela, com como seguir. */
export default function ErroDoChat({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main id="conteudo" className={s.tela}>
      <div className={s.faixa} role="note">
        <span>
          <span className={s.faixaTitulo}>Telegram simulado</span> — Nada aqui vai para um Telegram de verdade.
        </span>
      </div>
      <div className={s.naoEncontrado}>
        <h1 className={s.naoEncontradoTitulo}>Não deu para abrir este chat agora</h1>
        <p>Nada se perdeu: as mensagens continuam guardadas.</p>
        <Button kind="primary" size="md" onClick={retry}>
          Tentar de novo
        </Button>
        <Link href="/telegram-simulado">Ver todos os chats simulados</Link>
      </div>
    </main>
  );
}
