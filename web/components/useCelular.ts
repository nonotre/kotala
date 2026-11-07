"use client";

import { useSyncExternalStore } from "react";

/** O `md` do Carbon: abaixo disto, botões vão em `size="lg"` (alvo de 48 px). */
const CELULAR = "(max-width: 41.98rem)";

function assinar(aviso: () => void) {
  const m = window.matchMedia(CELULAR);
  m.addEventListener("change", aviso);
  return () => m.removeEventListener("change", aviso);
}

/** Abaixo de `md`. No servidor, falso: a casca só mostra a tela depois de hidratar. */
export function useCelular(): boolean {
  return useSyncExternalStore(assinar, () => window.matchMedia(CELULAR).matches, () => false);
}
