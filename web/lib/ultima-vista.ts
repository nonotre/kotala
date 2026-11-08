"use client";
// Última vista das cotações no Início ("/", "/?canceladas=1" ou "/?vista=lista[&filtro=…]"),
// para o botão voltar da cotação levar de volta a ela.
// Fica só no navegador: é conveniência, não estado do negócio.

import { useEffect } from "react";

const CHAVE = "kotala:ultima-vista";
/** Sem nada guardado, voltar leva ao quadro do Início. */
export const VISTA_PADRAO = "/";

export function lerUltimaVista(): string {
  try {
    const v = localStorage.getItem(CHAVE);
    return v && v.startsWith("/") ? v : VISTA_PADRAO;
  } catch {
    return VISTA_PADRAO;
  }
}

export function guardarUltimaVista(href: string): void {
  try {
    localStorage.setItem(CHAVE, href);
  } catch {
    // Navegador sem armazenamento: voltar cai na vista padrão.
  }
}

/** Use nas telas que são uma vista das cotações: guarda o endereço delas ao abrir. */
export function useGuardaVista(href: string): void {
  useEffect(() => guardarUltimaVista(href), [href]);
}

/** Componente para telas de servidor: `<GuardaVista href="/?vista=lista" />`. */
export function GuardaVista({ href }: { href: string }) {
  useGuardaVista(href);
  return null;
}
