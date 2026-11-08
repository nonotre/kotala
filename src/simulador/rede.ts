// 3.1: trava de rede do simulador. Troca o fetch global por um que só deixa passar
// o banco local (127.0.0.1, localhost) e o Gemini, este só quando a rodada usa IA real.
// Com a IA falsa (modo determinístico), as chamadas ao Gemini são respondidas aqui
// mesmo, sem sair da máquina. Qualquer outra chamada (Serper, VTEX, páginas de loja,
// BrasilAPI, Portal da Transparência, TJSP, Telegram) falha alto: o erro sobe para quem
// chamou e a tentativa fica anotada, para o relatório reprovar a rodada.
//
// Interruptor único: SIM_SEM_REDE=1. O `npm run simulador` liga sempre; o `npm run simular`
// (scripts/simular-comprador.ts) liga quando a variável está no ambiente, porque importa
// src/simulador/index.ts, que instala a trava ao carregar.
//
// Toda a rede do sistema passa pelo fetch global (src/agentes/busca/rede.ts → buscarHttp;
// o adaptador do Gemini lê globalThis.fetch na hora da chamada; o Postgres usa socket próprio,
// que não passa por aqui). Por isso a trava não precisa de nada fora desta pasta.

export const HOST_GEMINI = "generativelanguage.googleapis.com";
const HOSTS_LOCAIS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export type TentativaBloqueada = { url: string; metodo: string; quando: Date };

/** Responde no lugar do Gemini (IA falsa). Devolve null para deixar a trava decidir. */
export type RespondedorGemini = (url: URL, init: RequestInit | undefined) => Promise<Response | null>;

export type OpcoesTrava = {
  /** Deixa o Gemini real passar (rodada com IA real). Sem isto e sem `iaFalsa`, o Gemini também é bloqueado. */
  permitirGemini?: boolean;
  /** IA falsa: responde às chamadas ao Gemini sem rede. Tem prioridade sobre `permitirGemini`. */
  iaFalsa?: RespondedorGemini;
};

export class RedeBloqueada extends Error {
  constructor(url: string) {
    super(`Trava de rede do simulador: chamada a ${url} bloqueada (SIM_SEM_REDE). O simulador não sai para a internet.`);
    this.name = "RedeBloqueada";
  }
}

type Estado = {
  original: typeof fetch;
  opcoes: OpcoesTrava;
  bloqueadas: TentativaBloqueada[];
  geminiReais: number;
  geminiFalsas: number;
};

let estado: Estado | null = null;

function urlDe(entrada: Parameters<typeof fetch>[0]): URL | null {
  try {
    if (entrada instanceof URL) return entrada;
    if (typeof entrada === "string") return new URL(entrada);
    return new URL(entrada.url);
  } catch {
    return null;
  }
}

/**
 * Decide o destino de uma chamada, sem fazê-la. Puro, para os testes.
 * "local": banco e serviços da máquina; "gemini": a IA; "bloqueada": todo o resto.
 */
export function destinoDaChamada(url: URL | null): "local" | "gemini" | "bloqueada" {
  if (!url) return "bloqueada";
  if (HOSTS_LOCAIS.has(url.hostname)) return "local";
  if (url.hostname === HOST_GEMINI && url.protocol === "https:") return "gemini";
  return "bloqueada";
}

/**
 * Liga a trava (uma vez por processo; chamar de novo só troca as opções).
 * Devolve o estado vivo, para o relatório ler as tentativas bloqueadas e as chamadas ao Gemini.
 */
export function instalarTravaDeRede(opcoes: OpcoesTrava = {}) {
  if (estado) {
    estado.opcoes = opcoes;
    return estado;
  }
  const original = globalThis.fetch;
  const novo: Estado = { original, opcoes, bloqueadas: [], geminiReais: 0, geminiFalsas: 0 };
  estado = novo;
  globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = urlDe(entrada);
    const destino = destinoDaChamada(url);
    if (destino === "local") return novo.original(entrada, init);
    if (destino === "gemini") {
      if (novo.opcoes.iaFalsa) {
        const r = await novo.opcoes.iaFalsa(url!, init);
        if (r) {
          novo.geminiFalsas++;
          return r;
        }
      }
      if (novo.opcoes.permitirGemini) {
        novo.geminiReais++;
        return novo.original(entrada, init);
      }
    }
    const texto = url ? `${url.protocol}//${url.host}${url.pathname}` : String(entrada);
    novo.bloqueadas.push({ url: texto, metodo: init?.method ?? "GET", quando: new Date() });
    console.error(`[trava de rede] bloqueada: ${init?.method ?? "GET"} ${texto}`);
    throw new RedeBloqueada(texto);
  }) as typeof fetch;
  return novo;
}

/** Estado da trava, se ligada. */
export const travaDeRede = () => estado;

/** Desliga a trava e devolve o fetch original (testes). */
export function desinstalarTravaDeRede() {
  if (!estado) return;
  globalThis.fetch = estado.original;
  estado = null;
}

/** Zera os contadores (o simulador faz isso a cada cenário, para o relatório ser por cenário). */
export function zerarContadoresDeRede() {
  if (!estado) return;
  estado.bloqueadas.length = 0;
  estado.geminiReais = 0;
  estado.geminiFalsas = 0;
}

/** O interruptor: SIM_SEM_REDE=1 (ou "sim", "true"). */
export const semRedeLigado = (env: NodeJS.ProcessEnv = process.env) => /^(1|sim|true)$/i.test(env.SIM_SEM_REDE ?? "");
