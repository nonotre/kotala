import type { Alvo } from "./reserva.ts";

/**
 * Papel decide a cadeia de modelos: "rapido" para extrair e classificar, "forte" para redigir a recomendação.
 * "conversa" e "conversa_forte" são do Assistente do chat (o forte entra em pergunta difícil);
 * "juiz" avalia conversas em lote, fora do chat (latência não importa).
 */
export type Papel = "rapido" | "forte" | "conversa" | "conversa_forte" | "juiz";

export type Rota = { nome: string; apiKey: string };

const MODELOS_PADRAO: Record<Papel, string[]> = {
  rapido: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  forte: ["gemini-3.8-flash", "gemini-3.6-flash"],
  // Benchmark de 08/11/2026 (docs/frente-3-harness.md): 3.5-flash-lite acertou 14/14 em ~1,2 s por turno.
  conversa: ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.1-flash-lite"],
  conversa_forte: ["gemini-3.8-flash", "gemini-3.5-flash"],
  juiz: ["gemini-4-argon", "gemini-3.8-flash"],
};

const VARIAVEL_DO_PAPEL: Record<Papel, string> = {
  rapido: "IA_MODELOS_RAPIDO",
  forte: "IA_MODELOS_FORTE",
  conversa: "IA_MODELOS_CONVERSA",
  conversa_forte: "IA_MODELOS_CONVERSA_FORTE",
  juiz: "IA_MODELOS_JUIZ",
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
  const doEnv = lista(env[VARIAVEL_DO_PAPEL[papel]]);
  return doEnv.length ? doEnv : MODELOS_PADRAO[papel];
}

/** Ordem de tentativa: todos os modelos da rota principal, depois os da reserva. */
export function alvosDoPapel(papel: Papel, rotas: readonly Rota[], env: NodeJS.ProcessEnv = process.env, modelosFixos?: readonly string[]): Alvo[] {
  const modelos = modelosFixos?.length ? modelosFixos : modelosDoPapel(papel, env);
  return rotas.flatMap((r) => modelos.map((modelo) => ({ rota: r.nome, modelo })));
}

export function timeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.IA_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}
