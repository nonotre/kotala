"use client";
// Frente 2: quem entrou e os canais ligados à conta (o chat web, sempre; o Telegram, pelo /vincular).

import { Button, InlineNotification, Tag } from "@carbon/react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Bloco } from "@/components/Bloco";
import { contatosLigados, gerarCodigoTelegram, type ContatoLigado } from "@/lib/contas";
import { Campo } from "./Comum";
import { useSessao } from "./sessao";
import s from "./conta.module.scss";

const NOME_CANAL: Record<string, string> = { telegram: "Telegram", whatsapp: "WhatsApp", email: "E-mail", web: "Chat no navegador", voz: "Voz", simulado: "Simulado" };

function rotulo(c: ContatoLigado): string {
  const canal = NOME_CANAL[c.canal] ?? c.canal;
  if (c.canal === "web") return canal;
  const bot = c.papel === "fornecedor" ? "bot do fornecedor" : "bot do comprador";
  return `${canal}, ${bot}${c.nome ? ` (${c.nome})` : ""}`;
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** O código para mandar ao bot do comprador. Gera na hora; vale 15 minutos e uma vez. */
function LigarTelegram({ ligado, aoLigar }: { ligado: boolean; aoLigar: () => void }) {
  const [codigo, setCodigo] = useState<{ codigo: string; expiraEm: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, iniciar] = useTransition();

  // Com o código na tela, confere de tempos em tempos se o bot já ligou o chat.
  useEffect(() => {
    if (!codigo) return;
    const t = setInterval(aoLigar, 4000);
    return () => clearInterval(t);
  }, [codigo, aoLigar]);

  const gerar = () =>
    iniciar(async () => {
      setErro(null);
      const r = await gerarCodigoTelegram();
      if (r.ok) setCodigo({ codigo: r.codigo, expiraEm: r.expiraEm });
      else setErro(r.erro);
    });

  return (
    <div className={s.vincular}>
      <p className={s.apoioLinha}>
        {ligado
          ? "Para ligar outro Telegram (ou de novo), gere um código e mande ao bot do comprador."
          : "Ligue o seu Telegram para os pedidos feitos por lá aparecerem com o seu nome."}
      </p>
      {codigo ? (
        <div className={s.vincularCodigo} aria-live="polite">
          <p>
            Mande ao bot do comprador: <code className={s.codigo}>/vincular {codigo.codigo}</code>
          </p>
          <p className={s.apoioLinha}>Vale até {hora(codigo.expiraEm)} e só uma vez. Gerar outro invalida este.</p>
        </div>
      ) : null}
      {erro ? <InlineNotification kind="error" lowContrast hideCloseButton title={erro} /> : null}
      <div>
        <Button kind="tertiary" size="sm" onClick={gerar} disabled={gerando}>
          {codigo ? "Gerar outro código" : "Gerar código para o Telegram"}
        </Button>
      </div>
    </div>
  );
}

export function SuaConta() {
  const sessao = useSessao();
  const [contatos, setContatos] = useState<ContatoLigado[] | null>(null);

  const carregar = useCallback(() => {
    contatosLigados()
      .then(setContatos)
      .catch(() => setContatos((atual) => atual ?? []));
  }, []);

  useEffect(() => {
    if (sessao) carregar();
  }, [sessao, carregar]);

  if (!sessao) return null;
  const telegram = contatos?.some((c) => c.canal === "telegram") ?? false;

  return (
    <Bloco titulo="Sua conta" descricao="Os pedidos feitos pelos canais ligados aqui aparecem com o seu nome.">
      <dl className={s.campos}>
        <Campo rotulo="Nome">{sessao.nome}</Campo>
        <Campo rotulo="Usuário">{sessao.login}</Campo>
        <Campo rotulo="Canais ligados" largo>
          {contatos === null ? (
            "Carregando…"
          ) : (
            <span className={s.apoioLinha}>
              {/* Cada "Nova conversa" é um contato web: o canal aparece uma vez só. */}
              {[...new Map(contatos.map((c) => [rotulo(c), c])).entries()].map(([texto, c]) => (
                <Tag key={texto} type={c.canal === "telegram" ? "blue" : "gray"} size="sm">
                  {texto}
                </Tag>
              ))}
              {!telegram ? " Telegram ainda não ligado." : null}
            </span>
          )}
        </Campo>
        <Campo rotulo="Telegram" largo>
          <LigarTelegram ligado={telegram} aoLigar={carregar} />
        </Campo>
      </dl>
    </Bloco>
  );
}
