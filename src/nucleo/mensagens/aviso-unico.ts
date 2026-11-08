// Rodada de testes de 08/11: o mesmo aviso do mesmo fornecedor chegava ao comprador uma vez por
// item (e às vezes duas): a mesma pergunta do CEP 6 vezes num pedido de 3 itens, o mesmo
// "pagamento fora do padrão" 5 vezes. Agora cada aviso vai uma vez por pedido. A conferência
// é feita nas mensagens já enviadas (tabela mensagem), não em memória: vale entre processos
// e depois de reiniciar.

import { and, eq } from "drizzle-orm";
import { db } from "../db/cliente.ts";
import { mensagem } from "../db/schema.ts";

/** Texto do aviso sem caixa, acentos, pontuação e espaços repetidos, para comparar. */
export function normalizarAviso(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Já foi ao comprador, neste pedido, um aviso com o mesmo texto (normalizado)? */
export function avisoRepetido(texto: string, enviados: string[]): boolean {
  const alvo = normalizarAviso(texto);
  return enviados.some((t) => normalizarAviso(t) === alvo);
}

/** Confere nas mensagens de saída ao comprador deste pedido. */
export async function avisoJaEnviado(compradorId: string, pedidoId: number, texto: string): Promise<boolean> {
  const linhas = await db
    .select({ texto: mensagem.texto })
    .from(mensagem)
    .where(and(eq(mensagem.contatoId, compradorId), eq(mensagem.pedidoId, pedidoId), eq(mensagem.direcao, "saida")));
  return avisoRepetido(texto, linhas.map((l) => l.texto));
}
