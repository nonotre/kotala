import type { Alvo } from "./reserva.ts";

/** Papel decide a cadeia de modelos: "rapido" para extrair e classificar, "forte" para redigir a recomendação. */
export type Papel = "rapido" | "forte";

export type Rota = { nome: string; apiKey: string };

const MODELOS_PADRAO: Record<Papel, string[]> = {
  rapido: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  forte: ["gemini-3.8-flash", "gemini-3.6-flash"],
};

function lista(valor: string | undefined): string[] {
  return (valor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Rota principal: GEMINI_API_KEY (chave do hackathon).
 * Rota de reserva: GEMINI_API_KEY_RESERVA (chave pessoal), só depois de esgotar a principal.
 */
export function rotasDoAmbiente(env: NodeJS.ProcessEnv = process.env): Rota[] {
  const rotas: Rota[] = [];
  if (env.GEMINI_API_KEY) rotas.push({ nome: "principal", apiKey: env.GEMINI_API_KEY });
  if (env.GEMINI_API_KEY_RESERVA && env.GEMINI_API_KEY_RESERVA !== env.GEMINI_API_KEY) {
    rotas.push({ nome: "reserva", apiKey: env.GEMINI_API_KEY_RESERVA });
  }
  return rotas;
}

export function modelosDoPapel(papel: Papel, env: NodeJS.ProcessEnv = process.env): string[] {
  const doEnv = lista(papel === "rapido" ? env.IA_MODELOS_RAPIDO : env.IA_MODELOS_FORTE);
  return doEnv.length ? doEnv : MODELOS_PADRAO[papel];
}

/** Ordem de tentativa: todos os modelos da rota principal, depois os da reserva. */
export function alvosDoPapel(papel: Papel, rotas: readonly Rota[], env: NodeJS.ProcessEnv = process.env): Alvo[] {
  const modelos = modelosDoPapel(papel, env);
  return rotas.flatMap((r) => modelos.map((modelo) => ({ rota: r.nome, modelo })));
}

export function timeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.IA_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}
