// Filtra e Ordena (R3): relevância, tamanho, kit e unidade, em código puro.
// Na dúvida, descarta: preço errado na tela é pior que preço a menos.

export type Termos = {
  /** Cada grupo precisa de pelo menos uma palavra presente no título. */
  grupos: string[][];
  /** Nenhuma pode aparecer (ex.: rejunte, quando o pedido é areia). */
  proibidas: string[];
  /** Conteúdo por embalagem do pedido (ex.: 50 kg por saco), quando houver. */
  conteudoKg: number | null;
};

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

export function relevante(titulo: string, t: Termos): { ok: boolean; motivo?: string } {
  const proibida = t.proibidas.find((p) => p && contem(titulo, p));
  if (proibida) return { ok: false, motivo: `Outro produto (${proibida})` };
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
  const m = /\b(?:kit|pacote|caixa|fardo)\s*(?:com\s*)?(\d{1,4})\b|\bc\/\s?(\d{1,4})\b|\b(\d{1,4})\s*(?:sacos|unidades|pe[cç]as)\b/i.exec(titulo);
  const n = Number(m?.[1] ?? m?.[2] ?? m?.[3]);
  return Number.isFinite(n) && n > 1 ? n : null;
}

const UNIDADE_VOLUME = /m3|m³|metro|carrad|caçamba|cacamba|caminh/i;

export type Conversao = { precoUnitario: number | null; conversao: string | null; corte: string | null };

/** Converte o preço da loja para a unidade do pedido, só quando é seguro. */
export function converter(preco: number, titulo: string, unidadePedido: string, t: Termos): Conversao {
  const kg = kgNoTitulo(titulo);
  if (UNIDADE_VOLUME.test(unidadePedido)) {
    if (kg !== null) return { precoUnitario: null, conversao: null, corte: `Vendido em embalagem de ${kg} kg; o pedido é por ${unidadePedido}` };
    if (/carrad|caçamba|cacamba|caminh/i.test(unidadePedido) && !/carrad|caçamba|cacamba|caminh/i.test(titulo)) {
      return { precoUnitario: null, conversao: null, corte: "Vendido por m³ ou outra medida; carrada não tem volume fixo" };
    }
  }
  if (t.conteudoKg !== null && kg !== null && Math.abs(kg - t.conteudoKg) > 0.01) {
    return { precoUnitario: null, conversao: null, corte: `Outro tamanho (${kg} kg; pedido ${t.conteudoKg} kg)` };
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
