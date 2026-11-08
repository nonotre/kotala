// Confere a resposta do Assistente contra o que as ferramentas devolveram neste turno.
// Mesma ideia do Comparador: a IA redige, mas valor, pedido e link que não vieram dos dados
// derrubam o texto. Links ruins são só tirados (viram texto); números e afirmações de ação
// reprovam a resposta, e o agente tenta de novo ou cai num texto seguro.

import { PREFIXO_LINK, rotaPermitida, type Botao } from "./tipos.ts";

export type Validacao = { ok: boolean; problemas: string[]; texto: string };

/** Tudo o que veio das ferramentas (e do cartão de estado): números, ids e links conhecidos. */
export type Conhecidos = {
  /** Valores que podem aparecer como R$: campos numéricos de dado (não ids nem datas) e "R$ x" escritos nos textos dos dados. */
  numeros: Set<number>;
  pedidos: Set<number>;
  itens: Set<number>;
  /** "pedido:item" de cada item visto dentro do seu pedido: o link #item-N tem de ser do pedido certo. */
  itensDoPedido: Set<string>;
  /** "Pedido N" citado em texto (alerta de fornecedor, histórico, mensagem do comprador): vale no texto, não em link. */
  pedidosCitados: Set<number>;
  fornecedores: Set<string>;
  /** Só o que veio em campo de link (`href`, `link`): texto livre com URL (ex.: dúvida de fornecedor) não vira link confiável. */
  links: Set<string>;
};

/** R$ com milhar ("1.234,50") ou sem ("1234,50", "42"); o ponto final da frase não entra. */
const VALOR_BRL = /R\$\s?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/g;
/** "pedido 12", "pedidos 12, 13 e 14", "pedido nº 12", "pedido #12". */
const PEDIDO_N = /\bpedidos?\s+(?:n[º°o]\.?\s*)?#?\d+(?:\s*(?:,|e)\s*#?\d+)*/gi;
/** Link Markdown, com título opcional: [rótulo](href "título"). */
const LINK_MD = /\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
/** URL solta ou autolink, fora de link Markdown. */
const URL_SOLTA = /<?\bhttps?:\/\/[^\s<>)\]]+>?/g;
/**
 * Afirmação de que o próprio assistente agiu: ele nunca age, só oferece o botão.
 * "não aprovei" é negação e passa.
 */
const AFIRMA_ACAO = /(?<!n[ãa]o\s)(?<!nunca\s)\b(j[aá]\s+)?(aprovei|comprei|cancelei|confirmei|corrigi|alterei|fechei a compra|enviei o pedido de compra|reprovei|negociei)\b/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
/** Campos numéricos que são id, posição ou contagem, nunca valor em reais. */
const CHAVE_NAO_VALOR = /^(pedidoId|itemId|ordem|rodada|id|limite|periodoDias|compras|itens|fornecedores|simulados|comprasConfirmadas)$/i;
const CHAVE_LINK = /^(href|link|url)$/i;

function numerosDePedido(trecho: string): number[] {
  return [...trecho.matchAll(/\d+/g)].map((m) => Number(m[0]));
}

/** Junta números, ids e links de qualquer objeto devolvido pelas consultas (ou de texto do sistema). */
export function coletar(dados: unknown[]): Conhecidos {
  const c: Conhecidos = { numeros: new Set(), pedidos: new Set(), itens: new Set(), itensDoPedido: new Set(), pedidosCitados: new Set(), fornecedores: new Set(), links: new Set() };
  const visitar = (v: unknown, chave = "", pedidoAtual: number | null = null) => {
    if (v === null || v === undefined) return;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return;
      if (/^pedidoId$/i.test(chave)) c.pedidos.add(v);
      if (/^itemId$/i.test(chave)) {
        c.itens.add(v);
        if (pedidoAtual !== null) c.itensDoPedido.add(`${pedidoAtual}:${v}`);
      }
      if (!CHAVE_NAO_VALOR.test(chave)) c.numeros.add(Math.round(v * 100) / 100);
      return;
    }
    if (typeof v === "string") {
      if (UUID.test(v)) c.fornecedores.add(v);
      if (DATA_ISO.test(v)) return;
      if (CHAVE_LINK.test(chave) && /^(https?:\/\/|\/)/.test(v)) c.links.add(v);
      const h = /^\/pedidos\/(\d+)[^#]*#item-(\d+)$/.exec(v);
      if (h && CHAVE_LINK.test(chave)) c.itensDoPedido.add(`${h[1]}:${h[2]}`);
      for (const m of v.matchAll(PEDIDO_N)) for (const n of numerosDePedido(m[0])) c.pedidosCitados.add(n);
      // Em texto, só conta o que vem como dinheiro ("R$ 128,40 a mais"), não qualquer número.
      for (const m of v.matchAll(VALOR_BRL)) {
        const n = lerNumeroBr(m[1]!);
        if (n !== null) c.numeros.add(n);
      }
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => visitar(x, chave, pedidoAtual));
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      // Objeto com pedidoId é o contexto dos itens dentro dele (ResumoPedido.itens, MapaResumo).
      const pedido = typeof o.pedidoId === "number" ? o.pedidoId : pedidoAtual;
      for (const [k, x] of Object.entries(o)) visitar(x, k, pedido);
    }
  };
  dados.forEach((d) => visitar(d));
  return c;
}

/** Texto do comprador: só os pedidos que ele citou ("não achei o pedido 99"); valores e links dele não viram fonte. */
export function citadosPeloComprador(c: Conhecidos, textos: readonly string[]) {
  for (const t of textos) for (const m of t.matchAll(PEDIDO_N)) for (const n of numerosDePedido(m[0])) c.pedidosCitados.add(n);
}

/** "1.234,50" → 1234.5; "1234.5" → 1234.5; "R$ 42" → 42. */
export function lerNumeroBr(s: string): number | null {
  const t = s.trim();
  let n: number;
  if (/,\d{1,2}$/.test(t)) n = Number(t.replace(/\./g, "").replace(",", "."));
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) n = Number(t.replace(/\./g, ""));
  else n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** A rota interna existe nos dados? Pedido, item (do pedido certo) e fornecedor do link têm de ter vindo das ferramentas. */
export function linkInternoValido(href: string, c: Conhecidos): boolean {
  if (!rotaPermitida(href)) return false;
  const p = /^\/pedidos\/(\d+)/.exec(href);
  if (p && !c.pedidos.has(Number(p[1]))) return false;
  const it = /#item-(\d+)$/.exec(href);
  if (it && !(p && c.itensDoPedido.has(`${p[1]}:${it[1]}`))) return false;
  const f = /^\/fornecedores\/([0-9a-f-]{36})$/.exec(href);
  if (f && !c.fornecedores.has(f[1]!)) return false;
  return true;
}

export function validarResposta(texto: string, botoes: readonly Botao[], c: Conhecidos): Validacao {
  const problemas: string[] = [];

  // Links Markdown: internos validados pela rota e pelos ids; externos só se vieram de campo de link dos dados.
  // Os aprovados ficam guardados para a busca de URL solta não pegá-los de novo.
  const aprovados: string[] = [];
  let limpo = texto.replace(LINK_MD, (inteiro, rotulo: string, href: string) => {
    const ok = href.startsWith("/") ? linkInternoValido(href, c) : c.links.has(href);
    if (!ok) {
      problemas.push(`link fora dos dados: ${href}`);
      return rotulo;
    }
    aprovados.push(inteiro);
    return `\u0000${aprovados.length - 1}\u0000`;
  });
  limpo = limpo.replace(URL_SOLTA, (inteiro) => {
    const url = inteiro.replace(/^<|>$/g, "");
    if (c.links.has(url)) return inteiro;
    problemas.push(`link fora dos dados: ${url}`);
    return "[link removido]";
  });
  limpo = limpo.replace(/\u0000(\d+)\u0000/g, (_, i: string) => aprovados[Number(i)]!);

  for (const m of limpo.matchAll(VALOR_BRL)) {
    const n = lerNumeroBr(m[1]!);
    if (n !== null && !temNumero(c, n)) problemas.push(`valor que não veio das ferramentas: ${m[0]}`);
  }
  for (const m of limpo.matchAll(PEDIDO_N)) {
    for (const n of numerosDePedido(m[0])) if (!c.pedidos.has(n) && !c.pedidosCitados.has(n)) problemas.push(`pedido que não veio das ferramentas: ${n}`);
  }
  if (AFIRMA_ACAO.test(limpo)) problemas.push("afirma ter agido; o assistente só oferece o botão");

  for (const b of botoes) {
    if (b.dado.startsWith(PREFIXO_LINK) && !linkInternoValido(b.dado.slice(PREFIXO_LINK.length), c)) problemas.push(`botão de link inválido: ${b.dado}`);
  }

  // Link tirado não reprova sozinho: o texto já está limpo. Número, pedido, afirmação de ação e botão ruim reprovam.
  const graves = problemas.filter((p) => !p.startsWith("link fora dos dados"));
  return { ok: graves.length === 0, problemas, texto: limpo };
}

/** Tolerância de centavos: o modelo arredonda "R$ 1.234,56" para "R$ 1.234,6" às vezes. */
function temNumero(c: Conhecidos, n: number): boolean {
  if (c.numeros.has(n)) return true;
  for (const x of c.numeros) if (Math.abs(x - n) <= 0.05) return true;
  return false;
}
