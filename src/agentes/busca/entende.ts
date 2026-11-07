// Entende (R3): transforma o item em consultas de busca e em termos para o
// filtro. Só o item sai nas buscas: nada do comprador, da obra ou do endereço.

import { z } from "zod";
import { gerarObjeto } from "../../nucleo/ia/index.ts";
import { kgNoTitulo, type Termos } from "./filtro.ts";

const Saida = z.object({
  consultas: z.array(z.string()).describe("1 ou 2 consultas curtas de loja online, sem marca se o comprador não pediu"),
  grupos: z.array(z.array(z.string())).describe("Grupos de palavras: o título do produto precisa ter uma palavra de cada grupo"),
  proibidas: z.array(z.string()).describe("Palavras de produtos parecidos que não servem"),
  conteudoKg: z.number().nullable().describe("Peso por embalagem pedido, em kg, quando houver (saco de 50 kg = 50)"),
});

export type Plano = { consultas: string[]; termos: Termos };

export function planoSimples(descricao: string): Plano {
  const palavras = descricao
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length > 2 && !/^(de|da|do|com|para)$/.test(p));
  return {
    consultas: [descricao],
    termos: { grupos: palavras.slice(0, 1).map((p) => [p]), proibidas: [], conteudoKg: kgNoTitulo(descricao) },
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
        "Você prepara buscas de preço em lojas online brasileiras de material de construção. " +
        "Consultas curtas, como um comprador digitaria (ex.: 'cimento cp ii 50kg'). " +
        "Grupos: palavras que o título do produto certo sempre tem, com variações de escrita (ex.: [['cimento'], ['cp ii', 'cpii', 'cp-ii', 'cp2']]). No máximo 3 grupos. " +
        "Proibidas: produtos que costumam aparecer na mesma busca e não servem (ex.: para areia: rejunte, argamassa, bacia).",
      prompt: `Item: ${item.descricao}\nUnidade do pedido: ${item.unidade}${espec ? `\nEspecificação: ${espec}` : ""}`,
      contexto: { agente: "Busca", ...ctx },
    });
    const v = r.valor;
    const consultas = v.consultas.map((c) => c.trim()).filter(Boolean).slice(0, 2);
    const grupos = v.grupos.map((g) => g.map((p) => p.trim()).filter(Boolean)).filter((g) => g.length).slice(0, 3);
    if (!consultas.length || !grupos.length) return planoSimples(item.descricao);
    return { consultas, termos: { grupos, proibidas: v.proibidas.slice(0, 10), conteudoKg: v.conteudoKg ?? kgNoTitulo(item.descricao) } };
  } catch {
    return planoSimples(item.descricao);
  }
}
