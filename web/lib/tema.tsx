"use client";

import { GlobalTheme } from "@carbon/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { ATRIBUTO_TEMA, CHAVE_TEMA, TEMA_CARBON, TEMA_PADRAO, type Tema } from "./tema-base.ts";

export type { Tema } from "./tema-base.ts";

function valido(valor: string | null | undefined): valor is Tema {
  return valor === "claro" || valor === "escuro";
}

const ouvintes = new Set<() => void>();

function lerAtributo(): Tema {
  const atual = document.documentElement.getAttribute(ATRIBUTO_TEMA);
  return valido(atual) ? atual : TEMA_PADRAO;
}

function aplicar(tema: Tema) {
  document.documentElement.setAttribute(ATRIBUTO_TEMA, tema);
  ouvintes.forEach((o) => o());
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

interface ValorTema {
  tema: Tema;
  temaCarbon: (typeof TEMA_CARBON)[Tema];
  escuro: boolean;
  definirTema: (tema: Tema) => void;
  alternarTema: () => void;
}

const Contexto = createContext<ValorTema | null>(null);

export function ProvedorTema({ children }: { children: ReactNode }) {
  const tema = useSyncExternalStore(assinar, lerAtributo, () => TEMA_PADRAO);

  // Outra guia trocou o tema: acompanha.
  useEffect(() => {
    const aoMudar = (e: StorageEvent) => {
      if (e.key !== CHAVE_TEMA) return;
      aplicar(valido(e.newValue) ? e.newValue : TEMA_PADRAO);
    };
    window.addEventListener("storage", aoMudar);
    return () => window.removeEventListener("storage", aoMudar);
  }, []);

  const definirTema = useCallback((novo: Tema) => {
    try {
      window.localStorage.setItem(CHAVE_TEMA, novo);
    } catch {
      // Sem persistência nesta aba: troca só até recarregar.
    }
    aplicar(novo);
  }, []);

  const valor = useMemo<ValorTema>(
    () => ({
      tema,
      temaCarbon: TEMA_CARBON[tema],
      escuro: tema === "escuro",
      definirTema,
      alternarTema: () => definirTema(lerAtributo() === "escuro" ? "claro" : "escuro"),
    }),
    [tema, definirTema],
  );

  return (
    <GlobalTheme theme={valor.temaCarbon}>
      <Contexto.Provider value={valor}>{children}</Contexto.Provider>
    </GlobalTheme>
  );
}

export function useTema(): ValorTema {
  const valor = useContext(Contexto);
  if (!valor) throw new Error("useTema precisa estar dentro de ProvedorTema");
  return valor;
}
