// Jargão de compras que o Interpretador precisa reconhecer. Vai no prompt como
// referência; não é uma lista fechada. Os termos moram em src/dominio/categorias.json,
// por categoria: entra o jargão geral mais o das categorias pedidas.

import { categoriaPorId, categoriasDoNicho, categorias, type Categoria } from "../../dominio/categorias.ts";

export type Jargao = { termo: string; significa: string };

/** Teto de caracteres do bloco no prompt (o mesmo tamanho que o jargão de obra tinha). */
const LIMITE = 1700;

/**
 * @param das categorias (ids ou objetos) cujo jargão entra; sem parâmetro, as do nicho da empresa
 * (EMPRESA_NICHO) e, se sobrar espaço, as demais.
 */
export function jargaoDas(das?: (Categoria | string)[]): Jargao[] {
  const pedidas = (das ?? categoriasDoNicho()).map((c) => (typeof c === "string" ? categoriaPorId(c) : c)).filter((c): c is Categoria => !!c);
  const ordem = das ? [categoriaPorId("geral")!, ...pedidas] : [categoriaPorId("geral")!, ...pedidas, ...categorias()];
  return [...new Set(ordem)].flatMap((c) => c.jargao ?? []);
}

export function textoJargao(das?: (Categoria | string)[]): string {
  const linhas: string[] = [];
  let tam = 0;
  for (const j of jargaoDas(das)) {
    const l = `- ${j.termo}: ${j.significa}`;
    if (tam + l.length > LIMITE) continue;
    linhas.push(l);
    tam += l.length + 1;
  }
  return linhas.join("\n");
}
