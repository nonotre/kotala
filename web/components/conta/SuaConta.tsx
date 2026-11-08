"use client";
// Frente 2: quem entrou e os canais ligados à conta (o Telegram, ligado à mão; o chat web, sempre).

import { Tag } from "@carbon/react";
import { useEffect, useState } from "react";
import { Bloco } from "@/components/Bloco";
import { contatosLigados, type ContatoLigado } from "@/lib/contas";
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

export function SuaConta() {
  const sessao = useSessao();
  const [contatos, setContatos] = useState<ContatoLigado[] | null>(null);

  useEffect(() => {
    if (!sessao) return;
    let vivo = true;
    contatosLigados(sessao.id)
      .then((l) => vivo && setContatos(l))
      .catch(() => vivo && setContatos([]));
    return () => {
      vivo = false;
    };
  }, [sessao]);

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
              {contatos.map((c) => (
                <Tag key={`${c.canal}-${c.papel}`} type={c.canal === "telegram" ? "blue" : "gray"} size="sm">
                  {rotulo(c)}
                </Tag>
              ))}
              {!telegram ? " Telegram ainda não ligado." : null}
            </span>
          )}
        </Campo>
      </dl>
    </Bloco>
  );
}
