// Reconhece pedido de descadastro. Puro, para testar sem banco.

const PALAVRAS = ["parar", "pare", "para de mandar", "stop", "sair", "descadastrar", "cancelar inscricao", "nao quero mais receber"];

function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Só a mensagem curta que é o próprio pedido conta ("PARAR", "pare por favor").
 * "Não pare a obra" ou uma proposta longa não contam: essas vão ao Extrator,
 * que também classifica "parar".
 */
export function ehPedidoDeParar(texto: string): boolean {
  const t = normalizar(texto);
  if (!t || t.split(" ").length > 6) return false;
  if (t === "/stop" || t === "/parar") return true;
  return PALAVRAS.some((p) => t === p || t.startsWith(`${p} `) || t.endsWith(` ${p}`));
}
