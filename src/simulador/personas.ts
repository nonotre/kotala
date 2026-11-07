// Q3: fornecedores simulados. Base fictícia feita pelo time; sempre aparecem
// como simulados. Os agentes do comprador não leem este arquivo: só recebem o
// texto livre que cada persona manda, como um fornecedor real mandaria.

/** Preço de referência fictício por unidade, para gerar respostas plausíveis. */
export const CATALOGO: { palavras: string[]; unidade: string; preco: number; equivalente: string }[] = [
  { palavras: ["cimento", "cp ii", "cp-ii", "cp2", "cp 2"], unidade: "saco", preco: 39.9, equivalente: "Cimento CP II-F 32 marca alternativa, saco 50 kg" },
  { palavras: ["cp v", "cp-v", "ari"], unidade: "saco", preco: 46.5, equivalente: "Cimento CP V-ARI marca alternativa" },
  { palavras: ["areia"], unidade: "m³", preco: 135, equivalente: "Areia média lavada de outra jazida" },
  { palavras: ["brita", "pedrisco"], unidade: "m³", preco: 145, equivalente: "Brita 1 de outra pedreira" },
  { palavras: ["vergalh", "ferro", "ca-50", "ca 50", "ca-60"], unidade: "barra", preco: 58, equivalente: "Vergalhão CA-50 de outra usina, barra 12 m" },
  { palavras: ["tijolo"], unidade: "milheiro", preco: 980, equivalente: "Tijolo cerâmico 8 furos de outra olaria" },
  { palavras: ["bloco"], unidade: "unidade", preco: 3.9, equivalente: "Bloco de concreto vedação, outro fabricante" },
  { palavras: ["argamassa", "ac-i", "ac-ii", "ac-iii", "ac1", "ac2", "ac3"], unidade: "saco", preco: 28.5, equivalente: "Argamassa AC-II de outra marca, saco 20 kg" },
  { palavras: ["tubo", "cano", "pvc"], unidade: "barra", preco: 62, equivalente: "Tubo PVC esgoto 100 mm de outra marca" },
];

/** Volume de uma carrada, só para a conta do simulado. */
const M3_POR_CARRADA = 6;

export type Comportamento =
  | "normal"
  | "pergunta" // pergunta antes de cotar
  | "esquece" // só responde depois do lembrete
  | "infla" // primeiro preço alto
  | "similar" // oferece item equivalente
  | "suspeito"; // preço muito baixo, frete omitido, pagamento antecipado

export type Persona = {
  chave: string;
  nome: string;
  regiao: string;
  comportamento: Comportamento;
  fatorPreco: number;
  /** null: não informa o frete. 0: grátis. */
  frete: number | null;
  prazoDias: number;
  pagamento: string;
  validadeDias: number | null;
  /** Segundos até responder (antes do SIM_ATRASO_FATOR). */
  atrasoSeg: number;
};

export const PERSONAS: Persona[] = [
  { chave: "sim-perto", nome: "Depósito Perto Exemplo", regiao: "Mesma cidade", comportamento: "normal", fatorPreco: 1.0, frete: 60, prazoDias: 1, pagamento: "boleto 28 dias", validadeDias: 7, atrasoSeg: 8 },
  { chave: "sim-lagoa", nome: "Casa do Construtor Lagoa Exemplo", regiao: "Mesma cidade", comportamento: "pergunta", fatorPreco: 0.96, frete: 90, prazoDias: 3, pagamento: "30/60 dias no boleto", validadeDias: 10, atrasoSeg: 10 },
  { chave: "sim-vale", nome: "Materiais Vale Exemplo", regiao: "Cidade vizinha", comportamento: "infla", fatorPreco: 1.22, frete: 0, prazoDias: 2, pagamento: "PIX à vista", validadeDias: 5, atrasoSeg: 15 },
  { chave: "sim-ipe", nome: "Comercial Ipê Exemplo", regiao: "Região metropolitana", comportamento: "similar", fatorPreco: 0.9, frete: 120, prazoDias: 4, pagamento: "boleto 21 dias", validadeDias: 7, atrasoSeg: 20 },
  { chave: "sim-serra", nome: "Atacado Serra Exemplo", regiao: "Outro estado", comportamento: "suspeito", fatorPreco: 0.6, frete: null, prazoDias: 10, pagamento: "depósito antecipado", validadeDias: null, atrasoSeg: 12 },
  { chave: "sim-aurora", nome: "Loja Aurora Exemplo", regiao: "Mesma cidade", comportamento: "esquece", fatorPreco: 1.04, frete: 70, prazoDias: 2, pagamento: "boleto 28 dias", validadeDias: 7, atrasoSeg: 5 },
];

export function precoDoCatalogo(descricao: string) {
  const d = descricao.toLowerCase();
  return CATALOGO.find((c) => c.palavras.some((p) => d.includes(p))) ?? null;
}

export function vendeItem(descricao: string): boolean {
  return precoDoCatalogo(descricao) !== null;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Preço unitário na unidade pedida pelo comprador. */
export function precoUnitario(p: Persona, descricao: string, unidade: string): number | null {
  const c = precoDoCatalogo(descricao);
  if (!c) return null;
  let base = c.preco;
  if (/carrad|caçamba|caminh/i.test(unidade) && c.unidade === "m³") base *= M3_POR_CARRADA;
  if (/milheiro/i.test(unidade) && c.unidade === "unidade") base *= 1000;
  return Math.round(base * p.fatorPreco * 100) / 100;
}

export type ItemPedido = { descricao: string; quantidade: number; unidade: string; destino: string | null };

/** Texto livre da proposta, do jeito que cada persona escreveria. */
export function textoProposta(p: Persona, item: ItemPedido, rodada: number): string | null {
  let unit = precoUnitario(p, item.descricao, item.unidade);
  if (unit === null) return null;
  if (rodada > 1) unit = Math.round(unit * (p.comportamento === "infla" ? 0.88 : 0.97) * 100) / 100;
  const qtd = `${item.quantidade} ${item.unidade}`;
  const total = brl(unit * item.quantidade);
  const frete = p.frete === null ? "" : p.frete === 0 ? "Frete grátis." : `Frete R$ ${brl(p.frete)}.`;
  switch (p.comportamento) {
    case "suspeito":
      return `Bom dia. Tenho ${item.descricao} a ${brl(unit)} cada, pronta entrega. Entrega em uns ${p.prazoDias} dias. Pagamento só com depósito antecipado.`;
    case "similar": {
      const eq = precoDoCatalogo(item.descricao)!.equivalente;
      return `Olá! Não tenho exatamente o pedido, mas tenho ${eq}, mesma especificação técnica. R$ ${brl(unit)} a unidade, total R$ ${total} para ${qtd}. ${frete} Entrego em ${p.prazoDias} dias úteis no local. ${p.pagamento}. Proposta válida por ${p.validadeDias} dias. Preço já com impostos.`;
    }
    case "infla":
      return `Segue cotação: ${qtd} de ${item.descricao}\nValor unitário: R$ ${brl(unit)}\nTotal: R$ ${total}\n${frete}\nPrazo: ${p.prazoDias} dias\nPagamento: ${p.pagamento}\nValidade: ${p.validadeDias} dias\nEntregamos no endereço informado.`;
    default:
      return `Opa, tudo bem? Pra ${qtd} de ${item.descricao} fica R$ ${brl(unit)} cada (R$ ${total}). ${frete} Consigo entregar em ${p.prazoDias} ${p.prazoDias === 1 ? "dia" : "dias"} aí na obra. Pagamento ${p.pagamento}, proposta vale ${p.validadeDias} dias. Impostos inclusos.`;
  }
}

export const PERGUNTA_ANTES = "Boa tarde! Antes de cotar: qual o CEP da entrega e se tem restrição de horário para caminhão?";
