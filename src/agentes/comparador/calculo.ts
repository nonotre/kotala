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
/** Q7: diferença para a referência online que vira alerta (nunca corte). */
export const LIMITE_ALERTA_ONLINE = 0.3;

/**
 * S: alertas do guardrail do fornecedor (`oferta.extraido.alertas`). Os de corte
 * tiram a proposta do ranking; os de atenção só aparecem no mapa.
 */
export const CORTE_CONDUTA: Record<string, string> = {
  sem_nota: "Preço sem nota fiscal",
  item_irregular: "Item irregular (réplica, paralelo ou sem procedência)",
  produto_controlado: "Produto controlado sem autorização",
};
export const ATENCAO_CONDUTA: Record<string, string> = {
  propina: "Ofereceu comissão ou vantagem ao comprador",
  pagamento_por_fora: "Pediu pagamento por fora (conta pessoal, link ou cripto)",
  combinacao_preco: "Tentou saber o preço de concorrentes ou combinar preço",
  pede_dados: "Pediu dados pessoais ou sigilosos",
  link_suspeito: "Mandou link ou arquivo suspeito",
};

/** I1: resumo do pedido automático de desconto (`oferta.extraido.negociacao`), só o que o mapa mostra. */
export type NegociacaoDaOferta = {
  resultado: "desconto" | "manteve" | "subiu" | "condicional" | "sem_resposta" | null;
  /** Quanto o frete baixou (positivo) na resposta ao pedido. */
  descontoFrete?: number;
  /** Desconto condicionado, como o fornecedor escreveu; não aplicado ao preço. */
  condicao?: string;
};

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
  /** X3 e I1: total do produto na proposta mais antiga do mesmo fornecedor (antes de negociar). */
  produtoAnterior?: number | null;
  /** I1: como ficou o pedido automático de desconto. */
  negociacao?: NegociacaoDaOferta | null;
  /** R3b: o fornecedor aumentou a proposta nesta rodada ("produto de R$ A para R$ B"). */
  aumento?: string | null;
  /** S: alertas do guardrail na mensagem do fornecedor (ids de ALERTAS do Extrator). */
  alertasConduta?: string[];
  /** Q2: o que difere do pedido, como o Extrator escreveu. */
  divergencias?: string[];
  /** Q1/Q2: o que ainda espera resposta do fornecedor. */
  aConfirmar?: ("preco" | "item")[];
  /** Q1: número lido quando o preço ficou a confirmar (as colunas de preço ficam vazias). */
  precoLido?: number | null;
  /** Proposta montada do anúncio de uma loja online: preço real, prazo e pagamento simulados. */
  online?: boolean;
  /** Link do anúncio, quando online. */
  fonte?: string | null;
  /** R7: frete declarado no anúncio (JSON-LD), com a regra e a hora da coleta; `noCep` diz se a regra cobre o CEP. */
  freteAnuncio?: FreteAnuncio | null;
};

/** R7: frete lido da página do anúncio de uma loja fora da VTEX (`oferta.extraido.freteAnuncio`). */
export type FreteAnuncio = { valor: number; noCep: boolean; fonte: string; coletadoEm: string };

const horaDe = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
};

/** "frete do anúncio R$ 25,00, coletado às 14:02" (sem a hora quando ela não veio). */
export function textoFreteAnuncio(f: FreteAnuncio): string {
  const h = horaDe(f.coletadoEm);
  return `frete do anúncio ${formatarBRL(f.valor)}${h ? `, coletado às ${h}` : ""}`;
}

export type ItemComparado = {
  quantidade: number;
  aceitaSimilar: boolean;
  prazoMaxDias: number | null;
  modoEntrega: "entrega" | "retirada" | null;
  urgencia: "normal" | "urgente" | "parada";
};

/** "a_calcular": loja online sem frete para o CEP; a estimativa só serve para comparar (Q8). */
export type OrigemFrete = "informado" | "estimado" | "a_calcular" | "nao_se_aplica";

export type Portoes = {
  completo: boolean;
  dentroDoPrazo: boolean;
  itemExato: boolean;
  entregaNoLocal: boolean;
  naoRetida: boolean;
  /** S: sem alerta de corte do guardrail (sem nota, item irregular, controlado). */
  conduta?: boolean;
  /** Q1: preço lido sem saber se é unitário ou total. */
  precoClaro?: boolean;
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
  /** I1/X3: "Desconto obtido: ...", "Pedi desconto: manteve o preço"... */
  negociacao?: string | null;
  /** Fora só porque espera o fornecedor confirmar (preço ambíguo ou retido). */
  aConfirmar?: boolean;
  criterios: Record<Criterio, number> | null;
  nota: number | null;
};

export type Comparacao = {
  urgente: boolean;
  pesos: Pesos;
  /** Q7: referência do portão de retenção, só de fornecedores físicos. */
  referenciaUnitaria: number;
  /** Q7: mediana da internet (lojas online), só para alerta. */
  referenciaOnline?: number | null;
  /** I3: busca automática da rodada, preenchida por quem monta o mapa. */
  buscaAutomatica?: BuscaAutomatica | null;
  validas: Linha[];
  cortadas: Linha[];
  vencedora: Linha | null;
  maisBarata: Linha | null;
  aMaisQueAMaisBarata: number;
  podeDizerMelhor: boolean;
  alertasGerais: string[];
};

/** I3: quantos fornecedores a busca automática acrescentou e em quantas levas. */
export type BuscaAutomatica = { fornecedores: number; levas: number; teto: number };

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

/** R13: pagamento antes da entrega (antecipado, sinal, entrada, no pedido). Puro: o negociador usa o mesmo. */
export function pagamentoAntecipado(pagamento: string | null): boolean {
  if (!pagamento) return false;
  return /antecipad|adiantad|\bsinal\b|\bentrada\b|antes d[ae] (entrega|envio|despacho|faturamento|embarque)|no ato do pedido|no pedido|na confirma[cç][aã]o do pedido|no fechamento do pedido|pagamento pr[eé]vio/i.test(pagamento);
}

/**
 * R13: o padrão da empresa é à vista no recebimento, então ele e o pagamento a prazo valem o máximo;
 * antecipado vale zero (é condição a negociar), e não informado também. Antes, à vista valia zero e
 * só boleto de 30 dias valia o máximo: regra anterior à R13 (achado do simulador, cenário a-vista).
 */
function notaPagamento(dias: number | null, pagamento: string | null): number {
  if (dias === null && !pagamento) return 0;
  return pagamentoAntecipado(pagamento) ? 0 : 100;
}

function escalaMenorMelhor(valor: number, todos: number[]): number {
  const min = Math.min(...todos);
  const max = Math.max(...todos);
  return max === min ? 100 : ((max - valor) / (max - min)) * 100;
}

/**
 * I1 e X3: o que a negociação deu, em texto para o mapa, e o que vai para "Atenção".
 * Compara o produto da proposta mais antiga do fornecedor com o atual; sem mudança de
 * preço, lê o resultado do pedido automático de desconto.
 */
export function negociacaoDaLinha(o: OfertaComparavel, produto: number | null): { texto: string | null; alertas: string[] } {
  const alertas: string[] = [];
  let texto: string | null = null;
  const antes = o.produtoAnterior ?? null;
  const n = o.negociacao ?? null;
  if (antes !== null && produto !== null) {
    const diferenca = centavos(antes - produto);
    if (diferenca >= 0.01) texto = `Desconto obtido: ${formatarBRL(diferenca)} (de ${formatarBRL(antes)} para ${formatarBRL(produto)})`;
    else if (diferenca <= -0.01) alertas.push(`Subiu o preço depois do pedido de desconto (de ${formatarBRL(antes)} para ${formatarBRL(produto)})`);
  }
  if (n) {
    if ((n.descontoFrete ?? 0) >= 0.01) texto = `${texto ? `${texto}; ` : "Desconto obtido: "}frete ${formatarBRL(n.descontoFrete!)} mais barato`;
    if (!texto) {
      if (n.resultado === "manteve") texto = "Pedi desconto: manteve o preço";
      else if (n.resultado === "condicional") texto = "Pedi desconto: só com condição";
      else if (n.resultado === "sem_resposta" || n.resultado === null) texto = "Pedi desconto: não respondeu";
    }
    if (n.resultado === "subiu" && !alertas.length) alertas.push("Subiu o preço depois do pedido de desconto");
    if (n.condicao) alertas.push(`Desconto condicionado, não aplicado ao total: "${n.condicao}"`);
  }
  return { texto, alertas };
}

/** Q1/R8: a proposta está fora só porque espera o fornecedor confirmar o preço. */
function soFaltaConfirmar(p: Portoes): boolean {
  const { naoRetida, precoClaro, completo, ...resto } = p;
  if (naoRetida && precoClaro !== false) return false;
  // Preço a confirmar não tem número: o "completo" falha junto e não conta como outro motivo.
  return (completo || precoClaro === false) && Object.values(resto).every((v) => v !== false);
}

/**
 * Compara as ofertas de um item.
 * @param referenciaMercado preço unitário de mercado (busca pública, lojas online), quando houver.
 * Q7: ele não entra no portão de retenção; vira só alerta.
 */
export function comparar(item: ItemComparado, ofertas: OfertaComparavel[], referenciaMercado?: number | null): Comparacao {
  const urgente = item.urgencia !== "normal";
  const pesos = pesosDoPedido(urgente);
  const retirada = item.modoEntrega === "retirada";

  const produtos = ofertas.map((o) => produtoDa(o, item.quantidade));
  const fretesInformados = ofertas.filter((o) => o.frete !== null).map((o) => o.frete!);
  const freteMediano = fretesInformados.length ? mediana(fretesInformados) : null;

  // Q7: a referência do portão sai só de fornecedores físicos; o preço de loja online
  // (proposta ou referência pública) nunca corta sozinho uma proposta.
  const unitariosFisicos = ofertas
    .map((o, i) => (!o.online && o.itemExato && produtos[i] !== null ? produtos[i]! / item.quantidade : null))
    .filter((v): v is number => v !== null);
  const referenciaUnitaria = unitariosFisicos.length >= 2 ? mediana(unitariosFisicos) : 0;
  const referenciaOnline = referenciaMercado && referenciaMercado > 0 ? referenciaMercado : null;

  const linhas: Linha[] = ofertas.map((o, i) => {
    const produto = produtos[i]!;
    let frete = 0;
    let origemFrete: OrigemFrete = "nao_se_aplica";
    if (!retirada) {
      if (o.frete !== null) {
        frete = o.frete;
        origemFrete = "informado";
      } else if (o.online && o.freteAnuncio) {
        // R7: o anúncio declara o frete, mas sem regra que cubra o CEP: vale o valor dele,
        // ainda "a calcular no site" (o carrinho confirma), e não a mediana dos outros.
        frete = o.freteAnuncio.valor;
        origemFrete = "a_calcular";
      } else {
        // Q8: loja online sem frete para o CEP é "a calcular no site". A estimativa fica só
        // para a comparação não favorecer quem não disse o frete; o mapa a mostra separada.
        frete = freteMediano ?? centavos((produto ?? 0) * FRETE_ESTIMADO_FRACAO);
        origemFrete = o.online ? "a_calcular" : "estimado";
      }
    }
    const impostos = o.impostosValor ?? 0;
    const custo = produto === null ? null : centavos(produto + frete + impostos);
    const unit = produto === null ? null : produto / item.quantidade;
    const abaixo = unit !== null && referenciaUnitaria > 0 ? (referenciaUnitaria - unit) / referenciaUnitaria : 0;
    const conduta = o.alertasConduta ?? [];
    const precoAConfirmar = !!o.aConfirmar?.includes("preco");

    const portoes: Portoes = {
      completo: produto !== null && o.prazoDias !== null,
      dentroDoPrazo: item.prazoMaxDias === null || (o.prazoDias !== null && o.prazoDias <= item.prazoMaxDias),
      itemExato: o.itemExato || item.aceitaSimilar,
      entregaNoLocal: retirada || o.entregaNoLocal !== false,
      // Loja online não tem com quem confirmar: o preço do anúncio é real e nunca fica retido.
      naoRetida: !!o.online || !(abaixo >= LIMITE_RETENCAO && !o.precoConfirmado),
      conduta: !conduta.some((a) => a in CORTE_CONDUTA),
      precoClaro: !precoAConfirmar,
    };
    const motivos: string[] = [];
    for (const a of conduta) if (a in CORTE_CONDUTA) motivos.push(CORTE_CONDUTA[a]!);
    if (precoAConfirmar) motivos.push(`Preço a confirmar (${o.precoLido ? `${formatarBRL(o.precoLido)}: ` : ""}por unidade ou total?)`);
    else if (!portoes.completo) motivos.push(produto === null ? "Sem preço" : "Sem prazo de entrega");
    if (portoes.completo && !portoes.dentroDoPrazo) motivos.push("Entrega depois do prazo do pedido");
    if (!portoes.itemExato) motivos.push("Item parecido sem aceite do comprador");
    if (!portoes.entregaNoLocal) motivos.push("Não entrega no local");
    if (!portoes.naoRetida) motivos.push(`Preço ${Math.round(abaixo * 100)}% abaixo da referência: aguardando confirmação`);

    const neg = negociacaoDaLinha(o, produto);
    const alertas: string[] = [];
    // Conduta primeiro: é o que o comprador mais precisa ver.
    for (const a of conduta) if (a in ATENCAO_CONDUTA) alertas.push(ATENCAO_CONDUTA[a]!);
    alertas.push(...neg.alertas);
    if (o.aumento) alertas.push(`Subiu: ${o.aumento}`);
    if (origemFrete === "estimado") alertas.push("Frete não informado: valor estimado");
    if (origemFrete === "a_calcular") {
      alertas.push(
        o.freteAnuncio
          ? `Frete a calcular no site: ${textoFreteAnuncio(o.freteAnuncio)}, para o Brasil, sem conferir o CEP`
          : "Frete a calcular no site: a estimativa serve só para comparar",
      );
    }
    if (origemFrete === "informado" && o.online && o.freteAnuncio?.noCep) alertas.push(`Frete do anúncio para o CEP (${textoFreteAnuncio(o.freteAnuncio)}): confirme no carrinho`);
    // R13: só o antecipado de verdade; "à vista no recebimento" (prazo 0) é o padrão da empresa, não alerta.
    if (pagamentoAntecipado(o.pagamento) && !o.conhecido) alertas.push("Pagamento antecipado com fornecedor novo");
    if (o.impostosValor === null && !o.impostosNaoInclusos) alertas.push("Não disse se há impostos ou taxas fora do preço");
    if (!retirada && o.entregaNoLocal === null) alertas.push("Não confirmou a entrega no local");
    if (o.validadeDias === null) alertas.push("Sem validade da proposta");
    if (o.online) alertas.push("Loja online: prazo e pagamento simulados");
    if (!o.itemExato && item.aceitaSimilar) alertas.push(`Item equivalente: ${o.itemOferecido}`);
    if (o.aConfirmar?.includes("item")) alertas.push("Item a confirmar com o fornecedor");
    if (o.divergencias?.length) alertas.push(`Difere do pedido: ${o.divergencias.join("; ")}`);
    if (abaixo >= 0.15 && portoes.naoRetida) alertas.push(`Preço ${Math.round(abaixo * 100)}% abaixo da referência`);
    if (referenciaOnline && unit !== null && !o.online) {
      const diferenca = (unit - referenciaOnline) / referenciaOnline;
      if (diferenca <= -LIMITE_ALERTA_ONLINE) alertas.push(`Preço ${Math.round(-diferenca * 100)}% abaixo da referência online`);
      if (diferenca >= LIMITE_ALERTA_ONLINE) alertas.push(`Preço ${Math.round(diferenca * 100)}% acima da referência online`);
    }
    for (const a of o.alertasFornecedor ?? []) alertas.push(a);

    const valida = Object.values(portoes).every((v) => v !== false);
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
      valida,
      motivos,
      alertas,
      negociacao: neg.texto,
      aConfirmar: !valida && soFaltaConfirmar(portoes),
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
        pagamento: notaPagamento(l.oferta.prazoPagamentoDias, l.oferta.pagamento),
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
    referenciaOnline,
    validas,
    cortadas,
    vencedora,
    maisBarata,
    aMaisQueAMaisBarata: vencedora && maisBarata ? centavos(vencedora.custo! - maisBarata.custo!) : 0,
    podeDizerMelhor: validas.length >= MINIMO_PROPOSTAS_VALIDAS,
    alertasGerais,
  };
}

/**
 * Q6: o que mudou de um mapa para o refeito na mesma rodada ("Mapa atualizado: ...").
 * Compara quem está entre as válidas e quem ficou na frente.
 */
export function mudancasDoMapa(anterior: Pick<Comparacao, "validas" | "vencedora">, novo: Pick<Comparacao, "validas" | "vencedora">): string[] {
  const nomes = (c: Pick<Comparacao, "validas">) => new Map(c.validas.map((l) => [l.oferta.fornecedorId, l.oferta.fornecedorNome]));
  const antes = nomes(anterior);
  const agora = nomes(novo);
  const entraram = [...agora].filter(([id]) => !antes.has(id)).map(([, n]) => n);
  const sairam = [...antes].filter(([id]) => !agora.has(id)).map(([, n]) => n);
  const partes: string[] = [];
  if (entraram.length) partes.push(`${entraram.join(", ")} ${entraram.length === 1 ? "entrou" : "entraram"} na comparação`);
  if (sairam.length) partes.push(`${sairam.join(", ")} ${sairam.length === 1 ? "saiu" : "saíram"}`);
  const vAntes = anterior.vencedora?.oferta.fornecedorId;
  const vAgora = novo.vencedora?.oferta.fornecedorId;
  if (vAgora && vAntes !== vAgora) partes.push(`agora na frente: ${novo.vencedora!.oferta.fornecedorNome}`);
  return partes;
}

/** Frete como o mapa mostra: informado, estimado ou "a calcular no site" (Q8), com a estimativa à parte. */
export function textoFrete(l: Pick<Linha, "origemFrete" | "frete"> & { oferta?: Pick<OfertaComparavel, "freteAnuncio"> }): string {
  if (l.origemFrete === "nao_se_aplica") return "retirada";
  const anuncio = l.oferta?.freteAnuncio;
  // R7: o anúncio declara o frete, mas a regra não cobre o CEP: o valor é dele, a confirmação é no carrinho.
  if (l.origemFrete === "a_calcular" && anuncio) return `frete a calcular no site (${textoFreteAnuncio(anuncio)}, sem conferir o CEP)`;
  if (l.origemFrete === "a_calcular") return `frete a calcular no site (estimado ${formatarBRL(l.frete)} só para comparar)`;
  if (l.origemFrete === "informado" && anuncio?.noCep) return `frete ${formatarBRL(l.frete)} (do anúncio, para o CEP)`;
  return `frete ${formatarBRL(l.frete)} (${l.origemFrete})`;
}
