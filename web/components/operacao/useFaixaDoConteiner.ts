"use client";
// A largura do próprio contêiner, e não a da janela: no Início, a lista divide a tela com o menu e as conversas.

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Em que faixa de largura o elemento está: 0 abaixo do primeiro limite, 1 a partir dele, e assim por diante.
 * Os limites vão em rem, em ordem crescente, para acompanhar o tamanho de letra de quem lê.
 * `null` até medir: no servidor e na hidratação não há largura, e quem chama reserva o lugar.
 * Só muda ao cruzar um limite: arrastar a janela não redesenha a lista a cada pixel.
 */
export function useFaixaDoConteiner(ref: RefObject<HTMLElement | null>, limites: readonly number[]): number | null {
  const [faixa, setFaixa] = useState<number | null>(null);
  const chave = limites.join(",");

  // Antes de pintar: quem chega pela navegação do app já vê a lista na forma certa.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const emRem = chave.split(",").map(Number);
    const medir = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const largura = el.getBoundingClientRect().width / rem;
      setFaixa(emRem.filter((l) => largura >= l).length);
    };
    medir();
    const vigia = new ResizeObserver(medir);
    vigia.observe(el);
    return () => vigia.disconnect();
  }, [ref, chave]);

  return faixa;
}
