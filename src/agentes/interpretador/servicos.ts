// Cotação de serviços (instalação, manutenção, frete avulso, limpeza, aluguel...). O pedido de
// serviço é um pedido como outro: item com unidade de serviço (hora, diária, visita, mês ou
// serviço), quantidade e a cotação normal. O que muda é o mínimo que o fornecedor precisa para
// dar preço: o escopo (o que fazer), o local e o prazo. Funções puras, em código, sem IA.
// Os guardrails não mudam: serviço proibido (invadir sistema, documento falso...) continua barrado
// pela lista dura e pela classe "proibido", como qualquer item.

import { normalizarUnidade } from "../../dominio/unidades.ts";

/** Unidades de serviço, com o nome que vai na cotação. */
const UNIDADES_SERVICO: [RegExp, string][] = [
  [/^(h|hr|hrs|hs|horas?|homem[- ]hora|hh)$/, "hora"],
  [/^(diarias?|dias? de servico|diaria de servico)$/, "diária"],
  [/^(visitas?|visita tecnica|chamados?|atendimentos?)$/, "visita"],
  [/^(mes|meses|mensal|mensalidade|contrato mensal)$/, "mês"],
  [/^(servicos?|sv|vb|verba|empreitada|global|preco fechado|servico completo|frete|fretes|viagem avulsa)$/, "serviço"],
];

const limpa = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\.$/, "")
    .trim();

/** "h" vira "hora", "diárias" vira "diária", "vb" vira "serviço"; null se não é unidade de serviço. */
export function unidadeDeServico(unidade: string): string | null {
  const u = limpa(unidade);
  for (const [r, nome] of UNIDADES_SERVICO) if (r.test(u)) return nome;
  const n = normalizarUnidade(unidade);
  return n?.familia.startsWith("servico:") ? n.rotulo.replace(/^diaria$/, "diária").replace(/^mes$/, "mês").replace(/^servico$/, "serviço") : null;
}

/** O item é serviço: unidade de serviço, ou nome que começa por um serviço ("Instalação de...", "Frete de..."). */
const NOME_DE_SERVICO =
  /^(servi[cç]os?|instala[cç][aã]o|manuten[cç][aã]o|conserto|reparo|revis[aã]o|limpeza (de|do|da|dos|das|predial|p[oó]s)|frete|transporte|mudan[cç]a|dedetiza[cç][aã]o|desratiza[cç][aã]o|jardinagem|ro[cç]agem|pintura (de|do|da|predial|interna|externa)|m[aã]o de obra|loca[cç][aã]o|aluguel|montagem|desmontagem|calibra[cç][aã]o|recarga|vistoria|laudo t[eé]cnico|consultoria|treinamento|portaria|vigil[aâ]ncia|seguran[cç]a patrimonial|coleta|ca[cç]amba)\b/i;

export function ehServico(item: { descricao: string; unidade: string }): boolean {
  return unidadeDeServico(item.unidade) !== null || NOME_DE_SERVICO.test(item.descricao.trim());
}

type Espec = { nome: string; valor: string }[] | Record<string, string>;
const pares = (e: Espec | null | undefined) => (!e ? [] : Array.isArray(e) ? e.map((x) => [x.nome, x.valor] as const) : Object.entries(e));

/** O escopo está dito: especificação "Escopo" (ou equivalente) ou pelo menos duas especificações. */
export function temEscopo(item: { descricao: string; especificacao?: Espec | null }): boolean {
  const p = pares(item.especificacao).filter(([, v]) => v?.trim());
  if (p.some(([k]) => /escopo|o que fazer|servi[cç]o|detalhe|descri|atividade|tarefa/i.test(k))) return true;
  return p.length >= 2;
}

/**
 * O que falta para o fornecedor dar preço ao serviço: escopo de cada serviço e o prazo do pedido.
 * O local não é perguntado: sem local, vale o endereço padrão da empresa, como na entrega, e a
 * confirmação mostra "Local do serviço". No máximo uma pergunta de prazo por pedido.
 */
export function perguntasDoServico(
  itens: readonly { descricao: string; unidade: string; especificacao?: Espec | null }[],
  pedido: { prazoDias: number | null; prazoTexto: string | null },
  jaPerguntado: readonly string[] = [],
): string[] {
  const servicos = itens.filter(ehServico);
  if (!servicos.length) return [];
  const out: string[] = [];
  for (const s of servicos) {
    if (temEscopo(s)) continue;
    if (jaPerguntado.some((f) => /escopo|o que (exatamente )?(deve|precisa)/i.test(f) && f.includes(s.descricao))) continue;
    out.push(`${s.descricao}: o que exatamente deve ser feito (escopo, tamanho, quantos equipamentos ou cômodos)?`);
  }
  if (pedido.prazoDias === null && !pedido.prazoTexto && !jaPerguntado.some((f) => /prazo|quando/i.test(f))) out.push("Para quando precisa do serviço?");
  return out;
}

/** Pedido só de serviços (nenhum produto): a confirmação diz "Local do serviço" em vez de "Entrega". */
export const soServicos = (itens: readonly { descricao: string; unidade: string }[]) => itens.length > 0 && itens.every(ehServico);

/**
 * Normaliza o item de serviço lido pela IA: unidade de serviço com o nome da cotação e, quando a
 * unidade é "serviço" sem quantidade, 1 serviço (o tamanho vai no escopo). Devolve a suposição
 * a mostrar, se houver.
 */
export function normalizarServico<T extends { descricao: string; unidade: string; quantidade: number }>(it: T): { item: T; suposicao: string | null } {
  if (!ehServico(it)) return { item: it, suposicao: null };
  const unidade = unidadeDeServico(it.unidade) ?? (/^(un|unidade|unidades|)$/i.test(it.unidade.trim()) ? "serviço" : it.unidade);
  if (unidade === "serviço" && !(it.quantidade > 0)) return { item: { ...it, unidade, quantidade: 1 }, suposicao: `${it.descricao}: 1 serviço, com o tamanho no escopo` };
  return { item: { ...it, unidade }, suposicao: null };
}
