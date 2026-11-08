// T2: /telegram-simulado, todos os chats dos fornecedores simulados. Cada chat existe
// mesmo sem ninguém abrir: é a conversa que o sistema já teve com a persona.

import { Tag } from "@carbon/react";
import type { Metadata } from "next";
import Link from "next/link";
import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { listaChatsSimulados } from "@/lib/dados-simulado";
import s from "./telegram.module.scss";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Telegram simulado" };

const FUSO = "America/Sao_Paulo";

/** Hoje, só a hora; antes, o dia, como na lista do Telegram. */
function quando(d: Date): string {
  const dia = (x: Date) => x.toLocaleDateString("pt-BR", { timeZone: FUSO });
  if (dia(d) === dia(new Date())) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: FUSO });
}

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter((p) => /^\p{L}/u.test(p))
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

export default async function ChatsSimulados() {
  const chats = await listaChatsSimulados();
  return (
    <main id="conteudo" className={s.tela}>
      <AtualizaSozinho segundos={5} />
      <div className={s.faixa} role="note">
        <span>
          <span className={s.faixaTitulo}>Telegram simulado</span> — Conversas do sistema com os fornecedores simulados. Nada aqui vai para um Telegram de verdade.
        </span>
      </div>
      <div className={s.chats}>
        <h1 className={s.titulo}>Chats simulados</h1>
        <p className={s.tituloAjuda}>Abra um chat para ser aquele fornecedor: responder às cotações, tocar nos botões ou deixar a persona responder sozinha.</p>
        {chats.length === 0 ? (
          <p className={s.tituloAjuda}>Nenhum fornecedor simulado tem chat ainda. O chat aparece quando o sistema manda a primeira mensagem a ele.</p>
        ) : (
          <ul className={s.chatsLista}>
            {chats.map((c) => (
              <li key={c.id}>
                <Link href={`/telegram-simulado/${c.id}`} className={s.chat}>
                  <span className={s.avatar} aria-hidden="true">
                    {iniciais(c.nome)}
                  </span>
                  <span className={s.chatMeio}>
                    <span className={s.chatLinha}>
                      <span className={s.nome}>{c.nome}</span>
                      {c.ultima ? <time className={s.chatHora} dateTime={c.ultima.criadoEm.toISOString()}>{quando(c.ultima.criadoEm)}</time> : null}
                    </span>
                    <span className={s.chatLinha}>
                      <span className={s.chatPrevia}>
                        {c.ultima ? `${c.ultima.direcao === "entrada" ? "Você: " : ""}${c.ultima.texto || (c.ultima.direcao === "entrada" ? "(tocou num botão)" : "")}` : "Sem mensagens"}
                      </span>
                      <Tag type={c.automatico ? "green" : "purple"} size="sm">
                        {c.automatico ? "Automático" : "Você assumiu"}
                      </Tag>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
