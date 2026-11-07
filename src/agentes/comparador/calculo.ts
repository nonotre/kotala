// R7 e R8: frete, custo total, portões e nota. Funções puras: toda conta do
// mapa mora aqui e a IA nunca calcula nada.

export type Criterio = "preco" | "prazo" | "confianca" | "aderencia" | "pagamento";
export type Pesos = Record<Criterio, number>;

export const ROTULO_CRITERIO: Record<Criterio, string> = {
  preco: "Preço",
  prazo: "Prazo",
  confianca: "Confiança",
  aderencia: "Aderência ao pedido",
  pagamento: "Pagamento",
};

/** R9: pesos iniciais. A Ester ainda não confirmou. */
export const PESOS_BASE: Pesos = { preco: 40, prazo: 25, confianca: 20, aderencia: 10, pagamento: 5 };
/** R8: cerca de 30% abaixo da referência fica retido até o fornecedor confirmar. */
export const LIMITE_RETENCAO = 0.3;
/** Q2: com menos de 3 válidas, nunca dizer "melhor". */
export const MINIMO_PROPOSTAS_VALIDAS = 3;
/** R7: sem frete informado nem outros fretes para comparar, estima esta fração do produto. */
export const FRETE_ESTIMADO_FRACAO = 0.05;

export type OfertaComparavel = {
  id: string;
  fornecedorId: string;
  fornecedorNome: string;
  simulado: boolean;
  verificado: boolean;
  homologado: boolean;
  /** Já vendeu antes (histórico). */
  conhecido: boolean;
  /** Pontos do Q8 (0 a 100), quando verificado; senão a nota usa a regra simples. */
  confiancaFornecedor?: number | null;
  /** Sinais de suspeita do Q8 (CNPJ irregular, empresa nova...). */
  alertasFornecedor?: string[];
  itemOferecido: string;
  itemExato: boolean;
  precoUnitario: number | null;
  totalProduto: number | null;
  frete: number | null;
  impostosValor: number | null;
  impostosNaoInclusos: string | null;
  prazoDias: number | null;
  validadeDias: number | null;
  pagamento: string | null;
  prazoPagamentoDias: number | null;
  entregaNoLocal: boolean | null;
  precoConfirmado: boolean;
  /** Rodada em que esta proposta foi feita. */
  rodada?: number;
  /** X3: total do produto na proposta anterior do mesmo fornecedor (antes de negociar). */
  produtoAnterior?: number | null;
  /** Proposta montada do anúncio de uma loja online: preço real, prazo e pagamento simulados. */
  online?: boolean;
  /** Link do anúncio, quando online. */
  fonte?: string | null;
};

export type ItemComparado = {
  quantidade: number;
  aceitaSimilar: boolean;
  prazoMaxDias: number | null;
  modoEntrega: "entrega" | "retirada" | null;
  urgencia: "normal" | "urgente" | "obra_parada";
};

export type OrigemFrete = "informado" | "estimado" | "nao_se_aplica";

export type Portoes = {
  completo: boolean;
  dentroDoPrazo: boolean;
  itemExato: boolean;
  entregaNoLocal: boolean;
  naoRetida: boolean;
};

export type Linha = {
  oferta: OfertaComparavel;
  produto: number | null;
  frete: number;
  origemFrete: OrigemFrete;
  impostos: number;
  custo: number | null;
  precoUnitarioEfetivo: number | null;
  abaixoDaReferencia: number;
  portoes: Portoes;
  valida: boolean;
  motivos: string[];
  alertas: string[];
  criterios: Record<Criterio, number> | null;
  nota: number | null;
};

export type Comparacao = {
  urgente: boolean;
  pesos: Pesos;
  referenciaUnitaria: number;
  validas: Linha[];
  cortadas: Linha[];
  vencedora: Linha | null;
  maisBarata: Linha | null;
  aMaisQueAMaisBarata: number;
  podeDizerMelhor: boolean;
  alertasGerais: string[];
};

const centavos = (v: number) => Math.round(v * 100) / 100;
const umaCasa = (v: number) => Math.round(v * 10) / 10;

export function mediana(valores: number[]): number {
  if (!valores.length) return 0;
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio]! : centavos((v[meio - 1]! + v[meio]!) / 2);
}

export function formatarBRL(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatarNota(nota: number): string {
  return nota.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function pesosDoPedido(urgente: boolean): Pesos {
  return urgente ? { ...PESOS_BASE, prazo: PESOS_BASE.prazo * 2 } : { ...PESOS_BASE };
}

function produtoDa(o: OfertaComparavel, quantidade: number): number | null {
  if (o.totalProduto !== null && o.totalProduto > 0) return centavos(o.totalProduto);
  if (o.precoUnitario !== null && o.precoUnitario > 0) return centavos(o.precoUnitario * quantidade);
  return null;
}

function notaConfianca(o: OfertaComparavel): number {
  if (o.confiancaFornecedor !== undefined && o.confiancaFornecedor !== null && !o.simulado) return o.confiancaFornecedor;
  const base = o.simulado ? 60 : o.verificado ? 80 : 50;
  return Math.min(100, base + (o.homologado ? 20 : 0) + (o.conhecido ? 10 : 0));
}

function notaPagamento(dias: number | null): number {
  return dias === null ? 0 : (Math.min(dias, 30) / 30) * 100;
}

function escalaMenorMelhor(valor: number, todos: number[]): number {
  const min = Math.min(...todos);
  const max = Math.max(...todos);
  return max === min ? 100 : ((max - valor) / (max - min)) * 100;
}

/**
 * Compara as ofertas de um item.
 * @param referenciaMercado preço unitário de mercado (busca pública), quando houver.
 */
export function comparar(item: ItemComparado, ofertas: OfertaComparavel[], referenciaMercado?: number | null): Comparacao {
  const urgente = item.urgencia !== "normal";
  const pesos = pesosDoPedido(urgente);
  const retirada = item.modoEntrega === "retirada";

  const produtos = ofertas.map((o) => produtoDa(o, item.quantidade));
  const fretesInformados = ofertas.filter((o) => o.frete !== null).map((o) => o.frete!);
  const freteMediano = fretesInformados.length ? mediana(fretesInformados) : null;

  const unitariosExatos = ofertas
    .map((o, i) => (o.itemExato && produtos[i] !== null ? produtos[i]! / item.quantidade : null))
    .filter((v): v is number => v !== null);
  const med = unitariosExatos.length >= 2 ? mediana(unitariosExatos) : 0;
  const referenciaUnitaria =
    med && referenciaMercado ? centavos((med + referenciaMercado) / 2) : med || (referenciaMercado ?? 0);

  const linhas: Linha[] = ofertas.map((o, i) => {
    const produto = produtos[i]!;
    let frete = 0;
    let origemFrete: OrigemFrete = "nao_se_aplica";
    if (!retirada) {
      if (o.frete !== null) {
        frete = o.frete;
        origemFrete = "informado";
      } else {
        frete = freteMediano ?? centavos((produto ?? 0) * FRETE_ESTIMADO_FRACAO);
        origemFrete = "estimado";
      }
    }
    const impostos = o.impostosValor ?? 0;
    const custo = produto === null ? null : centavos(produto + frete + impostos);
    const unit = produto === null ? null : produto / item.quantidade;
    const abaixo = unit !== null && referenciaUnitaria > 0 ? (referenciaUnitaria - unit) / referenciaUnitaria : 0;

    const portoes: Portoes = {
      completo: produto !== null && o.prazoDias !== null,
      dentroDoPrazo: item.prazoMaxDias === null || (o.prazoDias !== null && o.prazoDias <= item.prazoMaxDias),
      itemExato: o.itemExato || item.aceitaSimilar,
      entregaNoLocal: retirada || o.entregaNoLocal !== false,
      naoRetida: !(abaixo >= LIMITE_RETENCAO && !o.precoConfirmado),
    };
    const motivos: string[] = [];
    if (!portoes.completo) motivos.push(produto === null ? "Sem preço" : "Sem prazo de entrega");
    if (portoes.completo && !portoes.dentroDoPrazo) motivos.push("Entrega depois do prazo do pedido");
    if (!portoes.itemExato) motivos.push("Item parecido sem aceite do comprador");
    if (!portoes.entregaNoLocal) motivos.push("Não entrega no local");
    if (!portoes.naoRetida) motivos.push(`Preço ${Math.round(abaixo * 100)}% abaixo da referência: aguardando confirmação`);

    const alertas: string[] = [];
    if (origemFrete === "estimado") alertas.push("Frete não informado: valor estimado");
    if (o.prazoPagamentoDias === 0 && !o.conhecido) alertas.push("Pagamento antecipado com fornecedor novo");
    if (o.impostosValor === null && !o.impostosNaoInclusos) alertas.push("Não disse se há impostos ou taxas fora do preço");
    if (!retirada && o.entregaNoLocal === null) alertas.push("Não confirmou a entrega no local");
    if (o.validadeDias === null) alertas.push("Sem validade da proposta");
    if (o.online) alertas.push("Loja online: prazo e pagamento simulados");
    if (!o.itemExato && item.aceitaSimilar) alertas.push(`Item equivalente: ${o.itemOferecido}`);
    if (abaixo >= 0.15 && portoes.naoRetida) alertas.push(`Preço ${Math.round(abaixo * 100)}% abaixo da referência`);
    for (const a of o.alertasFornecedor ?? []) alertas.push(a);

    return {
      oferta: o,
      produto,
      frete: centavos(frete),
      origemFrete,
      impostos,
      custo,
      precoUnitarioEfetivo: unit === null ? null : centavos(unit),
      abaixoDaReferencia: abaixo,
      portoes,
      valida: Object.values(portoes).every(Boolean),
      motivos,
      alertas,
      criterios: null,
      nota: null,
    };
  });

  const passaram = linhas.filter((l) => l.valida);
  const custos = passaram.map((l) => l.custo!);
  const prazos = passaram.map((l) => l.oferta.prazoDias!);
  const somaPesos = Object.values(pesos).reduce((a, b) => a + b, 0);

  const validas = passaram
    .map((l) => {
      const criterios: Record<Criterio, number> = {
        preco: escalaMenorMelhor(l.custo!, custos),
        prazo: escalaMenorMelhor(l.oferta.prazoDias!, prazos),
        confianca: notaConfianca(l.oferta),
        aderencia: l.oferta.itemExato ? 100 : 70,
        pagamento: notaPagamento(l.oferta.prazoPagamentoDias),
      };
      const soma = (Object.keys(pesos) as Criterio[]).reduce((t, c) => t + pesos[c] * criterios[c], 0);
      return { ...l, criterios, nota: umaCasa(soma / somaPesos) };
    })
    .sort((a, b) => b.nota! - a.nota! || a.custo! - b.custo!);

  const cortadas = linhas.filter((l) => !l.valida).sort((a, b) => (a.custo ?? Infinity) - (b.custo ?? Infinity));
  const vencedora = validas[0] ?? null;
  const maisBarata = validas.length ? validas.reduce((a, b) => (b.custo! < a.custo! ? b : a)) : null;

  const alertasGerais: string[] = [];
  if (validas.length && validas.length < MINIMO_PROPOSTAS_VALIDAS) {
    alertasGerais.push(`Só ${validas.length} ${validas.length === 1 ? "proposta válida" : "propostas válidas"}: a comparação é menos confiável.`);
  }

  return {
    urgente,
    pesos,
    referenciaUnitaria,
    validas,
    cortadas,
    vencedora,
    maisBarata,
    aMaisQueAMaisBarata: vencedora && maisBarata ? centavos(vencedora.custo! - maisBarata.custo!) : 0,
    podeDizerMelhor: validas.length >= MINIMO_PROPOSTAS_VALIDAS,
    alertasGerais,
  };
}
