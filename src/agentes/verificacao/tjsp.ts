// Q8: processos no TJSP (e-SAJ, consulta pública de 1º grau) em que o CNPJ é
// parte. Guarda só a contagem e as classes dos processos: nada de nomes de
// pessoas. Muito processo não prova nada (empresa grande tem muitos); o que
// pesa é falência e recuperação judicial.
//
// Atenção: o e-SAJ ficou fora do ar em 07 e 08/11/2026 (manutenção), então o
// formato da resposta não pôde ser conferido nesses dias. Quando o site não
// responde como esperado, o resultado é "indisponível" e não pune ninguém.

import { buscarHttp, comCache } from "../busca/rede.ts";
import { limparCnpj } from "./cnpj.ts";

export type ResultadoTjsp =
  | { disponivel: true; processos: number; classesGraves: string[]; url: string }
  | { disponivel: false; motivo: string; url: string };

const CLASSES_GRAVES = /fal[eê]ncia|recupera[cç][aã]o judicial|insolv[eê]ncia/i;

export function urlTjsp(cnpj: string) {
  return `https://esaj.tjsp.jus.br/cpopg/search.do?conversationId=&cbPesquisa=DOCPARTE&dadosConsulta.valorConsulta=${limparCnpj(cnpj)}&cdForo=-1`;
}

/** Lê a página de resultados do e-SAJ. Exportada para teste. */
export function lerResultadoTjsp(html: string, url: string): ResultadoTjsp {
  if (/captcha/i.test(html)) return { disponivel: false, motivo: "TJSP pediu verificação humana (captcha)", url };
  if (/Indisponibilidade de sistemas|manuten[cç][aã]o/i.test(html) && !/processo/i.test(html.slice(0, 2000))) {
    return { disponivel: false, motivo: "TJSP em manutenção", url };
  }
  if (/N[aã]o existem informa[cç][oõ]es dispon[ií]veis/i.test(html)) return { disponivel: true, processos: 0, classesGraves: [], url };
  const total = /(\d[\d.]*)\s+Processos?\s+encontrad/i.exec(html);
  const classes = [...html.matchAll(/class="[^"]*classeProcesso[^"]*"[^>]*>([^<]+)</gi)].map((m) => m[1]!.trim());
  if (!total && !classes.length && !/linkProcesso|processoDetalhe|show\.do\?processo/i.test(html)) {
    return { disponivel: false, motivo: "Resposta do TJSP em formato desconhecido", url };
  }
  const processos = total ? Number(total[1]!.replace(/\./g, "")) : classes.length || 1;
  const graves = [...new Set(classes.filter((c) => CLASSES_GRAVES.test(c)))];
  return { disponivel: true, processos, classesGraves: graves, url };
}

/** O e-SAJ redireciona a primeira visita para si mesmo enquanto grava o cookie de sessão. */
async function buscarComCookies(url: string): Promise<{ html: string; final: string }> {
  const cookies = new Map<string, string>();
  let atual = url;
  for (let i = 0; i < 6; i++) {
    const res = await buscarHttp(atual, {
      timeoutMs: 12_000,
      redirect: "manual",
      headers: { accept: "text/html", cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
    });
    for (const c of res.headers.getSetCookie()) {
      const [par] = c.split(";");
      const [k, ...v] = par!.split("=");
      if (k) cookies.set(k.trim(), v.join("=").trim());
    }
    const destino = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && destino) {
      atual = new URL(destino, atual).toString();
      continue;
    }
    return { html: await res.text(), final: atual };
  }
  throw new Error("redirecionamentos demais");
}

export async function consultarTjsp(cnpj: string): Promise<ResultadoTjsp> {
  const url = urlTjsp(cnpj);
  try {
    const r = await comCache("tjsp", limparCnpj(cnpj), { pago: false, guardarSe: (v: ResultadoTjsp) => v.disponivel }, async () => {
      const { html, final } = await buscarComCookies(url);
      if (!/esaj\.tjsp\.jus\.br\/cpopg/.test(final)) return { disponivel: false, motivo: "TJSP redirecionou para fora da consulta (manutenção?)", url } as ResultadoTjsp;
      return lerResultadoTjsp(html, url);
    });
    return r?.valor ?? { disponivel: false, motivo: "Sem consulta guardada", url };
  } catch (e) {
    return { disponivel: false, motivo: `TJSP não respondeu (${e instanceof Error ? e.message : e})`, url };
  }
}
