// X5: regras puras da sessão full duplex (transcrição, silêncio e tempo da ligação).
// Sem banco e sem IA: roda no navegador (web/components/Ligacao.tsx) e nos testes.

/** Teto da transcrição que vai ao servidor e ao rastro (a API interna aceita 20 kB por corpo). */
export const MAX_TRANSCRICAO = 12_000;
/** Silêncio do fornecedor (sem fala dele nem do agente) até o agente perguntar se ele ainda está na linha. */
export const SILENCIO_AVISO_MS = 15_000;
/** Silêncio total até a ligação ser encerrada. */
export const SILENCIO_ENCERRA_MS = 40_000;
/** Duração máxima da ligação; um minuto antes, o agente é avisado para fechar. */
export const DURACAO_MAX_MS = 8 * 60_000;
export const DURACAO_AVISO_MS = DURACAO_MAX_MS - 60_000;

/** Textos que o navegador manda ao agente como turno de sistema (o prompt explica cada um). */
export const AVISO_SILENCIO = "(silêncio na linha)";
export const AVISO_TEMPO = "(falta um minuto para o fim da ligação)";
export const AVISO_ATENDIDA = "(a ligação foi atendida)";

export type Quem = "agente" | "fornecedor";

/**
 * Acrescenta um pedaço de transcrição. O Live manda a fala aos pedaços (às vezes no meio
 * da palavra): o rótulo só entra quando muda quem fala, e o pedaço vai colado como veio.
 */
export function acrescentarFala(transcricao: string, quem: Quem, pedaco: string): string {
  if (!pedaco) return transcricao;
  const rotulo = `[${quem}]`;
  const ultimo = Math.max(transcricao.lastIndexOf("[agente]"), transcricao.lastIndexOf("[fornecedor]"));
  const mesmo = ultimo >= 0 && transcricao.startsWith(rotulo, ultimo);
  if (mesmo) return transcricao + pedaco;
  return `${transcricao}${transcricao ? "\n" : ""}${rotulo} ${pedaco.trimStart()}`;
}

/**
 * Corta a transcrição para caber no rastro: guarda o começo (apresentação) e, sobretudo, o
 * fim (onde estão a confirmação dos valores e o pedido de desconto).
 */
export function cortarTranscricao(t: string, max = MAX_TRANSCRICAO): string {
  if (t.length <= max) return t;
  const inicio = Math.floor(max * 0.2);
  const marca = "\n[…]\n";
  return t.slice(0, inicio) + marca + t.slice(t.length - (max - inicio - marca.length));
}

/** Só as falas de um lado (para conferir o que o fornecedor disse ou o que o agente falou). */
export function falasDe(transcricao: string, quem: Quem): string {
  const out: string[] = [];
  for (const linha of transcricao.split("\n")) {
    if (linha.startsWith(`[${quem}] `)) out.push(linha.slice(quem.length + 3));
  }
  return out.join("\n");
}

export type AcaoDaSessao = "nada" | "avisar_silencio" | "encerrar_silencio" | "avisar_tempo" | "encerrar_tempo";

/**
 * O que fazer agora, olhando o relógio. `ultimaAtividade` é a última fala de qualquer lado
 * (o agente falando conta: não é silêncio). Uma ação por vez; os avisos saem uma vez só.
 */
export function acaoDaSessao(s: {
  agora: number;
  inicio: number;
  ultimaAtividade: number;
  agenteFalando: boolean;
  avisouSilencio: boolean;
  avisouTempo: boolean;
}): AcaoDaSessao {
  const duracao = s.agora - s.inicio;
  if (duracao >= DURACAO_MAX_MS) return "encerrar_tempo";
  if (duracao >= DURACAO_AVISO_MS && !s.avisouTempo) return "avisar_tempo";
  if (s.agenteFalando) return "nada";
  const calado = s.agora - s.ultimaAtividade;
  if (calado >= SILENCIO_ENCERRA_MS) return "encerrar_silencio";
  if (calado >= SILENCIO_AVISO_MS && !s.avisouSilencio) return "avisar_silencio";
  return "nada";
}

export type MotivoFim = "desligou" | "silencio" | "tempo" | "queda" | "erro" | "saiu";

export const TEXTO_FIM: Record<MotivoFim, string> = {
  desligou: "Ligação encerrada.",
  silencio: "Ligação encerrada: ninguém respondeu na linha.",
  tempo: "Ligação encerrada: chegou ao tempo máximo.",
  queda: "A ligação caiu. O que já foi registrado continua valendo; dá para ligar de novo.",
  erro: "A ligação terminou com erro.",
  saiu: "Ligação encerrada ao sair da página.",
};

/** Resposta da ferramenta sempre com a mesma forma, mesmo quando o servidor falha. */
export function respostaDaFerramenta(r: unknown): { ok: boolean; resposta: string } {
  const o = (r ?? {}) as { ok?: unknown; resposta?: unknown };
  if (typeof o.resposta === "string" && o.resposta.trim()) return { ok: o.ok === true, resposta: o.resposta };
  return { ok: false, resposta: "Não consegui registrar agora. Diga que o comprador retorna por mensagem e encerre." };
}
