// X3 e I1: Agente Negociador. Pede desconto em toda cotação, uma vez por
// fornecedor e item, dentro da mensagem "Recebi sua proposta" (I1); quando o
// comprador acha o preço alto, volta aos fornecedores com mais uma rodada (botão).
// Regras em código:
// - nunca cita valor de outro fornecedor (proposta é dado sensível, regra da área de compras);
// - pode citar só a referência pública (preço publicado na internet), e só quando o preço
//   do próprio fornecedor está acima dela; e os valores da própria proposta dele;
// - nunca diz a posição no ranking, nunca promete compra nem forma de pagamento;
// - a conta do desconto é do código, nunca da IA; para em MAX_RODADAS.
// O comprador continua decidindo.

import { and, eq, sql } from "drizzle-orm";
import { formatarBRL, ultimoMapa, type Linha } from "../comparador/index.ts";
import { referenciasDoItem } from "../busca/internet.ts";
import { db } from "../../nucleo/db/cliente.ts";
import { historicoCompra, oferta } from "../../nucleo/db/schema.ts";
import { semAcento } from "../guardrail/index.ts";
import { quando, quantidade } from "../../texto.ts";

export const MAX_RODADAS = 3;
/** Quantos fornecedores no máximo recebem a contraproposta do botão. */
const MAX_ALVOS = 3;
/** I1: janela para responder ao pedido de desconto, em fração do prazo de respostas (candidata a config.ts, Frente 1). */
export const NEGOCIACAO_ESPERA_FRACAO = 0.25;
/** I1: com menos que esta fração do prazo restante, não pede desconto (o comprador tem o botão). */
export const NEGOCIACAO_RESTANTE_MIN = 0.1;
/** Prazo de pagamento abaixo do qual vale perguntar por prazo maior, em dias. */
export const PRAZO_PAGAMENTO_PADRAO = 28;
/** Alavancas por mensagem, no máximo: mensagem curta. */
export const MAX_ALAVANCAS = 2;
/** Frase da Ester; é também o texto mínimo quando o validador barra o texto montado. */
export const TEXTO_PEDIDO_DESCONTO = "Por gentileza, conseguiria desconto na cotação?";
export const TEXTO_MANTEVE = "Combinado, mantenho a proposta como está. Obrigado!";

export type PlanoNegociacao = {
  rodada: number;
  alvos: string[];
  /** Melhor custo total válido recebido: guardado para o registro e o comprador, NUNCA vai na mensagem ao fornecedor. */
  melhorCusto: number | null;
  /** Preço de referência público por unidade (internet), o único valor de fora que pode ser citado. */
  referencia: number | null;
  motivo: string;
};

export type Recusa = { motivo: string };

// ---------- Registro antes e depois (oferta.extraido.negociacao) ----------

export type Alavanca = "recompra" | "volume" | "pagamento" | "frete" | "entregas";

/** Condição da proposta num instante: o "antes" e o "depois" do pedido de desconto. */
export type CondicaoProposta = {
  precoUnitario: number | null;
  totalProduto: number | null;
  frete: number | null;
  prazoDias: number | null;
  pagamento: string | null;
  prazoPagamentoDias: number | null;
  impostosValor: number | null;
};

export type ResultadoNegociacao = "desconto" | "manteve" | "subiu" | "condicional" | "sem_resposta";

/**
 * Marca do pedido automático de desconto, em `oferta.extraido.negociacao` (sem migração).
 * Vai de oferta em oferta quando o fornecedor manda outra mensagem na mesma rodada.
 */
export type MarcaNegociacao = {
  pedidaEm: string;
  janelaAte: string;
  rodadaAuto: 1;
  alavancas: Alavanca[];
  /** Referência pública citada no pedido (null se não citou). */
  referenciaCitada: number | null;
  /** A proposta como estava quando o desconto foi pedido. */
  antes: CondicaoProposta;
  respondidaEm?: string;
  resultado?: ResultadoNegociacao;
  depois?: CondicaoProposta;
  /** Total do produto (sem frete) antes e depois, calculado em código. */
  produtoAntes?: number | null;
  produtoDepois?: number | null;
  /** Quanto baixou (positivo) ou subiu (negativo), em reais. */
  descontoProduto?: number;
  descontoFrete?: number;
  /** Desconto condicionado, como o fornecedor escreveu ("3% à vista"); não aplicado ao preço. */
  condicao?: string;
  /** Disse que o preço está no limite: o botão do comprador não volta a ele. */
  firme?: boolean;
};

const centavos = (v: number) => Math.round(v * 100) / 100;

/** Total do produto, sem frete: o total informado ou o unitário vezes a quantidade. */
export function produtoDe(c: Pick<CondicaoProposta, "precoUnitario" | "totalProduto">, qtd: number): number | null {
  if (c.totalProduto !== null) return centavos(c.totalProduto);
  if (c.precoUnitario !== null) return centavos(c.precoUnitario * qtd);
  return null;
}

/** Preço por unidade da proposta (o informado, ou o total dividido pela quantidade). */
export function unitarioDe(c: Pick<CondicaoProposta, "precoUnitario" | "totalProduto">, qtd: number): number | null {
  if (c.precoUnitario !== null) return c.precoUnitario;
  if (c.totalProduto !== null && qtd > 0) return c.totalProduto / qtd;
  return null;
}

/** Condição da proposta a partir de uma linha de `oferta` (numeric vem como texto). */
export function condicaoDaOferta(o: {
  precoUnitario: string | null;
  totalProduto: string | null;
  frete: string | null;
  prazoDias: number | null;
  pagamento: string | null;
  prazoPagamentoDias: number | null;
  impostosValor: string | null;
}): CondicaoProposta {
  const n = (v: string | null) => (v === null ? null : Number(v));
  return {
    precoUnitario: n(o.precoUnitario),
    totalProduto: n(o.totalProduto),
    frete: n(o.frete),
    prazoDias: o.prazoDias,
    pagamento: o.pagamento,
    prazoPagamentoDias: o.prazoPagamentoDias,
    impostosValor: n(o.impostosValor),
  };
}

/** Lê a marca do `extraido` (jsonb sem tipo). */
export function marcaDe(extraido: unknown): MarcaNegociacao | null {
  const m = (extraido as { negociacao?: MarcaNegociacao } | null)?.negociacao;
  return m && typeof m.pedidaEm === "string" ? m : null;
}

/**
 * Fecha (ou atualiza) a marca com a proposta nova. Compara produto + frete em código:
 * baixou é "desconto", subiu é "subiu", igual é "manteve". Desconto condicionado não
 * muda o preço e vira "condicional".
 */
export function resultadoNegociacao(
  marca: MarcaNegociacao,
  depois: CondicaoProposta,
  qtd: number,
  p: { agora?: Date; condicao?: string | null; firme?: boolean } = {},
): MarcaNegociacao {
  const produtoAntes = produtoDe(marca.antes, qtd);
  const produtoDepois = produtoDe(depois, qtd);
  const descontoProduto = produtoAntes !== null && produtoDepois !== null ? centavos(produtoAntes - produtoDepois) : 0;
  const descontoFrete = marca.antes.frete !== null && depois.frete !== null ? centavos(marca.antes.frete - depois.frete) : 0;
  const total = centavos(descontoProduto + descontoFrete);
  let resultado: ResultadoNegociacao;
  if (total >= 0.01) resultado = "desconto";
  else if (total <= -0.01) resultado = "subiu";
  else if (p.condicao) resultado = "condicional";
  else resultado = "manteve";
  return {
    ...marca,
    respondidaEm: marca.respondidaEm ?? (p.agora ?? new Date()).toISOString(),
    resultado,
    depois,
    produtoAntes,
    produtoDepois,
    descontoProduto,
    descontoFrete,
    ...(p.condicao ? { condicao: p.condicao } : {}),
    ...(p.firme ? { firme: true } : {}),
  };
}

// ---------- Quando pedir (I1) ----------

export type SituacaoDesconto = {
  temPreco: boolean;
  /** Campos que faltaram na proposta (prazo, frete, pagamento, validade). */
  faltam: number;
  /** Preço ou item a confirmar (Q1). */
  aConfirmar: boolean;
  pedidoContato: boolean;
  /** Alertas do guardrail na mensagem (sem nota, comissão...): não é hora de negociar. */
  alertas: number;
  /** Já houve pedido automático a este fornecedor neste item, em qualquer rodada. */
  jaPedido: boolean;
  estadoItem: string;
  prazoRespostasEm: Date | null;
  /** Quando a cotação foi enviada a este fornecedor (começo do prazo). */
  inicio: Date | null;
  agora: Date;
  itemExato: boolean;
  aceitaSimilar: boolean;
  prazoDias: number | null;
  prazoMaxDias: number | null;
};

/** Até quando o fornecedor tem para responder ao desconto: 25% do prazo, sem passar do prazo. */
export function janelaDoDesconto(prazoRespostasEm: Date, inicio: Date, agora: Date): Date {
  const prazo = Math.max(0, prazoRespostasEm.getTime() - inicio.getTime());
  return new Date(Math.min(prazoRespostasEm.getTime(), agora.getTime() + prazo * NEGOCIACAO_ESPERA_FRACAO));
}

/** Todas as condições em código (seção 2.1 do desenho). Loja online nunca chega aqui: não tem cotação. */
export function deveNegociar(s: SituacaoDesconto): { ok: true; janelaAte: Date } | { ok: false; motivo: string } {
  if (!s.temPreco) return { ok: false, motivo: "sem preço" };
  if (s.faltam > 0) return { ok: false, motivo: "proposta incompleta: o desconto espera a proposta completar" };
  if (s.aConfirmar) return { ok: false, motivo: "preço ou item a confirmar" };
  if (s.pedidoContato) return { ok: false, motivo: "o fornecedor pediu para falar com uma pessoa" };
  if (s.alertas > 0) return { ok: false, motivo: "mensagem com alerta" };
  if (s.jaPedido) return { ok: false, motivo: "já pedi desconto a este fornecedor neste item" };
  if (s.estadoItem !== "cotando") return { ok: false, motivo: "cotação fechada" };
  if (!s.prazoRespostasEm || !s.inicio) return { ok: false, motivo: "sem prazo de respostas" };
  const prazo = s.prazoRespostasEm.getTime() - s.inicio.getTime();
  const resta = s.prazoRespostasEm.getTime() - s.agora.getTime();
  if (prazo <= 0 || resta < prazo * NEGOCIACAO_RESTANTE_MIN) return { ok: false, motivo: "resta menos de 10% do prazo" };
  // Portões do comparador (calculo.ts): proposta que será cortada não vale a negociação.
  if (!s.itemExato && !s.aceitaSimilar) return { ok: false, motivo: "item diferente sem aceite de equivalente" };
  if (s.prazoMaxDias !== null && s.prazoDias !== null && s.prazoDias > s.prazoMaxDias) return { ok: false, motivo: "entrega depois do prazo do pedido" };
  return { ok: true, janelaAte: janelaDoDesconto(s.prazoRespostasEm, s.inicio, s.agora) };
}

// ---------- Texto do pedido de desconto ----------

/** Alavancas verdadeiras, na ordem de prioridade, no máximo MAX_ALAVANCAS. */
export function escolherAlavancas(f: {
  recompra: boolean;
  quantidade: number;
  prazoPagamentoDias: number | null;
  frete: number | null;
  entregas: string | null;
}): Alavanca[] {
  const todas: [Alavanca, boolean][] = [
    ["recompra", f.recompra],
    ["volume", f.quantidade > 1],
    ["pagamento", f.prazoPagamentoDias === null || f.prazoPagamentoDias < PRAZO_PAGAMENTO_PADRAO],
    ["frete", f.frete !== null && f.frete > 0],
    ["entregas", !!f.entregas?.trim()],
  ];
  return todas.filter(([, v]) => v).map(([a]) => a).slice(0, MAX_ALAVANCAS);
}

/** A referência pública só entra quando o preço do fornecedor está acima dela: citar abaixo induz a subir. */
export function citarReferencia(precoUnitarioFornecedor: number | null, mediana: number | null): number | null {
  if (mediana === null || precoUnitarioFornecedor === null) return null;
  return precoUnitarioFornecedor - mediana >= 0.01 ? mediana : null;
}

/** O que o texto do pedido recebe. Sem melhor custo nem dado de outro fornecedor: o compilador impede o vazamento. */
export type ContextoDesconto = {
  alavancas: Alavanca[];
  quantidade: number | string;
  unidade: string;
  /** Frete da própria proposta. */
  frete: number | null;
  /** Já filtrada por citarReferencia. */
  referencia: number | null;
  janelaAte: Date;
  agora?: Date;
};

function fraseAlavanca(a: Alavanca, c: ContextoDesconto): string {
  switch (a) {
    case "recompra":
      return "Já compramos com vocês antes e queremos manter a parceria.";
    case "volume":
      return `Se a compra for fechada com vocês, a quantidade é de ${quantidade(c.quantidade, c.unidade)} de uma vez: há desconto por volume?`;
    case "pagamento":
      return "Há desconto para pagamento à vista, ou prazo maior no boleto?";
    case "frete":
      return `O frete de ${formatarBRL(c.frete ?? 0)} pode ser reduzido ou incluído no preço?`;
    case "entregas":
      return "Aceitamos entrega em partes, se ajudar.";
  }
}

const ate = (d: Date, agora?: Date) => quando(d, agora).replace(/^(às|em) /, "");

/**
 * Bloco do pedido de desconto que vai dentro da mensagem "Recebi sua proposta".
 * Passa pelo validador; se falhar, cai no texto mínimo (a frase da Ester).
 */
export function montarNegociacao(c: ContextoDesconto): { texto: string; alavancas: Alavanca[]; permitidos: number[]; validado: boolean; motivos: string[] } {
  const permitidos = [c.frete, c.referencia].filter((v): v is number => v !== null);
  const linhas = [TEXTO_PEDIDO_DESCONTO, ...c.alavancas.map((a) => fraseAlavanca(a, c))];
  if (c.referencia !== null) linhas.push(`Para referência, o preço publicado na internet para este item está em ${formatarBRL(c.referencia)} por ${c.unidade}.`);
  linhas.push("Se não for possível, sem problema: a proposta continua valendo.");
  linhas.push(`Respondo ao comprador até ${ate(c.janelaAte, c.agora)}.`);
  const texto = linhas.join("\n");
  const v = validarTextoNegociacao(texto, permitidos);
  if (v.ok) return { texto, alavancas: c.alavancas, permitidos, validado: true, motivos: [] };
  return { texto: TEXTO_PEDIDO_DESCONTO, alavancas: [], permitidos: [], validado: false, motivos: v.motivos };
}

/** Palavras que nunca vão ao fornecedor num texto de negociação (sem acento, minúsculas). */
export const PALAVRAS_PROIBIDAS: { padrao: RegExp; motivo: string }[] = [
  { padrao: /concorr/, motivo: "fala de concorrente" },
  { padrao: /\boutr[oa]s? (fornecedor|empresa|loja|proposta|cotac)/, motivo: "fala de outro fornecedor" },
  { padrao: /\bmais (barat|car[oa])/, motivo: "compara preço com outros" },
  { padrao: /\bmelhor (oferta|proposta)\b/, motivo: "fala da melhor oferta" },
  { padrao: /\b(primeir|segund|terceir|ultim)[oa] (lugar|colocad)|\branking\b|\bposicao\b/, motivo: "diz a posição no ranking" },
  { padrao: /\b(vamos|iremos) (fechar|comprar)\b|\bfechamos com voce|\bcompra garantida|\bgarant\w* a compra/, motivo: "promete compra" },
  { padrao: /\bpagamos (a vista|antecipad)|\bpagamento garantido/, motivo: "promete forma de pagamento" },
];

/** Todos os valores em R$ citados no texto ("R$ 1.234,56" vira 1234.56). */
export function valoresEmReais(texto: string): number[] {
  const out: number[] = [];
  for (const m of texto.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)/g)) {
    out.push(Number(m[1]!.replace(/\./g, "").replace(",", ".")));
  }
  return out;
}

/**
 * Invariante de todo texto de negociação: só valores permitidos (referência pública e a
 * própria proposta do fornecedor) e nenhuma palavra proibida. Hoje confere o template;
 * amanhã é o validador do texto redigido por IA (I2).
 */
export function validarTextoNegociacao(texto: string, permitidos: readonly number[]): { ok: boolean; motivos: string[] } {
  const motivos: string[] = [];
  for (const v of valoresEmReais(texto)) {
    if (!permitidos.some((p) => Math.abs(p - v) < 0.005)) motivos.push(`valor não permitido (R$ ${v.toFixed(2).replace(".", ",")})`);
  }
  const t = semAcento(texto);
  for (const p of PALAVRAS_PROIBIDAS) if (p.padrao.test(t)) motivos.push(p.motivo);
  return { ok: motivos.length === 0, motivos };
}

// ---------- Leitura da resposta ao pedido (código, não IA) ----------

const VALOR_DESCONTO = String.raw`(?:\d+(?:[.,]\d+)?\s*%|R\$\s*\d+(?:[.,]\d+)?)`;
const CONDICAO = String.raw`(?:à vista|a vista|no pix|via pix|pagamento antecipado|antecipad[oa]|em dinheiro|no dinheiro|acima de|a partir de)`;
const CONDICIONAL = [
  new RegExp(String.raw`${VALOR_DESCONTO}[^.!?\n]{0,60}?${CONDICAO}`, "i"),
  new RegExp(String.raw`${CONDICAO}[^.!?\n]{0,60}?${VALOR_DESCONTO}`, "i"),
];

/** Desconto que depende de pagamento ou volume ("3% se for à vista"). Devolve o trecho, ou null. */
export function descontoCondicional(texto: string): string | null {
  const t = texto.replace(/\s+/g, " ").trim();
  for (const r of CONDICIONAL) {
    const m = r.exec(t);
    if (m) return m[0].trim().slice(0, 120);
  }
  return null;
}

/** "Vou ver com o gerente e já te falo": não fecha a janela nem gera resposta. */
export function vaiResponderDepois(texto: string): boolean {
  return /\b(vou (ver|verificar|consultar|falar|checar|conversar)|deixa eu ver|j[aá] te (falo|respondo|retorno|aviso)|te (retorno|respondo|aviso)|retorno (em|daqui|mais tarde|j[aá])|aguard[ea]|um momento|s[oó] um minuto)/i.test(texto);
}

/** Disse que o preço está no limite: fica fora da rodada do botão. */
export function mantemFirme(texto: string): boolean {
  return /(no limite|(é|e) o (m[ií]nimo|limite)|pre[cç]o final|[uú]ltimo pre[cç]o|n[aã]o (tem|h[aá]) como (baixar|melhorar|dar)|n[aã]o d[aá] (pra|para) (baixar|melhorar))/i.test(texto);
}

/** "Tiro R$ 2 no saco": o desconto em reais é por unidade, não sobre o total. */
export function descontoPorUnidade(texto: string): boolean {
  return /\b(cada|por (unidade|un|pe[cç]a|saco|metro|kg|litro|caixa|rolo|barra)|n[oa] (unidade|pe[cç]a|saco|metro|kg|litro|caixa|rolo|barra)|\/\s?un)\b/i.test(texto);
}

/**
 * "Faço 5% a menos" ou "tiro R$ 20": o novo preço é calculado aqui, nunca pela IA.
 * Percentual vale sobre o preço; valor em reais vale sobre o total do produto, ou por
 * unidade se o fornecedor disse. null quando não dá para aplicar com segurança.
 */
export function aplicarDesconto(
  c: Pick<CondicaoProposta, "precoUnitario" | "totalProduto">,
  d: { descontoPercentual: number | null; descontoValor: number | null },
  qtd: number | null,
  porUnidade = false,
): { precoUnitario: number | null; totalProduto: number | null; descricao: string } | null {
  if (d.descontoPercentual !== null) {
    const f = 1 - d.descontoPercentual / 100;
    if (!(f > 0 && f < 1)) return null;
    const total = c.totalProduto ?? (c.precoUnitario !== null && qtd ? c.precoUnitario * qtd : null);
    return {
      precoUnitario: c.precoUnitario !== null ? centavos(c.precoUnitario * f) : null,
      totalProduto: total !== null ? centavos(total * f) : null,
      descricao: `${String(d.descontoPercentual).replace(".", ",")}% sobre o preço`,
    };
  }
  if (d.descontoValor !== null) {
    if (porUnidade) {
      if (c.precoUnitario === null || d.descontoValor >= c.precoUnitario) return null;
      const u = centavos(c.precoUnitario - d.descontoValor);
      return { precoUnitario: u, totalProduto: qtd ? centavos(u * qtd) : null, descricao: `${formatarBRL(d.descontoValor)} por unidade` };
    }
    const total = c.totalProduto ?? (c.precoUnitario !== null && qtd ? c.precoUnitario * qtd : null);
    if (total === null || d.descontoValor >= total) return null;
    const novo = centavos(total - d.descontoValor);
    return { precoUnitario: qtd ? centavos(novo / qtd) : null, totalProduto: novo, descricao: `${formatarBRL(d.descontoValor)} no total` };
  }
  return null;
}

// ---------- Banco: contexto do fornecedor ----------

/** Uma rodada automática por fornecedor e item, em qualquer rodada: confere as marcas nas ofertas. */
export async function jaPediuDesconto(fornecedorId: string, itemPedidoId: number): Promise<boolean> {
  const [l] = await db
    .select({ id: oferta.id })
    .from(oferta)
    .where(and(eq(oferta.fornecedorId, fornecedorId), eq(oferta.itemPedidoId, itemPedidoId), sql`${oferta.extraido}->'negociacao'->>'pedidaEm' is not null`))
    .limit(1);
  return !!l;
}

/** Recompra: já houve compra com este fornecedor (histórico dele, nunca de concorrente). */
export async function compraramAntes(fornecedorId: string): Promise<boolean> {
  const [l] = await db.select({ id: historicoCompra.id }).from(historicoCompra).where(eq(historicoCompra.fornecedorId, fornecedorId)).limit(1);
  return !!l;
}

/** Quem disse que o preço está no limite, neste item. */
async function fornecedoresFirmes(itemPedidoId: number): Promise<Set<string>> {
  const linhas = await db
    .select({ fornecedorId: oferta.fornecedorId })
    .from(oferta)
    .where(and(eq(oferta.itemPedidoId, itemPedidoId), sql`${oferta.extraido}->'negociacao'->>'firme' = 'true'`));
  return new Set(linhas.map((l) => l.fornecedorId));
}

// ---------- Rodada do botão do comprador ----------

/**
 * Alvos da rodada do botão: a mais barata entra (decisão I1), depois as de melhor nota.
 * Loja online e quem disse que o preço está no limite ficam de fora.
 */
export function escolherAlvos(validas: readonly Pick<Linha, "oferta" | "nota" | "custo">[], firmes: ReadonlySet<string> = new Set()): string[] {
  const elegiveis = validas.filter((l) => !l.oferta.online && !firmes.has(l.oferta.fornecedorId));
  if (!elegiveis.length) return [];
  const maisBarata = elegiveis.reduce((a, b) => ((b.custo ?? Infinity) < (a.custo ?? Infinity) ? b : a));
  const resto = elegiveis.filter((l) => l !== maisBarata).sort((a, b) => (b.nota ?? 0) - (a.nota ?? 0));
  return [maisBarata, ...resto].slice(0, MAX_ALVOS).map((l) => l.oferta.fornecedorId);
}

/** Escolhe quem recebe a contraproposta do botão. */
export async function planejarNegociacao(itemPedidoId: number, rodadaAtual: number): Promise<PlanoNegociacao | Recusa> {
  if (rodadaAtual >= MAX_RODADAS) return { motivo: `Já foram ${MAX_RODADAS} rodadas: é o limite para não cansar os fornecedores.` };
  const mapa = await ultimoMapa(itemPedidoId);
  const todas = mapa?.comparacao.validas ?? [];
  if (!todas.length) return { motivo: "Não há proposta válida para negociar." };
  // Loja online não tem conversa: o preço do anúncio não se negocia por aqui.
  if (!todas.some((l) => !l.oferta.online)) return { motivo: "As propostas são de lojas online: o preço do anúncio não se negocia por aqui." };
  const alvos = escolherAlvos(todas, await fornecedoresFirmes(itemPedidoId));
  if (!alvos.length) return { motivo: "Os fornecedores com proposta válida já disseram que o preço está no limite." };
  const maisBarata = todas.reduce((a, b) => (b.custo! < a.custo! ? b : a));
  const { mediana } = await referenciasDoItem(itemPedidoId);
  return {
    rodada: rodadaAtual + 1,
    alvos,
    melhorCusto: maisBarata.custo,
    referencia: mediana,
    motivo: `Contraproposta a ${alvos.length} ${alvos.length === 1 ? "fornecedor" : "fornecedores"}, inclusive a proposta mais barata, sem citar valor de outro fornecedor.`,
  };
}

/**
 * Texto da rodada do botão. Recebe só a referência (já filtrada por citarReferencia para
 * este fornecedor): o melhor custo não entra no tipo.
 */
export function textoNegociacao(
  nome: string,
  item: { id: number; quantidade: string | number; unidade: string; descricao: string },
  plano: { referencia: number | null },
  respostaAte: string | null,
  rodada: { ultima: boolean } = { ultima: false },
): string {
  const linhas = [
    `Olá, ${nome}! Obrigado pela proposta para ${quantidade(item.quantidade, item.unidade)} de ${item.descricao} (cotação ${item.id}).`,
    `${rodada.ultima ? "Estamos fechando esta compra, numa última rodada" : "Estamos fechando esta compra e abrimos mais uma rodada"}: qual o melhor preço que consegue fazer? Pode ser no preço, no frete, no prazo de entrega ou na condição de pagamento.`,
  ];
  if (plano.referencia !== null) {
    linhas.push(`Para referência, o preço publicado na internet para este item está em ${formatarBRL(plano.referencia)} por ${item.unidade}.`);
  }
  linhas.push("Se preferir manter a proposta, não precisa responder: ela continua valendo.");
  if (respostaAte) linhas.push(`Respondo ao comprador até ${respostaAte.replace(/^(às|em) /, "")}.`);
  return linhas.join("\n");
}
