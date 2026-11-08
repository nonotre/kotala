// Confere a resposta do Assistente contra o que as ferramentas devolveram neste turno.
// Mesma ideia do Comparador: a IA redige, mas valor, pedido e link que não vieram dos dados
// derrubam o texto. Links ruins são só tirados (viram texto); números e afirmações de ação
// reprovam a resposta, e o agente tenta de novo ou cai num texto seguro.

import { PREFIXO_LINK, rotaPermitida, type Botao } from "./tipos.ts";

export type Validacao = { ok: boolean; problemas: string[]; texto: string };

/** Tudo o que veio das ferramentas (e do cartão de estado): números, ids e links conhecidos. */
export type Conhecidos = {
  numeros: Set<number>;
  pedidos: Set<number>;
  itens: Set<number>;
  /** "pedido:item" de cada item visto dentro do seu pedido: o link #item-N tem de ser do pedido certo. */
  itensDoPedido: Set<string>;
  /** "Pedido N" citado em texto (alerta de fornecedor, histórico, mensagem do comprador): vale no texto, não em link. */
  pedidosCitados: Set<number>;
  fornecedores: Set<string>;
  links: Set<string>;
};

const VALOR_BRL = /R\$\s?(\d[\d.]*(?:,\d{1,2})?)/g;
const PEDIDO_N = /\bpedido\s+(?:n[º°o]\s*)?#?(\d+)\b/gi;
const LINK_MD = /\[([^\]]+)\]\(([^)\s]+)\)/g;
/** Afirmação de que o próprio assistente agiu: ele nunca age, só oferece o botão. */
const AFIRMA_ACAO = /\b(j[aá]\s+)?(aprovei|comprei|cancelei|confirmei|fechei a compra|enviei o pedido de compra|reprovei|negociei)\b/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Junta números, ids e links de qualquer objeto devolvido pelas consultas. */
export function coletar(dados: unknown[]): Conhecidos {
  const c: Conhecidos = { numeros: new Set(), pedidos: new Set(), itens: new Set(), itensDoPedido: new Set(), pedidosCitados: new Set(), fornecedores: new Set(), links: new Set() };
  const visitar = (v: unknown, chave = "", pedidoAtual: number | null = null) => {
    if (v === null || v === undefined) return;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return;
      c.numeros.add(Math.round(v * 100) / 100);
      if (/^pedidoId$/i.test(chave)) c.pedidos.add(v);
      if (/^itemId$/i.test(chave)) {
        c.itens.add(v);
        if (pedidoAtual !== null) c.itensDoPedido.add(`${pedidoAtual}:${v}`);
      }
      return;
    }
    if (typeof v === "string") {
      if (UUID.test(v)) c.fornecedores.add(v);
      if (/^(https?:\/\/|\/)/.test(v)) c.links.add(v);
      const h = /^\/pedidos\/(\d+)[^#]*#item-(\d+)$/.exec(v);
      if (h) c.itensDoPedido.add(`${h[1]}:${h[2]}`);
      for (const m of v.matchAll(PEDIDO_N)) c.pedidosCitados.add(Number(m[1]));
      // Valores em texto ("R$ 1.234,50", "1234.5") também contam.
      for (const n of numerosDoTexto(v)) c.numeros.add(n);
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

/** "1.234,50" → 1234.5; "1234.5" → 1234.5; "R$ 42" → 42. */
export function lerNumeroBr(s: string): number | null {
  const t = s.trim();
  let n: number;
  if (/,\d{1,2}$/.test(t)) n = Number(t.replace(/\./g, "").replace(",", "."));
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) n = Number(t.replace(/\./g, ""));
  else n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function numerosDoTexto(s: string): number[] {
  return [...s.matchAll(/\d[\d.]*(?:,\d{1,2})?/g)].map((m) => lerNumeroBr(m[0])).filter((n): n is number => n !== null);
}

/** A rota interna existe nos dados? Pedido e fornecedor citados no link têm de ter vindo das ferramentas. */
function linkInternoValido(href: string, c: Conhecidos): boolean {
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

  // Links: internos validados pela rota e pelos ids; externos só se vieram dos dados (referência pública).
  const limpo = texto.replace(LINK_MD, (inteiro, rotulo: string, href: string) => {
    const ok = href.startsWith("/") ? linkInternoValido(href, c) : c.links.has(href);
    if (ok) return inteiro;
    problemas.push(`link fora dos dados: ${href}`);
    return rotulo;
  });

  for (const m of limpo.matchAll(VALOR_BRL)) {
    const n = lerNumeroBr(m[1]!);
    if (n !== null && !temNumero(c, n)) problemas.push(`valor que não veio das ferramentas: ${m[0]}`);
  }
  for (const m of limpo.matchAll(PEDIDO_N)) {
    if (!c.pedidos.has(Number(m[1])) && !c.pedidosCitados.has(Number(m[1]))) problemas.push(`pedido que não veio das ferramentas: ${m[0]}`);
  }
  if (AFIRMA_ACAO.test(limpo)) problemas.push("afirma ter agido; o assistente só oferece o botão");

  for (const b of botoes) {
    if (b.dado.startsWith(PREFIXO_LINK) && !linkInternoValido(b.dado.slice(PREFIXO_LINK.length), c)) problemas.push(`botão de link inválido: ${b.dado}`);
  }

  // Link tirado não reprova sozinho: o texto já está limpo. Número, pedido e afirmação de ação reprovam.
  const graves = problemas.filter((p) => !p.startsWith("link fora dos dados"));
  return { ok: graves.length === 0, problemas, texto: limpo };
}

/** Tolerância de centavos: o modelo arredonda "R$ 1.234,56" para "R$ 1.234,6" às vezes. */
function temNumero(c: Conhecidos, n: number): boolean {
  if (c.numeros.has(n)) return true;
  for (const x of c.numeros) if (Math.abs(x - n) <= 0.05) return true;
  return false;
}
