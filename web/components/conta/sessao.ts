"use client";
// Frente 2: quem está entrado, como a interface mostra (nome, usuário). É só um espelho no localStorage:
// a autoridade é a sessão do cookie httpOnly, conferida no servidor (proxy.ts e lib/sessao-servidor.ts).
// A casca acerta o espelho com o que o servidor diz a cada carga (Casca.tsx).

import { useSyncExternalStore } from "react";
import { sair as sairNoServidor, type Sessao } from "@/lib/contas";

const CHAVE = "kotala-sessao";
const ouvintes = new Set<() => void>();

/** Cache do texto cru: useSyncExternalStore precisa do mesmo objeto enquanto nada mudou. */
let cru: string | null | undefined;
let atual: Sessao | null = null;

function ler(): Sessao | null {
  let agora: string | null = null;
  try {
    agora = localStorage.getItem(CHAVE);
  } catch {
    agora = null;
  }
  if (agora !== cru) {
    cru = agora;
    try {
      const s = agora ? (JSON.parse(agora) as Sessao) : null;
      atual = s && typeof s.id === "string" && typeof s.nome === "string" ? s : null;
    } catch {
      atual = null;
    }
  }
  return atual;
}

function avisar() {
  ouvintes.forEach((o) => o());
}

function assinar(o: () => void) {
  ouvintes.add(o);
  // Outra aba entrou ou saiu.
  const aoMudar = (e: StorageEvent) => {
    if (e.key === CHAVE) o();
  };
  window.addEventListener("storage", aoMudar);
  return () => {
    ouvintes.delete(o);
    window.removeEventListener("storage", aoMudar);
  };
}

export function guardarSessao(s: Sessao) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(s));
  } catch {
    // Sem armazenamento, a sessão some ao recarregar.
  }
  avisar();
}

/** Só o espelho: o servidor já disse que não há sessão. */
export function esquecerSessao() {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    // Nada a apagar.
  }
  avisar();
}

/** Sair de verdade: apaga a sessão no servidor (e o cookie), o espelho, e recarrega na entrada. */
export async function sair() {
  await sairNoServidor().catch(() => {});
  esquecerSessao();
  // Carga inteira: nada da conta anterior fica na memória da página.
  window.location.assign("/login");
}

/** `undefined` no servidor e antes da hidratação; `null` quando ninguém entrou. */
export function useSessao(): Sessao | null | undefined {
  return useSyncExternalStore(assinar, ler, () => undefined);
}
