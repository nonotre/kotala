"use client";
// Frente 2: quem está entrado neste navegador. Fica só no localStorage, sem cookie:
// o login não tem pretensão de segurança, serve para separar as pessoas e os chats.

import { useSyncExternalStore } from "react";
import type { Sessao } from "@/lib/contas";

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

export function sair() {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    // Nada a apagar.
  }
  avisar();
}

/** `undefined` no servidor e antes da hidratação; `null` quando ninguém entrou. */
export function useSessao(): Sessao | null | undefined {
  return useSyncExternalStore(assinar, ler, () => undefined);
}
