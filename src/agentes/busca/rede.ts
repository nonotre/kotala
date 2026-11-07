// Rede da busca: fetch com tempo limite e identificação, e cache das respostas
// para não gastar crédito com a mesma consulta. O Serper tem crédito único de
// 2.500 consultas: o teto SERPER_LIMITE é conferido no banco antes de cada chamada paga.

import { and, desc, eq, gte, like, sql } from "drizzle-orm";
import { db } from "../../nucleo/db/cliente.ts";
import { cacheBusca } from "../../nucleo/db/schema.ts";

export const USER_AGENT = "kotala-assistente-de-cotacao/0.1 (prototipo de hackathon)";

const num = (v: string | undefined, padrao: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : padrao;
};
export const CACHE_HORAS = () => num(process.env.BUSCA_CACHE_HORAS, 24);
export const SERPER_LIMITE = () => num(process.env.SERPER_LIMITE, 300);
export const MAX_CONSULTAS_ITEM = () => num(process.env.BUSCA_MAX_CONSULTAS_ITEM, 2);
export const MODO_SNAPSHOT = () => process.env.BUSCA_MODO === "snapshot";

export class LimiteDeBusca extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "LimiteDeBusca";
  }
}

export async function buscarHttp(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 10_000, ...resto } = init;
  return fetch(url, {
    ...resto,
    headers: { "user-agent": USER_AGENT, "accept-language": "pt-BR,pt;q=0.9", ...(resto.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
}

/** Consultas pagas já feitas, de todas as rotas do provedor (serper-shopping, serper-search...). */
export async function consultasPagasFeitas(prefixo = "serper"): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cacheBusca)
    .where(and(like(cacheBusca.provedor, `${prefixo}%`), eq(cacheBusca.pago, true)));
  return r?.n ?? 0;
}

/**
 * Devolve a resposta guardada da mesma consulta, se ainda vale; senão chama
 * `buscar` e guarda. Em modo snapshot nunca vai à rede. Chamada paga confere o teto antes.
 */
export async function comCache<T>(
  provedor: string,
  consulta: string,
  opcoes: { pago: boolean; guardarSe?: (valor: T) => boolean },
  buscar: () => Promise<T>,
): Promise<{ valor: T; doCache: boolean } | null> {
  const desde = MODO_SNAPSHOT() ? new Date(0) : new Date(Date.now() - CACHE_HORAS() * 3600_000);
  const [guardado] = await db
    .select()
    .from(cacheBusca)
    .where(and(eq(cacheBusca.provedor, provedor), eq(cacheBusca.consulta, consulta), gte(cacheBusca.criadoEm, desde)))
    .orderBy(desc(cacheBusca.criadoEm))
    .limit(1);
  if (guardado) return { valor: guardado.resposta as T, doCache: true };
  if (MODO_SNAPSHOT()) return null;

  if (opcoes.pago) {
    const feitas = await consultasPagasFeitas(provedor.split("-")[0]);
    if (feitas >= SERPER_LIMITE()) {
      throw new LimiteDeBusca(`Teto de ${SERPER_LIMITE()} consultas pagas (${provedor}) atingido. Aumente SERPER_LIMITE se quiser gastar mais.`);
    }
    // Testes automáticos nunca gastam crédito.
    if (process.env.NODE_TEST_CONTEXT) throw new LimiteDeBusca("Consulta paga bloqueada durante testes.");
  }
  const valor = await buscar();
  // Chamada paga entra sempre (conta no teto); resposta inútil (ex.: site fora do ar) não fica guardada.
  if (opcoes.pago || !opcoes.guardarSe || opcoes.guardarSe(valor)) {
    await db.insert(cacheBusca).values({ provedor, consulta, resposta: valor as object, pago: opcoes.pago });
  }
  return { valor, doCache: false };
}
