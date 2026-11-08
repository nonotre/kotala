// Preços fictícios do simulador, por categoria (catalogo.json). As categorias são as
// de src/dominio/categorias.json: o item que não está na lista de preços recebe o
// preço sintético da categoria que o domínio detectar, em vez de ser recusado.

import catalogoJson from "./catalogo.json" with { type: "json" };
import { detectarCategoria, semAcento } from "../dominio/categorias.ts";

export type ItemCatalogo = { categoria: string; palavras: string[]; unidade: string; preco: number; equivalente: string };
export type Conversao = { /** Regex da unidade pedida. */ unidade: string; /** Unidade do preço. */ de: string; fator: number };
export type DadosCategoria = {
  /** Onde a persona diz que entrega ("aí na obra", "no escritório"). */
  entrega: string;
  /** Frete "até a obra" ou "até o endereço". */
  freteAte: string;
  conversoes?: Conversao[];
  precoSintetico: { unidade: string; preco: number };
};

const dados = catalogoJson as unknown as {
  itens: ItemCatalogo[];
  categorias: Record<string, DadosCategoria>;
};

/** Lista de preços por item, na ordem de procura. */
export const CATALOGO: readonly ItemCatalogo[] = dados.itens;
export const CATEGORIAS_SIM: Readonly<Record<string, DadosCategoria>> = dados.categorias;

/** Categorias de obra (as personas de construção só vendem itens destas). */
export const CATEGORIAS_OBRA = ["agregados", "cimenticios", "aco", "alvenaria", "ferragens", "hidraulica", "eletrico", "isolamento", "tintas", "madeira"] as const;

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const regexes = new Map<string, RegExp>();
/** A palavra começa uma palavra do texto ("vergalh" em "vergalhão", mas "ari" não em "sanitária"). */
function comeca(texto: string, palavra: string) {
  let r = regexes.get(palavra);
  if (!r) regexes.set(palavra, (r = new RegExp(`(?<![a-z0-9])${escapar(semAcento(palavra))}`)));
  return r.test(texto);
}

/** Item da lista de preços que bate com a descrição (o primeiro, na ordem do arquivo). */
export function itemDoCatalogo(descricao: string): ItemCatalogo | null {
  const d = semAcento(descricao);
  return CATALOGO.find((c) => c.palavras.some((p) => comeca(d, p))) ?? null;
}

/** Categoria do item para o simulador: a do item da lista; senão, a que o domínio detecta ("geral" se nada bate). */
export function categoriaSim(descricao: string): string {
  return itemDoCatalogo(descricao)?.categoria ?? detectarCategoria(descricao).id;
}

export function dadosDaCategoria(id: string): DadosCategoria {
  return CATEGORIAS_SIM[id] ?? CATEGORIAS_SIM.geral!;
}

/** Fator de conversão da unidade do preço para a unidade pedida (carrada = 6 m³, milheiro = 1000 unidades). */
export function fatorDeUnidade(categoria: string, unidadePreco: string, unidadePedida: string): number {
  for (const c of dadosDaCategoria(categoria).conversoes ?? []) {
    if (c.de === unidadePreco && new RegExp(c.unidade, "i").test(unidadePedida)) return c.fator;
    // O inverso: preço do milheiro (ou da carrada) e pedido em unidades (ou m³).
    if (new RegExp(c.unidade, "i").test(unidadePreco) && unidadePedida.toLowerCase().startsWith(c.de.toLowerCase())) return 1 / c.fator;
  }
  return 1;
}
