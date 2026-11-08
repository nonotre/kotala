// Perfil por categoria de compra, lido de categorias.json. O código só aplica
// as regras; o que é de construção, papelaria ou EPI está nos dados.

import { EMPRESA_NICHO } from "../config.ts";
import { readFileSync } from "node:fs";
import { normalizarUnidade, unidadeAceita } from "./unidades.ts";

export type Atributo = {
  chave: string;
  rotulo: string;
  pergunta: string;
  /** Respostas conhecidas: o fluxo as mostra como botões. */
  opcoes?: string[];
  /** "unidade": confere a unidade do item contra `unidadesAceitas`. */
  tipo?: "unidade";
  /** Só vale para itens cuja descrição bate (ex.: "cabo|fio" dentro de Elétrico). */
  quando?: string;
  /** Regex sem acento: o atributo está dito se bater na descrição, nas chaves ou nos valores da especificação. */
  reconhece?: string;
};

export type Categoria = {
  id: string;
  nome: string;
  /** Rótulo curto para exemplos ("papelaria"). */
  curto: string;
  /** false: não aparece no cadastro do fornecedor. */
  cadastro?: boolean;
  palavras: string[];
  sinonimos?: Record<string, string[]>;
  vazias?: string[];
  unidadesAceitas: string[];
  /** Quando existe, unidade fora das aceitas gera esta pergunta ("quantos m³ (ou toneladas)"). */
  perguntaUnidade?: string;
  atributos?: Atributo[];
  jargao?: { termo: string; significa: string }[];
  exemplos?: string[];
  /** Regex sem acento de atividade (CNAE) esperada de um fornecedor da categoria. */
  cnae: string[];
};

const ARQUIVO = new URL("./categorias.json", import.meta.url);
let cache: Categoria[] | null = null;

export function categorias(): Categoria[] {
  cache ??= (JSON.parse(readFileSync(ARQUIVO, "utf8")) as { categorias: Categoria[] }).categorias;
  return cache;
}

export const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function categoriaPorId(id: string): Categoria | null {
  return categorias().find((c) => c.id === id) ?? null;
}

/** Aceita id ("agregados") ou nome ("Agregados"). */
export function categoriaPorNome(nomeOuId: string): Categoria | null {
  const n = semAcento(nomeOuId).trim();
  return categorias().find((c) => c.id === n || semAcento(c.nome) === n) ?? null;
}

/** Categorias que o fornecedor pode escolher no cadastro (ordem alfabética). */
export function categoriasDoCadastro(): Categoria[] {
  return categorias()
    .filter((c) => c.cadastro !== false)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const regexes = new Map<string, RegExp>();
/** A palavra (ou expressão) aparece no texto como palavra inteira, no singular ou plural. */
function acha(texto: string, palavra: string): boolean {
  let r = regexes.get(palavra);
  if (!r) {
    r = new RegExp(`(?<![a-z0-9])${escapar(semAcento(palavra)).replace(/\s+/g, "\\s+")}(?:s|es)?(?![a-z0-9])`);
    regexes.set(palavra, r);
  }
  return r.test(texto);
}

/**
 * Categorias que o texto cita, da mais específica para a menos (pelo tamanho das
 * palavras que bateram). Sem nenhuma: lista vazia (o item é "geral").
 */
export function detectarCategorias(texto: string): Categoria[] {
  const t = semAcento(texto);
  return categorias()
    .map((c) => ({ c, pontos: c.palavras.filter((p) => acha(t, p)).reduce((s, p) => s + p.length, 0) }))
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .map((x) => x.c);
}

/** Nome da categoria provável do item (o mesmo de fornecedor.categorias), ou null quando só `geral` serve. */
export function categoriaProvavel(texto: string): string | null {
  const c = detectarCategorias(texto).find((x) => x.id !== "geral");
  return c?.nome ?? null;
}

/** A categoria mais provável do texto; `geral` quando nada bate. */
export function detectarCategoria(texto: string): Categoria {
  return detectarCategorias(texto)[0] ?? categoriaPorId("geral")!;
}

type ItemDominio = { descricao: string; unidade?: string | null; quantidade?: number; especificacao?: Record<string, string> | { nome: string; valor: string }[] | null };

/** Regra de unidade da categoria do item, quando a unidade dita não serve. Devolve a pergunta pronta. */
export function regraDeUnidade(item: ItemDominio): { categoria: Categoria; pergunta: string } | null {
  const unidade = (item.unidade ?? "").trim();
  for (const c of detectarCategorias(item.descricao)) {
    if (!c.perguntaUnidade || unidadeAceita(unidade, c.unidadesAceitas)) continue;
    const dito = item.quantidade && item.quantidade > 0 ? `as ${item.quantidade} ${unidade}` : "o pedido";
    return { categoria: c, pergunta: `${item.descricao}: ${c.perguntaUnidade} são ${dito}?` };
  }
  return null;
}

export type AtributoFaltando = { categoria: string; chave: string; rotulo: string; pergunta: string; opcoes?: string[] };

/** O que a categoria exige e o item ainda não diz (Q4). Em código, sem IA. */
export function atributosFaltando(item: ItemDominio): AtributoFaltando[] {
  const descricao = semAcento(item.descricao);
  const e = item.especificacao ?? {};
  const espec = (Array.isArray(e) ? e.flatMap((x) => [x.nome, x.valor]) : Object.entries(e).flat()).join(" ");
  const texto = semAcento(`${item.descricao} ${espec}`);
  const faltando: AtributoFaltando[] = [];
  for (const c of detectarCategorias(item.descricao)) {
    for (const a of c.atributos ?? []) {
      if (a.quando && !new RegExp(a.quando).test(descricao)) continue;
      const dito = a.tipo === "unidade" ? !!normalizarUnidade(item.unidade ?? "") && unidadeAceita(item.unidade ?? "", c.unidadesAceitas) : new RegExp(a.reconhece ?? "$^").test(texto);
      if (!dito && !faltando.some((f) => f.chave === a.chave && f.categoria === c.id)) faltando.push({ categoria: c.id, chave: a.chave, rotulo: a.rotulo, pergunta: a.pergunta, ...(a.opcoes ? { opcoes: a.opcoes } : {}) });
    }
  }
  return faltando;
}

/** Atividade (CNAE) compatível com alguma das categorias. null quando nenhuma tem regra: não pune nem premia. */
export function atividadeCompativel(categoriasDoFornecedor: string[], atividade: string): { compativel: boolean; categoria: string } | null {
  const regras = categoriasDoFornecedor.map(categoriaPorNome).filter((c): c is Categoria => !!c && c.cnae.length > 0);
  if (!regras.length) return null;
  const a = semAcento(atividade);
  const bateu = regras.find((c) => c.cnae.some((r) => new RegExp(r).test(a)));
  return bateu ? { compativel: true, categoria: bateu.nome } : { compativel: false, categoria: regras.map((c) => c.nome).join(", ") };
}

/** Sinônimos de busca de todas as categorias (a palavra da esquerda conta também como as da direita). */
export function sinonimosDeBusca(): Record<string, string[]> {
  const todos: Record<string, string[]> = {};
  for (const c of categorias()) for (const [k, v] of Object.entries(c.sinonimos ?? {})) todos[k] = [...new Set([...(todos[k] ?? []), ...v])];
  return todos;
}

/** Palavras que não dizem nada sobre o produto, de todas as categorias. */
export function palavrasVazias(): Set<string> {
  return new Set(categorias().flatMap((c) => c.vazias ?? []));
}

/** Nicho da empresa: ids separados por vírgula em EMPRESA_NICHO (padrão `geral`). Só escolhe exemplos. */
export function categoriasDoNicho(): Categoria[] {
  const achadas = EMPRESA_NICHO().map(categoriaPorNome).filter((c): c is Categoria => !!c);
  return achadas.length ? achadas : [categoriaPorId("geral")!];
}

/** Exemplos para o chat, o Telegram e o cadastro, tirados do nicho (nunca limitam o que se pode pedir). */
export function exemplosDoNicho(): { pedidos: string[]; categorias: string[] } {
  const nicho = categoriasDoNicho();
  const geral = nicho.every((c) => c.id === "geral");
  const pedidos = nicho.flatMap((c) => c.exemplos ?? []);
  const usadas = geral ? ["escritorio", "limpeza", "hidraulica", "informatica"].map((id) => categoriaPorId(id)!) : nicho;
  const curtos = [...usadas, ...categoriasDoCadastro()].map((c) => c.curto);
  return { pedidos, categorias: [...new Set(curtos)].slice(0, 4) };
}
