// Serper.dev: resultados do Google (web e shopping). Cada chamada gasta 1 de
// um crédito único de 2.500; tudo passa pelo cache e pelo teto SERPER_LIMITE.

import { buscarHttp, comCache } from "./rede.ts";

export const temSerper = () => !!process.env.SERPER_API_KEY;

/** Quantas chamadas pagas de verdade (fora do cache) este processo fez. */
export let pagasNesteProcesso = 0;

async function chamar<T>(rota: "search" | "shopping", q: string): Promise<T | null> {
  const chave = process.env.SERPER_API_KEY;
  if (!chave) return null;
  const r = await comCache(`serper-${rota}`, q, { pago: true }, async () => {
    const res = await buscarHttp(`https://google.serper.dev/${rota}`, {
      method: "POST",
      headers: { "x-api-key": chave, "content-type": "application/json" },
      body: JSON.stringify({ q, gl: "br", hl: "pt-br", num: 10 }),
    });
    if (!res.ok) throw new Error(`Serper ${rota}: HTTP ${res.status}`);
    return (await res.json()) as T;
  });
  if (r && !r.doCache) pagasNesteProcesso++;
  return r?.valor ?? null;
}

export type ResultadoShopping = { titulo: string; loja: string; link: string; preco: number | null; precoTexto: string; entrega: string | null };

/** "R$ 1.234,56" → 1234.56 */
export function lerPrecoBRL(texto: string | undefined | null): number | null {
  if (!texto) return null;
  const m = /R\$\s?([\d.]+(?:,\d{1,2})?)/.exec(texto);
  if (!m) return null;
  const n = Number(m[1]!.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function shopping(q: string): Promise<ResultadoShopping[]> {
  const r = await chamar<{ shopping?: { title: string; source: string; link: string; price?: string; delivery?: string }[] }>("shopping", q);
  return (r?.shopping ?? [])
    .filter((s) => s.link && s.title)
    .map((s) => ({ titulo: s.title, loja: s.source, link: s.link, preco: lerPrecoBRL(s.price), precoTexto: s.price ?? "", entrega: s.delivery ?? null }));
}

export type ResultadoWeb = { titulo: string; link: string; trecho: string };

export async function web(q: string): Promise<ResultadoWeb[]> {
  const r = await chamar<{ organic?: { title: string; link: string; snippet?: string }[] }>("search", q);
  return (r?.organic ?? []).filter((o) => o.link).map((o) => ({ titulo: o.title, link: o.link, trecho: o.snippet ?? "" }));
}
