// Falas prontas das personas de cenário: o texto livre que um vendedor mandaria e, junto,
// a leitura certa dele (a verdade), que a IA falsa devolve no lugar do Extrator.
// Os textos evitam de propósito palavras que disparam outras regras em código
// (CNPJ, "Pix com desconto"), para cada cenário testar só o que declara.

import type { ContextoFala, Escrita, Fala, Gatilho, PersonaCenario, Verdade } from "./tipos.ts";

export const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const centavos = (v: number) => Math.round(v * 100) / 100;
const dias = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

/** Dias para pagar, como o Extrator leria (o schema dele diz "0 se à vista ou antecipado"): "boleto 28 dias" = 28. */
export function prazoPagamento(pagamento: string): number | null {
  if (/vista|pix|antecipad|sinal|entrada/i.test(pagamento)) return 0;
  const m = /(\d+)\s*dias/.exec(pagamento);
  return m ? Number(m[1]) : null;
}

function textoFrete(frete: number | null) {
  return frete === null ? "" : frete === 0 ? "Frete grátis." : `Frete R$ ${brl(frete)}.`;
}

/** Leitura de uma proposta completa (ou sem frete), do jeito que o Extrator deveria ler. */
function leituraProposta(c: ContextoFala, v: Verdade, unit: number, trecho: string): Escrita["leitura"] {
  const { item } = c;
  return {
    classificacao: "proposta",
    itemOferecido: item.descricao,
    aderencia: "exato",
    leituraPreco: "unitario",
    trechoPreco: trecho,
    precoUnitario: unit,
    totalProduto: centavos(unit * item.quantidade),
    quantidadeOfertada: item.quantidade,
    unidadeOfertada: item.unidade,
    frete: v.frete,
    prazoDias: v.prazoDias,
    validadeDias: v.validadeDias,
    pagamento: v.pagamento,
    prazoPagamentoDias: prazoPagamento(v.pagamento),
    entregaNoLocal: true,
    impostosNaoInclusos: "inclusos",
  };
}

function escreverProposta(c: ContextoFala, v: Verdade, unit: number, abertura: string): Escrita {
  const { item } = c;
  const qtd = `${item.quantidade} ${item.unidade}`;
  const trecho = `R$ ${brl(unit)} cada`;
  const texto =
    `${abertura} Pra ${qtd} de ${item.descricao} fica ${trecho} (total R$ ${brl(unit * item.quantidade)}). ${textoFrete(v.frete)} ` +
    `Entrego em ${dias(v.prazoDias)} no endereço. Pagamento ${v.pagamento}, proposta vale ${dias(v.validadeDias)}. Impostos inclusos.`;
  return { texto: texto.replace(/\s+/g, " ").trim(), leitura: leituraProposta(c, v, unit, trecho) };
}

/** Proposta com a verdade da persona. `semFrete`: esquece o frete (a proposta fica incompleta). */
export function proposta(opcoes: { atrasoSeg?: number; semFrete?: boolean } = {}): Fala {
  return {
    atrasoSeg: opcoes.atrasoSeg ?? 1,
    descricao: opcoes.semFrete ? "proposta sem frete" : "proposta completa",
    escrever: (c) => {
      const v = opcoes.semFrete ? { ...c.persona.verdade, frete: null } : c.persona.verdade;
      return escreverProposta(c, v, c.persona.verdade.preco, "Bom dia!");
    },
  };
}

/** Completa a proposta com o frete que faltou. */
export function completarFrete(atrasoSeg = 1): Fala {
  return {
    atrasoSeg,
    descricao: "completa o frete",
    escrever: (c) => {
      const frete = c.persona.verdade.frete ?? 0;
      return { texto: `Desculpe, faltou o frete: ${frete === 0 ? "grátis" : `R$ ${brl(frete)}`} até o endereço.`, leitura: { classificacao: "outro", frete } };
    },
  };
}

/** Resposta ao pedido de desconto: percentual no total, sem repetir o preço. */
export function descontoPercentual(pct: number, atrasoSeg = 1): Fala {
  return {
    atrasoSeg,
    descricao: `dá ${pct}% de desconto`,
    escrever: () => ({ texto: `Consigo ${pct}% de desconto no total, mantendo as outras condições.`, leitura: { classificacao: "outro", descontoPercentual: pct } }),
  };
}

/** Resposta ao pedido de desconto: proposta nova com o unitário menor. */
export function descontoNovoPreco(pct: number, atrasoSeg = 1): Fala {
  return {
    atrasoSeg,
    descricao: `baixa o unitário em ${pct}%`,
    escrever: (c) => escreverProposta(c, c.persona.verdade, centavos(c.persona.verdade.preco * (1 - pct / 100)), "Consegui melhorar."),
  };
}

/** Resposta ao pedido de desconto: não baixa. */
export function recusaDesconto(atrasoSeg = 1): Fala {
  return {
    atrasoSeg,
    descricao: "recusa o desconto",
    escrever: () => ({ texto: "Esse já é o preço final, não tem como baixar. Fico no aguardo.", leitura: { classificacao: "outro" } }),
  };
}

/** Manda proposta nova, mais cara que a anterior (preço que sobe). */
export function sobePreco(pct: number, atrasoSeg = 1): Fala {
  return {
    atrasoSeg,
    descricao: `sobe o unitário em ${pct}%`,
    escrever: (c) => escreverProposta(c, c.persona.verdade, centavos(c.persona.verdade.preco * (1 + pct / 100)), "Atualizando: o fabricante reajustou a tabela."),
  };
}

/** PARAR: sai da cotação (com cotação aberta, só dela). */
export function parar(atrasoSeg = 1): Fala {
  return { atrasoSeg, descricao: "PARAR", escrever: () => ({ texto: "PARAR" }) };
}

/** Toca o primeiro botão da mensagem recebida ("Confirmo" no pedido de compra). */
export function tocarPrimeiroBotao(atrasoSeg = 1): Fala {
  return {
    atrasoSeg,
    descricao: "toca o primeiro botão",
    escrever: (c) => {
      const b = c.recebida.botoes?.[0];
      return b ? { texto: "", botao: b.dado } : { texto: "Confirmo o pedido, vamos separar o material.", leitura: { classificacao: "outro" } };
    },
  };
}

/** Texto livre, com a leitura que a IA falsa deve devolver. */
export function texto(t: string, leitura?: Escrita["leitura"], atrasoSeg = 1): Fala {
  return { atrasoSeg, descricao: `"${t.slice(0, 40)}"`, escrever: () => ({ texto: t, ...(leitura ? { leitura } : {}) }) };
}

// ---------- Personas prontas ----------

/** Confirma o pedido de compra se ganhar (todo fornecedor de cenário faz isso, salvo outro roteiro). */
export const CONFIRMA_PEDIDO: Gatilho = { ao: "pedido_compra", falas: [tocarPrimeiroBotao()] };

/**
 * Persona que responde à cotação com a proposta e ao pedido automático de desconto do jeito dado
 * (padrão: recusa). Atraso da proposta em segundos.
 */
export function personaDireta(
  chave: string,
  nome: string,
  verdade: Verdade,
  opcoes: { atrasoSeg?: number; desconto?: Fala | null; extra?: Gatilho[] } = {},
): PersonaCenario {
  const roteiro: Gatilho[] = [{ ao: "cotacao", falas: [proposta({ atrasoSeg: opcoes.atrasoSeg ?? 1 })] }];
  const desconto = opcoes.desconto === undefined ? recusaDesconto() : opcoes.desconto;
  if (desconto) roteiro.push({ ao: "negociacao", falas: [desconto] });
  roteiro.push(...(opcoes.extra ?? []), CONFIRMA_PEDIDO);
  return { chave, nome, verdade, roteiro };
}

/** Verdade padrão de um fornecedor de cimento (unitário em reais por saco). */
export const verdade = (preco: number, extra: Partial<Verdade> = {}): Verdade => ({
  preco,
  frete: 60,
  prazoDias: 2,
  pagamento: "à vista no recebimento",
  validadeDias: 7,
  ...extra,
});
