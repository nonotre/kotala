// Unidades de compra e conversões seguras. Só converte dentro de uma família
// com fator fixo (kg e g, L e mL, m e cm, unidade e milheiro). Caixa, resma,
// saco e carrada não têm fator fixo: nunca são convertidos entre si.

export type Unidade = {
  id: string;
  nomes: string[];
  /** Família: só unidades da mesma família se convertem. */
  familia: string;
  /** Fator até a unidade-base da família; null quando não há fator fixo. */
  fator: number | null;
  /** Rótulo para mostrar ao usuário. */
  rotulo: string;
};

const peso = (id: string, nomes: string[], fator: number, rotulo = id): Unidade => ({ id, nomes, familia: "massa", fator, rotulo });

export const UNIDADES: Unidade[] = [
  peso("g", ["g", "gr", "grama"], 1),
  peso("kg", ["kg", "kgs", "quilo", "quilograma", "kilo"], 1000),
  peso("t", ["t", "ton", "tonelada"], 1_000_000),
  { id: "ml", nomes: ["ml", "mililitro"], familia: "liquido", fator: 1, rotulo: "mL" },
  { id: "l", nomes: ["l", "lt", "litro"], familia: "liquido", fator: 1000, rotulo: "L" },
  { id: "mm", nomes: ["mm", "milimetro"], familia: "comprimento", fator: 1, rotulo: "mm" },
  { id: "cm", nomes: ["cm", "centimetro"], familia: "comprimento", fator: 10, rotulo: "cm" },
  { id: "m", nomes: ["m", "mt", "metro", "metro linear"], familia: "comprimento", fator: 1000, rotulo: "m" },
  { id: "m2", nomes: ["m2", "m²", "metro quadrado"], familia: "area", fator: 1, rotulo: "m²" },
  { id: "m3", nomes: ["m3", "m³", "metro cubico", "metro cúbico"], familia: "volume", fator: 1, rotulo: "m³" },
  { id: "un", nomes: ["un", "und", "unid", "unidade", "peca", "peça", "pc"], familia: "contagem", fator: 1, rotulo: "unidade" },
  { id: "duzia", nomes: ["duzia", "dúzia"], familia: "contagem", fator: 12, rotulo: "dúzia" },
  { id: "centena", nomes: ["centena", "cento"], familia: "contagem", fator: 100, rotulo: "cento" },
  { id: "milheiro", nomes: ["milheiro"], familia: "contagem", fator: 1000, rotulo: "milheiro" },
  ...["caixa", "resma", "pacote", "par", "kit", "rolo", "saco", "barra", "lata", "galao", "galão", "fardo", "folha", "painel", "chapa", "balde", "frasco", "garrafa", "cartela"].map(
    (n): Unidade => ({ id: n.normalize("NFD").replace(/\p{Diacritic}/gu, ""), nomes: [n], familia: `embalagem:${n.normalize("NFD").replace(/\p{Diacritic}/gu, "")}`, fator: null, rotulo: n }),
  ),
  // Carga de caminhão: o volume varia (5 a 8 m³), então não converte para m³.
  { id: "carrada", nomes: ["carrada", "cacamba", "caçamba", "caminhao", "caminhão", "viagem"], familia: "carga", fator: null, rotulo: "carrada" },
  ...["hora", "diaria", "diária", "mes", "mês", "visita", "servico", "serviço"].map(
    (n): Unidade => ({ id: n.normalize("NFD").replace(/\p{Diacritic}/gu, ""), nomes: [n], familia: `servico:${n.normalize("NFD").replace(/\p{Diacritic}/gu, "")}`, fator: null, rotulo: n }),
  ),
];

const limpa = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[³]/g, "3")
    .replace(/[²]/g, "2")
    .trim()
    .replace(/\.$/, "");

const POR_NOME = new Map<string, Unidade>();
for (const u of UNIDADES) for (const n of [u.id, ...u.nomes]) POR_NOME.set(limpa(n), u);

/** "Sacos" → saco; "metro cúbico" → m³; null quando não reconhece. */
export function normalizarUnidade(texto: string): Unidade | null {
  const t = limpa(texto);
  if (!t) return null;
  const direto = POR_NOME.get(t);
  if (direto) return direto;
  // Plural: "sacos", "caixas", "galões" (õ→o já tirado), "metros cubicos".
  const singular = t.replace(/oes\b/g, "ao").replace(/(?<=\w\w)(es|s)\b/g, "");
  return POR_NOME.get(singular) ?? POR_NOME.get(t.replace(/s\b/g, "")) ?? null;
}

/** Converte só quando as duas unidades têm fator fixo na mesma família. */
export function converterUnidade(valor: number, de: string, para: string): number | null {
  const a = normalizarUnidade(de);
  const b = normalizarUnidade(para);
  if (!a || !b || a.familia !== b.familia || a.fator === null || b.fator === null) return null;
  return (valor * a.fator) / b.fator;
}

/** A unidade dita está entre as aceitas (comparando por unidade normalizada, não por texto). */
export function unidadeAceita(texto: string, aceitas: string[]): boolean {
  const u = normalizarUnidade(texto);
  if (!u) return false;
  return aceitas.some((a) => normalizarUnidade(a)?.id === u.id);
}

export type Conteudo = { valor: number; unidade: string };

const CONTEUDO = /(\d+(?:[.,]\d+)?)\s?(kgs?|g|gr|ml|l|lt|litros?|m|metros?|folhas?|un|unidades?)(?![\w/²³])/gi;

/**
 * Conteúdo por embalagem citado no título: "50KG", "5 L", "500 folhas", "100 m".
 * Com `familia`, só devolve uma medida dessa família (ex.: "massa"). "75 g/m²" não conta.
 */
export function conteudoNoTitulo(titulo: string, familia?: string): Conteudo | null {
  for (const m of titulo.matchAll(CONTEUDO)) {
    const u = normalizarUnidade(m[2]!.toLowerCase() === "folhas" ? "folha" : m[2]!);
    if (!u) continue;
    if (familia && u.familia !== familia) continue;
    return { valor: Number(m[1]!.replace(",", ".")), unidade: u.id };
  }
  return null;
}

export const rotuloConteudo = (c: Conteudo) => `${String(c.valor).replace(".", ",")} ${normalizarUnidade(c.unidade)?.rotulo ?? c.unidade}`;
