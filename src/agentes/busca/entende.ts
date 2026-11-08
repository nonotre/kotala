// Entende (R3): transforma o item em consultas de busca e em termos para o
// filtro. Só o item sai nas buscas: nada do comprador, do local ou do endereço.

import { z } from "zod";
import { gerarObjeto } from "../../nucleo/ia/index.ts";
import { conteudoNoTitulo } from "../../dominio/unidades.ts";
import { kgNoTitulo, type Termos } from "./filtro.ts";

const Saida = z.object({
  consultas: z.array(z.string()).describe("1 ou 2 consultas curtas de loja online, sem marca se o comprador não pediu"),
  grupos: z.array(z.array(z.string())).describe("Grupos de palavras: o título do produto precisa ter uma palavra de cada grupo"),
  proibidas: z.array(z.string()).describe("Palavras de produtos parecidos que não servem"),
  conteudo: z
    .object({ valor: z.number(), unidade: z.enum(["kg", "g", "l", "ml", "m", "folha", "un"]) })
    .nullable()
    .describe("Conteúdo por embalagem pedido, quando houver (saco de 50 kg = 50 kg; resma de 500 folhas; galão de 5 L)"),
});

export type Plano = { consultas: string[]; termos: Termos };

export function planoSimples(descricao: string): Plano {
  const palavras = descricao
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length > 2 && !/^(de|da|do|com|para)$/.test(p));
  return {
    consultas: [descricao],
    termos: { grupos: palavras.slice(0, 1).map((p) => [p]), proibidas: [], conteudoKg: kgNoTitulo(descricao), conteudo: conteudoNoTitulo(descricao) },
  };
}

export async function planejar(
  item: { descricao: string; unidade: string; especificacao: Record<string, string> },
  ctx: { pedidoId?: number; itemPedidoId?: number } = {},
): Promise<Plano> {
  const espec = Object.entries(item.especificacao)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  try {
    const r = await gerarObjeto({
      papel: "rapido",
      schema: Saida,
      sistema:
        "Você prepara buscas de preço em lojas online brasileiras. " +
        "Consultas curtas, como um comprador digitaria (ex.: 'papel a4 75g 500 folhas'). " +
        "Grupos: palavras que o título do produto certo sempre tem, com variações de escrita (ex.: [['papel'], ['a4']]). No máximo 3 grupos. " +
        "Proibidas: produtos que costumam aparecer na mesma busca e não servem (ex.: para papel: cartucho, impressora).",
      prompt: `Item: ${item.descricao}\nUnidade do pedido: ${item.unidade}${espec ? `\nEspecificação: ${espec}` : ""}`,
      contexto: { agente: "Busca", ...ctx },
    });
    const v = r.valor;
    const consultas = v.consultas.map((c) => c.trim()).filter(Boolean).slice(0, 2);
    const grupos = v.grupos.map((g) => g.map((p) => p.trim()).filter(Boolean)).filter((g) => g.length).slice(0, 3);
    if (!consultas.length || !grupos.length) return planoSimples(item.descricao);
    const conteudo = v.conteudo ?? conteudoNoTitulo(item.descricao);
    const conteudoKg = conteudo?.unidade === "kg" ? conteudo.valor : kgNoTitulo(item.descricao);
    return { consultas, termos: { grupos, proibidas: v.proibidas.slice(0, 10), conteudoKg, conteudo } };
  } catch {
    return planoSimples(item.descricao);
  }
}
