// Filtra e Ordena (R3): relevância, tamanho, kit e unidade, em código puro.
// Na dúvida, descarta: preço errado na tela é pior que preço a menos.

export type Termos = {
  /** Cada grupo precisa de pelo menos uma palavra presente no título. */
  grupos: string[][];
  /** Nenhuma pode aparecer (ex.: cartucho, quando o pedido é papel). */
  proibidas: string[];
  /** Conteúdo por embalagem do pedido em kg (ex.: 50 kg por saco), quando houver. */
  conteudoKg: number | null;
  /** Conteúdo por embalagem em qualquer unidade (5 L, 500 folhas, 100 m). Vale mais que conteudoKg. */
  conteudo?: Conteudo | null;
  /** Revisão 80: medidas do pedido (comprimento, bitola, polegada, voltagem, potência); título que contradiz é cortado. */
  medidas?: Medida[];
};

import { conteudoNoTitulo, converterUnidade, normalizarUnidade, rotuloConteudo, type Conteudo } from "../../dominio/unidades.ts";

export const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const tokens = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * A palavra aparece no título, comparando por palavras: "cp ii", "cpii" e "CPII-E"
 * casam com "cp ii"; "CP III" não casa com "cp ii", e "500kg" não casa com "50kg".
 */
export function contem(titulo: string, palavra: string): boolean {
  const kw = normalizar(palavra);
  if (!kw) return false;
  const t = tokens(titulo);
  for (let i = 0; i < t.length; i++) {
    for (let n = 1; n <= 3 && i + n <= t.length; n++) {
      const junto = t.slice(i, i + n).join("");
      if (junto === kw) return true;
      if (n === 1 && junto.startsWith(kw)) {
        const prox = junto[kw.length]!;
        if (/[ivx]$/.test(kw) && /[ivx]/.test(prox)) continue; // CP II × CP III
        if (/\d$/.test(kw) && /\d/.test(prox)) continue; // 50 × 500
        if (/[a-z]$/.test(kw) && /[a-z]/.test(prox) && kw.length < 4) continue; // "cp" × "cpu"
        return true;
      }
    }
  }
  return false;
}

// ---------- Revisão 80: medida do anúncio diferente da pedida ----------
// O pedido 33 (tubo de PVC 25 mm × 6 m, sem similar) recebeu em 1º um anúncio de tubo de 3 m: o
// unitário parecia metade do preço. Medida escrita no título que contradiz a do pedido corta o anúncio.

/** Grupo da medida, pela unidade como foi escrita: metros com metros, milímetros com milímetros. */
type GrupoMedida = "m" | "mm" | "pol" | "V" | "W";
export type Medida = { grupo: GrupoMedida; valor: number; texto: string };

const fracao = (t: string) => {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t.trim());
  if (m) return Number(m[1]) / Number(m[2]);
  const misto = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(t.trim());
  if (misto) return Number(misto[1]) + Number(misto[2]) / Number(misto[3]);
  return Number(t.replace(",", "."));
};

/** Medidas escritas num texto: "6m", "6 metros", "25mm", "2,5 cm", "3/4\"", "1 1/2 pol", "220V", "1200W". */
export function medidasNoTexto(texto: string): Medida[] {
  const t = texto.replace(/[″”]/g, '"');
  const out: Medida[] = [];
  const add = (grupo: GrupoMedida, valor: number, txt: string) => {
    if (Number.isFinite(valor) && valor > 0) out.push({ grupo, valor: Math.round(valor * 1000) / 1000, texto: txt.trim() });
  };
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*(mm|cm|mts?|m|metros?)(?![a-z²³])/gi)) {
    if (m[0] === "3M") continue; // a marca 3M, não 3 metros
    const v = Number(m[1]!.replace(",", "."));
    const u = m[2]!.toLowerCase();
    if (u === "mm") add("mm", v, m[0]);
    else if (u === "cm") add("mm", v * 10, m[0]);
    else add("m", v, m[0]);
  }
  for (const m of t.matchAll(/(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)\s*(?:"|pol(?:egadas?)?\b|de polegada)/gi)) add("pol", fracao(m[1]!), m[0]);
  if (!/bivolt/i.test(t)) for (const m of t.matchAll(/\b(110|127|220|380)\s*v\b/gi)) add("V", Number(m[1]), m[0]);
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*w\b/gi)) add("W", Number(m[1]!.replace(",", ".")), m[0]);
  return out;
}

/** Medidas do pedido: do nome e das especificações ("Comprimento: 6 m", "Polegada: 3/4\""). */
export function medidasDoPedido(descricao: string, especificacao: Record<string, string> | null | undefined): Medida[] {
  return medidasNoTexto([descricao, ...Object.values(especificacao ?? {})].join(" ; "));
}

/**
 * O anúncio contradiz a medida do pedido: para cada grupo que o pedido diz, se o título traz
 * medidas desse grupo e nenhuma bate (1% de folga), corta. Título sem a medida não é cortado
 * (fica para o comprador conferir no link).
 */
export function medidaDiferente(titulo: string, pedidas: readonly Medida[]): string | null {
  if (!pedidas.length) return null;
  const doTitulo = medidasNoTexto(titulo);
  for (const grupo of new Set(pedidas.map((m) => m.grupo))) {
    const p = pedidas.filter((m) => m.grupo === grupo);
    const t = doTitulo.filter((m) => m.grupo === grupo);
    if (!t.length) continue;
    const bate = t.some((a) => p.some((b) => Math.abs(a.valor - b.valor) <= Math.max(0.01, b.valor * 0.01)));
    if (!bate) return `Medida diferente do pedido (${t[0]!.texto} no anúncio; pedido ${[...new Set(p.map((x) => x.texto))].join(" ou ")})`;
  }
  return null;
}

export function relevante(titulo: string, t: Termos): { ok: boolean; motivo?: string } {
  const proibida = t.proibidas.find((p) => p && contem(titulo, p));
  if (proibida) return { ok: false, motivo: `Outro produto (${proibida})` };
  const medida = t.medidas?.length ? medidaDiferente(titulo, t.medidas) : null;
  if (medida) return { ok: false, motivo: medida };
  for (const g of t.grupos) {
    if (!g.some((p) => p && contem(titulo, p))) return { ok: false, motivo: `Não é o item pedido (falta ${g[0]})` };
  }
  return { ok: true };
}

/** Peso por embalagem citado no título: "50KG", "25 kg", "20Kgs". */
export function kgNoTitulo(titulo: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s?kgs?\b/i.exec(titulo);
  return m ? Number(m[1]!.replace(",", ".")) : null;
}

/** "Kit 10 sacos", "c/ 10", "pacote com 6": quantidade no kit. */
export function tamanhoDoKit(titulo: string): number | null {
  const m = /\b(?:kit|pacote|caixa|fardo)\s*(?:com\s*)?(\d{1,4})\b|\bc\/\s?(\d{1,4})\b|\b(\d{1,4})\s*(?:sacos|unidades|pe[cç]as|resmas|caixas|pares|rolos|latas|pacotes)\b/i.exec(titulo);
  const n = Number(m?.[1] ?? m?.[2] ?? m?.[3]);
  return Number.isFinite(n) && n > 1 ? n : null;
}

/** Pedido em volume (m³) ou em carga de caminhão: o preço de embalagem em kg não serve. */
const emVolume = (unidade: string) => /^(volume|carga)$/.test(normalizarUnidade(unidade)?.familia ?? "");
/** Carrada, caçamba: não tem volume fixo, só serve quem vende na mesma unidade. */
const semVolumeFixo = (unidade: string) => normalizarUnidade(unidade)?.familia === "carga";

export type Conversao = { precoUnitario: number | null; conversao: string | null; corte: string | null };

/** Converte o preço da loja para a unidade do pedido, só quando é seguro. */
export function converter(preco: number, titulo: string, unidadePedido: string, t: Termos): Conversao {
  const kg = kgNoTitulo(titulo);
  if (emVolume(unidadePedido)) {
    if (kg !== null) return { precoUnitario: null, conversao: null, corte: `Vendido em embalagem de ${kg} kg; o pedido é por ${unidadePedido}` };
    if (semVolumeFixo(unidadePedido) && !/carrad|ca[cç]amba|caminh/i.test(titulo)) {
      return { precoUnitario: null, conversao: null, corte: "Vendido por m³ ou outra medida; carrada não tem volume fixo" };
    }
  }
  // Conteúdo por embalagem (kg, L, folhas, m): outro tamanho não serve. Converte g↔kg, mL↔L, cm↔m.
  const pedido: Conteudo | null = t.conteudo ?? (t.conteudoKg !== null ? { valor: t.conteudoKg, unidade: "kg" } : null);
  if (pedido) {
    const no = conteudoNoTitulo(titulo, normalizarUnidade(pedido.unidade)?.familia);
    const equivalente = !no ? null : no.unidade === normalizarUnidade(pedido.unidade)?.id ? no.valor : converterUnidade(no.valor, no.unidade, pedido.unidade);
    if (no && equivalente !== null && Math.abs(equivalente - pedido.valor) > 0.01) {
      return { precoUnitario: null, conversao: null, corte: `Outro tamanho (${rotuloConteudo(no)}; pedido ${rotuloConteudo(pedido)})` };
    }
  }
  const kit = tamanhoDoKit(titulo);
  if (kit) {
    return { precoUnitario: Math.round((preco / kit) * 100) / 100, conversao: `Kit com ${kit}: preço ÷ ${kit}`, corte: null };
  }
  return { precoUnitario: preco, conversao: null, corte: null };
}

const CONFIANCA_BASE = { vtex_api: 90, jsonld: 80, ia_trecho: 65, serper_shopping: 60 } as const;

export function confianca(metodo: keyof typeof CONFIANCA_BASE, disponivel: boolean | null, entregaNoCep: boolean | null): number {
  let c = CONFIANCA_BASE[metodo];
  if (disponivel === false) c -= 20;
  if (entregaNoCep) c += 5;
  return Math.max(0, Math.min(100, c));
}

export type Candidata = {
  loja: string;
  titulo: string;
  url: string;
  aceita: boolean;
  disponivel: boolean | null;
  confianca: number;
  precoUnitario: number | null;
};

/** Tira duplicadas (mesmo link ou mesma loja e título) e ordena: aceitas, em estoque, mais confiáveis, mais baratas. */
export function ordenar<T extends Candidata>(lista: T[]): T[] {
  const vistos = new Set<string>();
  const unicas: T[] = [];
  for (const c of lista) {
    const k1 = c.url.split("?")[0]!;
    const k2 = `${normalizar(c.loja)}|${normalizar(c.titulo)}`;
    if (vistos.has(k1) || vistos.has(k2)) continue;
    vistos.add(k1);
    vistos.add(k2);
    unicas.push(c);
  }
  return unicas.sort(
    (a, b) =>
      Number(b.aceita) - Number(a.aceita) ||
      Number(b.disponivel !== false) - Number(a.disponivel !== false) ||
      b.confianca - a.confianca ||
      (a.precoUnitario ?? Infinity) - (b.precoUnitario ?? Infinity),
  );
}

export function mediana(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round(((s[m - 1]! + s[m]!) / 2) * 100) / 100;
}
