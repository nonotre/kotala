// X3: Agente Negociador. Quando o comprador acha o preço alto, volta a quem
// vale a pena com uma contraproposta. Regras em código:
// - nunca cita valor de outro fornecedor (proposta é dado sensível, regra da área de compras);
// - pode citar só a referência pública (preço publicado na internet), que não é proposta de ninguém;
// - nunca inventa proposta nem concorrente; para em MAX_RODADAS.
// Pede melhora em preço, frete e prazo de entrega, e oferece prazo de pagamento como troca.
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
  /** Melhor custo total válido recebido: guardado para o registro e o comprador, NUNCA vai na mensagem ao fornecedor. */
  melhorCusto: number | null;
  /** Preço de referência público por unidade (internet), o único valor que pode ser citado. */
  referencia: number | null;
  motivo: string;
};

export type Recusa = { motivo: string };

/** Escolhe quem recebe a contraproposta. null se não há o que negociar. */
export async function planejarNegociacao(itemPedidoId: number, rodadaAtual: number): Promise<PlanoNegociacao | Recusa> {
  if (rodadaAtual >= MAX_RODADAS) return { motivo: `Já foram ${MAX_RODADAS} rodadas: é o limite para não cansar os fornecedores.` };
  const mapa = await ultimoMapa(itemPedidoId);
  const todas = mapa?.comparacao.validas ?? [];
  if (!todas.length) return { motivo: "Não há proposta válida para negociar." };
  // Loja online não tem conversa: o preço do anúncio não se negocia por aqui.
  const validas = todas.filter((l) => !l.oferta.online);
  if (!validas.length) return { motivo: "As propostas são de lojas online: o preço do anúncio não se negocia por aqui." };

  const maisBarata = todas.reduce((a, b) => (b.custo! < a.custo! ? b : a));
  const { mediana } = await referenciasDoItem(itemPedidoId);
  if (validas.length === 1) {
    return {
      rodada: rodadaAtual + 1,
      alvos: [validas[0]!.oferta.fornecedorId],
      melhorCusto: maisBarata.custo,
      referencia: mediana,
      motivo: mediana ? "Só uma proposta válida: pede melhora citando a referência pública." : "Só uma proposta válida: pede para melhorar.",
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
    referencia: mediana,
    motivo: `Contraproposta a ${alvos.length} ${alvos.length === 1 ? "fornecedor" : "fornecedores"}, sem citar valor de outro fornecedor.`,
  };
}

export function textoNegociacao(
  nome: string,
  item: { id: number; quantidade: string | number; unidade: string; descricao: string },
  plano: Pick<PlanoNegociacao, "melhorCusto" | "referencia">,
  respostaAte: string | null,
): string {
  // Nunca cita valor de outro fornecedor: só a referência pública, quando houver.
  const linhas = [
    `Olá, ${nome}! Obrigado pela proposta para ${quantidade(item.quantidade, item.unidade)} de ${item.descricao} (cotação ${item.id}).`,
    "Estamos fechando esta compra e a sua proposta está entre as que estamos avaliando. Consegue melhorar a condição? Pode ser no preço, no frete ou no prazo de entrega.",
  ];
  if (plano.referencia !== null) {
    linhas.push(`Para referência, o preço publicado na internet para este item está em ${formatarBRL(plano.referencia)} por ${item.unidade}.`);
  }
  linhas.push("Se ajudar, podemos combinar a forma de pagamento que for melhor para você.");
  linhas.push("Se preferir manter a proposta, não precisa responder: ela continua valendo.");
  if (respostaAte) linhas.push(`Respondo ao comprador ${/^(às|em) /.test(respostaAte) ? respostaAte : `às ${respostaAte}`}.`);
  return linhas.join("\n");
}
