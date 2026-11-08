// Regras dos botões que valem para qualquer canal (U6, Q9).

/** Limite do Telegram para o dado de um botão: 64 bytes (acento conta 2). */
export const LIMITE_DADO_BYTES = 64;

export function conferirDado(dado: string): void {
  const bytes = Buffer.byteLength(dado, "utf8");
  if (bytes > LIMITE_DADO_BYTES) throw new Error(`Dado de botão com ${bytes} bytes (máximo ${LIMITE_DADO_BYTES}): ${dado}`);
}

/**
 * O que fazer com o teclado da mensagem depois do clique. Botões que só abrem
 * outra pergunta (aprovar, outras propostas, motivos, voltar, cancelar sem motivo)
 * deixam o mapa valendo; os que decidem tiram o teclado. Dado que não conhecemos
 * mantém o comportamento antigo: tira.
 */
export function tecladoAposClique(dado: string): "manter" | "tirar" {
  const m = /^item:\d+:([a-z_]+)(?::(.+))?$/.exec(dado);
  if (!m) return "tirar";
  const [, acao, extra] = m;
  if (acao === "aprovar" || acao === "outras" || acao === "motivos" || acao === "voltar") return "manter";
  if (acao === "cancelar" && !extra) return "manter";
  return "tirar";
}
