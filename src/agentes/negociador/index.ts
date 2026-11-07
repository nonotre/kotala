// X3: Agente Negociador. Quando o comprador acha o preço alto, volta a quem
// vale a pena com uma contraproposta. Regras em código: só cita número real
// (o melhor custo recebido ou a referência pública), nunca inventa proposta
// nem concorrente, não revela quem ofereceu o quê e para em MAX_RODADAS.
// O comprador continua decidindo.

import { formatarBRL, ultimoMapa } from "../comparador/index.ts";
import { referenciasDoItem } from "../busca/internet.ts";
import { quantidade } from "../../texto.ts";

export const MAX_RODADAS = 3;
/** Quantos fornecedores no máximo recebem a contraproposta. */
const MAX_ALVOS = 3;

export type PlanoNegociacao = {
  rodada: number;
  alvos: string[];
  /** Melhor custo total válido recebido (número real, citado sem dizer de quem é). */
  melhorCusto: number | null;
  /** Preço de referência público por unidade, quando só há uma proposta válida. */
  referencia: number | null;
  motivo: string;
};

export type Recusa = { motivo: string };

/** Escolhe quem recebe a contraproposta. null se não há o que negociar. */
export async function planejarNegociacao(itemPedidoId: number, rodadaAtual: number): Promise<PlanoNegociacao | Recusa> {
  if (rodadaAtual >= MAX_RODADAS) return { motivo: `Já foram ${MAX_RODADAS} rodadas: é o limite para não cansar os fornecedores.` };
  const mapa = await ultimoMapa(itemPedidoId);
  const validas = mapa?.comparacao.validas ?? [];
  if (!validas.length) return { motivo: "Não há proposta válida para negociar." };

  const maisBarata = validas.reduce((a, b) => (b.custo! < a.custo! ? b : a));
  if (validas.length === 1) {
    const { mediana } = await referenciasDoItem(itemPedidoId);
    return {
      rodada: rodadaAtual + 1,
      alvos: [validas[0]!.oferta.fornecedorId],
      melhorCusto: null,
      referencia: mediana,
      motivo: mediana ? "Só uma proposta válida: negocia contra a referência pública." : "Só uma proposta válida: pede para melhorar.",
    };
  }
  // Quem não é o mais barato e tem boa nota: se baixar, pode virar a melhor opção.
  const alvos = validas
    .filter((l) => l.oferta.id !== maisBarata.oferta.id)
    .sort((a, b) => (b.nota ?? 0) - (a.nota ?? 0))
    .slice(0, MAX_ALVOS)
    .map((l) => l.oferta.fornecedorId);
  return {
    rodada: rodadaAtual + 1,
    alvos,
    melhorCusto: maisBarata.custo,
    referencia: null,
    motivo: `Contraproposta a ${alvos.length} ${alvos.length === 1 ? "fornecedor" : "fornecedores"}, citando o melhor custo total recebido.`,
  };
}

export function textoNegociacao(
  nome: string,
  item: { id: number; quantidade: string | number; unidade: string; descricao: string },
  plano: Pick<PlanoNegociacao, "melhorCusto" | "referencia">,
  respostaAte: string | null,
): string {
  const linhas = [
    `Olá, ${nome}! Obrigado pela proposta para ${quantidade(item.quantidade, item.unidade)} de ${item.descricao} (cotação ${item.id}).`,
  ];
  if (plano.melhorCusto !== null) {
    linhas.push(`Recebemos uma condição total melhor: ${formatarBRL(plano.melhorCusto)}, somando produto e frete. Consegue melhorar o preço ou o frete?`);
  } else if (plano.referencia !== null) {
    linhas.push(`O preço de referência que encontramos na internet está em ${formatarBRL(plano.referencia)} por ${item.unidade}. Consegue chegar mais perto disso?`);
  } else {
    linhas.push("Consegue melhorar o preço ou o frete?");
  }
  linhas.push("Se ajudar, podemos combinar um pagamento mais rápido.");
  linhas.push("Se preferir manter a proposta, não precisa responder: ela continua valendo.");
  if (respostaAte) linhas.push(`Respondo ao comprador às ${respostaAte}.`);
  return linhas.join("\n");
}
