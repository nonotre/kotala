// E6: base de itens com especificação técnica (base fictícia feita pela Ester).
// Casa o item que o Interpretador leu com a base, sem IA:
// - família: as palavras do nome, com sinônimos da categoria;
// - termos decisivos: números e classes (50 mm, 4 mm², CP II), que têm de bater.
// Uma correspondência: o item ganha código e especificação. Várias: o comprador
// escolhe por botão. Nenhuma: o texto solto continua valendo.

import { readFileSync } from "node:fs";
import { palavrasVazias, sinonimosDeBusca } from "../../dominio/categorias.ts";

export type ItemBase = {
  id: string;
  descricao: string;
  especificacao_tecnica: Record<string, string | number>;
  unidade_compra: string;
  categoria: string;
};

const ARQUIVO = new URL("../../dados/itens.json", import.meta.url);
let cache: ItemBase[] | null = null;
/** Itens cadastrados pelo agente (tabela item_catalogo), carregados por carregarCatalogo(). */
let cadastrados: ItemBase[] = [];

/** Base fixa (fictícia, da Ester) mais os itens que o agente cadastrou. */
export function baseDeItens(): ItemBase[] {
  cache ??= (JSON.parse(readFileSync(ARQUIVO, "utf8")) as { itens: ItemBase[] }).itens;
  return cadastrados.length ? [...cache, ...cadastrados] : cache;
}

export function definirCadastrados(itens: ItemBase[]) {
  cadastrados = itens;
}

/** Palavras que não dizem nada sobre o produto e sinônimos: dados por categoria, em src/dominio/. */
const VAZIAS = palavrasVazias();
const SINONIMOS = sinonimosDeBusca();

const normal = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Separa número de letra ("50kg" → 50 kg; "2,5" → 2.5). */
export function palavras(s: string): string[] {
  return normal(s)
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .split(/[^a-z0-9.]+/)
    .map((p) => p.replace(/^\.+|\.+$/g, ""))
    .filter((p) => p && !VAZIAS.has(p));
}

const decisiva = (p: string) => /\d/.test(p) || /^(i|ii|iii|iv|v|vi)$/.test(p);
const comSinonimos = (ps: string[]) => new Set(ps.flatMap((p) => [p, ...(SINONIMOS[p] ?? [])]));

function textoDaBase(b: ItemBase) {
  return [b.descricao, ...Object.values(b.especificacao_tecnica).map(String)].join(" ");
}

export type Casamento =
  | { tipo: "unico"; item: ItemBase }
  | { tipo: "varios"; opcoes: ItemBase[] }
  | { tipo: "nenhum" };

/**
 * @param descricao nome do item como o Interpretador leu
 * @param especificacao especificações citadas pelo comprador (valores)
 */
export function casarComBase(descricao: string, especificacao: Record<string, string> = {}): Casamento {
  const consulta = palavras([descricao, ...Object.values(especificacao)].join(" "));
  const temas = comSinonimos(consulta.filter((p) => !decisiva(p)));
  const numeros = consulta.filter(decisiva);

  // Família: quase todas as palavras do nome da base estão na consulta.
  const familia = baseDeItens().filter((b) => {
    const nome = palavras(b.descricao).filter((p) => !decisiva(p));
    if (!nome.length) return false;
    const cobertas = nome.filter((p) => temas.has(p)).length;
    return cobertas / nome.length >= 0.6 && cobertas >= Math.min(2, nome.length);
  });
  if (!familia.length) return { tipo: "nenhum" };

  // Termos decisivos do comprador têm de aparecer no item da base.
  const compativeis = familia.filter((b) => {
    const daBase = new Set(palavras(textoDaBase(b)));
    return numeros.every((n) => daBase.has(n));
  });
  if (compativeis.length === 1) return { tipo: "unico", item: compativeis[0]! };
  if (compativeis.length > 1) return { tipo: "varios", opcoes: compativeis.slice(0, 3) };
  return { tipo: "nenhum" };
}

/** O que diferencia as opções entre si, curto, para o rótulo do botão ("50 mm", "4 mm² · preto"). */
export function rotuloOpcao(b: ItemBase, opcoes: ItemBase[]): string {
  const valor = (o: ItemBase, k: string) => String(o.especificacao_tecnica[k] ?? "");
  const chaves = Object.keys(b.especificacao_tecnica).filter((k) => opcoes.some((o) => valor(o, k) !== valor(b, k)));
  // Menor conjunto de especificações que separa todas as opções: uma chave, se der; senão, duas.
  const separaTodas = (ks: string[]) => new Set(opcoes.map((o) => ks.map((k) => valor(o, k)).join("|"))).size === opcoes.length;
  const usar = chaves.find((k) => separaTodas([k])) ? [chaves.find((k) => separaTodas([k]))!] : chaves.slice(0, 2);
  const curto = (k: string) => {
    const v = valor(b, k);
    // Dimensões "1000 x 500 x 50": a última medida é a que costuma variar (espessura).
    if (/dimens/.test(k) && /x/.test(v)) {
      const partes = v.split(/\s*x\s*/);
      const variam = partes.filter((_, i) => opcoes.some((o) => valor(o, k).split(/\s*x\s*/)[i] !== partes[i]));
      return `${variam.join(" x ") || v} mm`;
    }
    const unidade = /_mm2$/.test(k) ? " mm²" : /_mm$/.test(k) ? " mm" : /_kg$/.test(k) ? " kg" : /_A$/.test(k) ? " A" : /_L$/.test(k) ? " L" : /_W$/.test(k) ? " W" : "";
    return `${v}${unidade}`;
  };
  const extra = palavras(b.descricao).filter((p) => !opcoes.every((o) => palavras(o.descricao).includes(p)));
  return [...usar.map(curto), extra.length ? extra.join(" ") : null].filter(Boolean).join(", ").slice(0, 40);
}

/** Especificação da base em texto, para gravar no item do pedido. */
export function especificacaoEmTexto(b: ItemBase): Record<string, string> {
  return Object.fromEntries(Object.entries(b.especificacao_tecnica).map(([k, v]) => [k, String(v)]));
}

export function itemDaBase(id: string): ItemBase | null {
  return baseDeItens().find((b) => b.id === id) ?? null;
}
