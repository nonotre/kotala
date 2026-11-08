// R7: frete de lojas fora da VTEX. Só o que a própria loja declara na página do
// anúncio, no JSON-LD (schema.org OfferShippingDetails): valor, prazo e para onde
// vale (faixa de CEP, prefixo, CEP exato, UF ou o Brasil todo). Sem declaração,
// o frete continua "a calcular no site": nada de valor inventado.
//
// Fica de fora, de propósito:
// - texto solto da página ("frete grátis", "frete a partir de"): quase sempre tem
//   condição escondida (valor mínimo, região, peso) e a leitura não é confiável;
// - tabela de frete por faixa de CEP digitada à mão: tabelas reais dependem de peso,
//   volume e valor do pedido, e não temos a tabela publicada de nenhuma loja conhecida;
// - estimativa por distância: não sabemos de onde a loja despacha nem o peso do item,
//   e geocodificar o CEP exigiria um serviço externo.

import { ehTipo, nodosJsonLd, type Nodo } from "./pagina.ts";

export type FreteDoAnuncio =
  | {
      entrega: true;
      valor: number;
      /** Prazo declarado (manuseio + transporte, no máximo), em dias; null quando não declara. */
      prazoDias: number | null;
      /** true: a regra da loja cobre o CEP (faixa, prefixo, CEP ou UF); false: vale para o Brasil todo, sem faixa conferida. */
      noCep: boolean;
      /** Para quem lê o mapa e o rastro: "faixa 01000-000 a 19999-999", "UF SP", "Brasil". */
      regra: string;
      /** O trecho do JSON-LD de onde saiu o frete, para a auditoria. */
      trecho: string;
    }
  | { entrega: false; regra: string; trecho: string };

const lista = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const cepFormatado = (c: string) => (c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : c);

/** Faixas de CEP por UF (Correios). Usadas quando a loja declara o frete por estado. */
const FAIXAS_UF: [string, number, number][] = [
  ["SP", 1000, 19999], ["RJ", 20000, 28999], ["ES", 29000, 29999], ["MG", 30000, 39999],
  ["BA", 40000, 48999], ["SE", 49000, 49999], ["PE", 50000, 56999], ["AL", 57000, 57999],
  ["PB", 58000, 58999], ["RN", 59000, 59999], ["CE", 60000, 63999], ["PI", 64000, 64999],
  ["MA", 65000, 65999], ["PA", 66000, 68899], ["AP", 68900, 68999], ["AM", 69000, 69299],
  ["RR", 69300, 69399], ["AM", 69400, 69899], ["AC", 69900, 69999], ["DF", 70000, 72799],
  ["GO", 72800, 72999], ["DF", 73000, 73699], ["GO", 73700, 76799], ["RO", 76800, 76999],
  ["TO", 77000, 77999], ["MT", 78000, 78899], ["MS", 79000, 79999], ["PR", 80000, 87999],
  ["SC", 88000, 89999], ["RS", 90000, 99999],
];

/** UF do CEP pelas faixas dos Correios; null quando o CEP não tem 8 dígitos. */
export function ufDoCep(cep: string): string | null {
  const c = digitos(cep);
  if (c.length !== 8) return null;
  const prefixo = Number(c.slice(0, 5));
  return FAIXAS_UF.find(([, de, ate]) => prefixo >= de && prefixo <= ate)?.[0] ?? null;
}

const numero = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Dias de um QuantitativeValue (maxValue, senão value/minValue). Só "DAY"/"d"; horas viram 0. */
function diasDe(q: unknown): number | null {
  if (!q || typeof q !== "object") return null;
  const v = q as Nodo;
  const n = numero(v.maxValue) ?? numero(v.value) ?? numero(v.minValue);
  if (n === null) return null;
  const u = String(v.unitCode ?? "DAY").toUpperCase();
  if (u === "DAY" || u === "D") return Math.ceil(n);
  if (u === "HUR" || u === "H") return 0;
  return null;
}

function prazoDe(d: Nodo): number | null {
  const t = d.deliveryTime as Nodo | undefined;
  if (!t || typeof t !== "object") return null;
  const manuseio = diasDe(t.handlingTime);
  const transporte = diasDe(t.transitTime);
  if (manuseio === null && transporte === null) return null;
  return (manuseio ?? 0) + (transporte ?? 0);
}

type Cobertura = { cobre: boolean; especifica: boolean; regra: string };

/** Uma DefinedRegion cobre o CEP? `especifica` diz se a regra olha CEP ou UF (e não só o país). */
function cobertura(dest: Nodo, cep: string): Cobertura {
  const pais = dest.addressCountry;
  const paisTexto = typeof pais === "object" && pais ? String((pais as Nodo).name ?? (pais as Nodo).identifier ?? "") : String(pais ?? "");
  if (paisTexto && !/^(br|bra|brasil|brazil)$/i.test(paisTexto.trim())) return { cobre: false, especifica: true, regra: `país ${paisTexto}` };

  const faixas = lista(dest.postalCodeRange as Nodo | Nodo[]);
  if (faixas.length) {
    for (const f of faixas) {
      const de = digitos(f.postalCodeBegin).padEnd(8, "0");
      const ate = digitos(f.postalCodeEnd).padEnd(8, "9");
      if (cep.length === 8 && de.length === 8 && ate.length === 8 && cep >= de && cep <= ate) {
        return { cobre: true, especifica: true, regra: `faixa ${cepFormatado(de)} a ${cepFormatado(ate)}` };
      }
    }
    return { cobre: false, especifica: true, regra: "faixa de CEP" };
  }
  const prefixos = lista(dest.postalCodePrefix as string | string[]).map(digitos).filter(Boolean);
  if (prefixos.length) {
    const p = prefixos.find((x) => cep.startsWith(x));
    return p ? { cobre: true, especifica: true, regra: `CEPs começando por ${p}` } : { cobre: false, especifica: true, regra: "prefixo de CEP" };
  }
  const ceps = lista(dest.postalCode as string | string[]).map(digitos).filter(Boolean);
  if (ceps.length) {
    return ceps.includes(cep) ? { cobre: true, especifica: true, regra: `CEP ${cepFormatado(cep)}` } : { cobre: false, especifica: true, regra: "CEP" };
  }
  const ufs = lista(dest.addressRegion as string | string[]).map((u) => String(u).trim().toUpperCase()).filter(Boolean);
  if (ufs.length) {
    const uf = ufDoCep(cep);
    return uf && ufs.includes(uf) ? { cobre: true, especifica: true, regra: `UF ${uf}` } : { cobre: false, especifica: true, regra: `UF ${ufs.join(", ")}` };
  }
  return { cobre: true, especifica: false, regra: "Brasil" };
}

/** Ofertas do produto principal: Product.offers, inclusive dentro de AggregateOffer. */
function ofertasDoProduto(html: string): Nodo[] {
  const ofertas: Nodo[] = [];
  for (const n of nodosJsonLd(html)) {
    if (!ehTipo(n, "Product")) continue;
    for (const o of lista(n.offers as Nodo | Nodo[])) {
      if (!o || typeof o !== "object") continue;
      ofertas.push(o);
      for (const sub of lista(o.offers as Nodo | Nodo[])) if (sub && typeof sub === "object") ofertas.push(sub);
    }
  }
  return ofertas;
}

/**
 * Frete declarado no JSON-LD do anúncio para o CEP. Prefere a regra que cobre o CEP
 * (faixa, prefixo, CEP ou UF) à que vale para o Brasil todo; entre as que valem, a mais barata.
 * Sem CEP, só a regra nacional serve. `doesNotShip` na regra do CEP vira "não entrega".
 * Null quando a página não declara frete nenhum que sirva.
 */
export function freteDoJsonLd(html: string, cep: string | null): FreteDoAnuncio | null {
  const c = digitos(cep);
  const candidatos: { valor: number; prazoDias: number | null; noCep: boolean; regra: string; trecho: string }[] = [];
  let naoEntrega: { regra: string; trecho: string } | null = null;
  for (const o of ofertasDoProduto(html)) {
    for (const d of lista(o.shippingDetails as Nodo | Nodo[])) {
      if (!d || typeof d !== "object") continue;
      const destinos = lista(d.shippingDestination as Nodo | Nodo[]).filter((x) => x && typeof x === "object");
      const coberturas = destinos.length ? destinos.map((x) => cobertura(x, c)) : [{ cobre: true, especifica: false, regra: "Brasil" }];
      // Uma regra específica que cobre o CEP vale mais que a nacional.
      const vale = coberturas.find((x) => x.cobre && x.especifica) ?? coberturas.find((x) => x.cobre);
      if (!vale) continue;
      const trecho = JSON.stringify({ shippingRate: d.shippingRate, shippingDestination: d.shippingDestination, deliveryTime: d.deliveryTime, doesNotShip: d.doesNotShip }).slice(0, 300);
      if (d.doesNotShip === true || d.doesNotShip === "true") {
        if (vale.especifica) naoEntrega = { regra: vale.regra, trecho };
        continue;
      }
      // Regra específica sem CEP no pedido não dá para conferir.
      if (vale.especifica && c.length !== 8) continue;
      const taxa = lista(d.shippingRate as Nodo | Nodo[])[0];
      if (!taxa || typeof taxa !== "object") continue;
      const moeda = taxa.currency ?? taxa.priceCurrency;
      if (moeda && moeda !== "BRL") continue;
      const valor = numero(taxa.value) ?? numero(taxa.maxValue);
      if (valor === null) continue;
      candidatos.push({ valor, prazoDias: prazoDe(d), noCep: vale.especifica, regra: vale.regra, trecho });
    }
  }
  const especificos = candidatos.filter((x) => x.noCep);
  if (naoEntrega && !especificos.length) return { entrega: false, ...naoEntrega };
  const escolhidos = especificos.length ? especificos : candidatos;
  if (!escolhidos.length) return null;
  const melhor = escolhidos.reduce((a, b) => (b.valor < a.valor ? b : a));
  return { entrega: true, ...melhor };
}
