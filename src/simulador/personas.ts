import { readFileSync } from "node:fs";
import { CATALOGO, CATEGORIAS_OBRA, categoriaSim, dadosDaCategoria, fatorDeUnidade, itemDoCatalogo, type ItemCatalogo } from "./catalogo.ts";
// Q3: fornecedores simulados. Base fictícia feita pelo time; sempre aparecem
// como simulados. Os agentes do comprador não leem este arquivo: só recebem o
// texto livre que cada persona manda, como um fornecedor real mandaria.
// Os preços e o que é de cada área (onde entrega, carrada, milheiro) estão em
// catalogo.json, por categoria de src/dominio/categorias.json.

export { CATALOGO, categoriaSim };

export type Comportamento =
  | "normal"
  | "pergunta" // pergunta antes de cotar
  | "esquece" // só responde depois do lembrete
  | "infla" // primeiro preço alto
  | "similar" // oferece item equivalente
  | "suspeito" // preço muito baixo, frete omitido, pagamento antecipado
  | "ambiguo" // "fica R$ 300" para 5 unidades, sem dizer se é cada ou o total
  | "duas_mensagens" // preço numa mensagem, condições na seguinte
  | "so_pix" // só aceita Pix à vista
  | "pdf"; // manda a proposta num PDF anexo

/**
 * Como a persona responde ao pedido automático de desconto (mensagem "Recebi sua
 * proposta" com o pedido, tipo "negociacao" na mesma rodada). Ninguém dá desconto
 * sem ser pedido: a primeira proposta é sempre o preço cheio.
 */
export type EstiloDesconto =
  | "novo_preco" // reenvia a proposta com o unitário menor
  | "percentual" // "consigo 5% no total", sem repetir o preço
  | "condicionado" // "4% se for no Pix" (não vale para o preço do mapa)
  | "fechar_hoje" // "5% se fechar hoje" (condição de prazo, não de pagamento)
  | "vou_ver" // "vou ver com o gerente", e só depois responde
  | "recusa" // "esse já é o preço final"
  | "ignora"; // não responde

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
  /** Categorias da base de itens que vende (fornecedores da base da Ester). Sem isso, vale o catálogo por palavra. */
  categorias?: string[];
  /** Categorias do domínio (ids de categorias.json) que vende; item sem preço na lista recebe o preço sintético da categoria. */
  areas?: string[];
  desconto: EstiloDesconto;
  /** Percentual do desconto quando dá (padrão 5). */
  descontoPct?: number;
};

/** Personas de construção (as da demo). */
export const PERSONAS: Persona[] = [
  { chave: "sim-perto", nome: "Depósito Perto Exemplo", regiao: "Mesma cidade", comportamento: "normal", fatorPreco: 1.0, frete: 60, prazoDias: 1, pagamento: "boleto 28 dias", validadeDias: 7, atrasoSeg: 8, desconto: "percentual", descontoPct: 3 },
  { chave: "sim-lagoa", nome: "Casa do Construtor Lagoa Exemplo", regiao: "Mesma cidade", comportamento: "pergunta", fatorPreco: 0.96, frete: 90, prazoDias: 3, pagamento: "30/60 dias no boleto", validadeDias: 10, atrasoSeg: 10, desconto: "recusa" },
  { chave: "sim-vale", nome: "Materiais Vale Exemplo", regiao: "Cidade vizinha", comportamento: "infla", fatorPreco: 1.22, frete: 0, prazoDias: 2, pagamento: "PIX à vista", validadeDias: 5, atrasoSeg: 15, desconto: "novo_preco", descontoPct: 12 },
  { chave: "sim-ipe", nome: "Comercial Ipê Exemplo", regiao: "Região metropolitana", comportamento: "similar", fatorPreco: 0.9, frete: 120, prazoDias: 4, pagamento: "boleto 21 dias", validadeDias: 7, atrasoSeg: 20, desconto: "condicionado", descontoPct: 4 },
  { chave: "sim-serra", nome: "Atacado Serra Exemplo", regiao: "Outro estado", comportamento: "suspeito", fatorPreco: 0.6, frete: null, prazoDias: 10, pagamento: "depósito antecipado", validadeDias: null, atrasoSeg: 12, desconto: "ignora" },
  { chave: "sim-aurora", nome: "Loja Aurora Exemplo", regiao: "Mesma cidade", comportamento: "esquece", fatorPreco: 1.04, frete: 70, prazoDias: 2, pagamento: "boleto 28 dias", validadeDias: 7, atrasoSeg: 5, desconto: "vou_ver", descontoPct: 2 },
];

// Fornecedores fictícios da base da Ester: comportamento normal, preço e condições
// variando de um para outro, sempre os mesmos para o mesmo fornecedor.
type FornecedorBase = { id: string; nome: string; cidade: string; categorias: string[] };
const BASE_FORNECEDORES = (
  JSON.parse(readFileSync(new URL("../dados/fornecedores-simulados.json", import.meta.url), "utf8")) as { fornecedores: FornecedorBase[] }
).fornecedores;
const PAGAMENTOS = ["boleto 28 dias", "30/60 dias no boleto", "PIX à vista com 3% de desconto", "boleto 21 dias", "cartão em 3x"];
const ESTILOS_BASE: EstiloDesconto[] = ["novo_preco", "percentual", "recusa", "condicionado", "vou_ver", "ignora", "fechar_hoje"];
export const PERSONAS_BASE: Persona[] = BASE_FORNECEDORES.map((f, i) => ({
  chave: `sim-base-${f.id.toLowerCase()}`,
  nome: f.nome,
  regiao: f.cidade,
  comportamento: "normal",
  fatorPreco: Math.round((0.94 + ((i * 37) % 15) / 100) * 100) / 100,
  frete: [50, 80, 0, 120, 65, 95][i % 6]!,
  prazoDias: 1 + (i % 4),
  pagamento: PAGAMENTOS[i % PAGAMENTOS.length]!,
  validadeDias: [7, 10, 15][i % 3]!,
  atrasoSeg: 6 + ((i * 5) % 14),
  categorias: f.categorias,
  desconto: ESTILOS_BASE[i % ESTILOS_BASE.length]!,
  descontoPct: [5, 3, 4][i % 3]!,
}));

/** Fornecedores de outras áreas (escritório, EPI, limpeza, informática, copa), para pedidos fora da obra. */
export const PERSONAS_AREAS: Persona[] = [
  { chave: "sim-papelaria", nome: "Papelaria Central Exemplo", regiao: "Mesma cidade", comportamento: "normal", fatorPreco: 1.0, frete: 15, prazoDias: 1, pagamento: "boleto 28 dias", validadeDias: 7, atrasoSeg: 7, areas: ["escritorio", "informatica"], desconto: "percentual", descontoPct: 5 },
  { chave: "sim-escritorio", nome: "Escritório Total Exemplo", regiao: "Região metropolitana", comportamento: "infla", fatorPreco: 1.18, frete: 0, prazoDias: 3, pagamento: "boleto 21 dias", validadeDias: 10, atrasoSeg: 12, areas: ["escritorio", "copa"], desconto: "novo_preco", descontoPct: 10 },
  { chave: "sim-epi", nome: "Segurança do Trabalho Exemplo", regiao: "Cidade vizinha", comportamento: "normal", fatorPreco: 0.97, frete: 40, prazoDias: 2, pagamento: "30 dias no boleto", validadeDias: 15, atrasoSeg: 9, areas: ["epi", "extintores"], desconto: "condicionado", descontoPct: 4 },
  { chave: "sim-limpeza", nome: "Limpa Bem Distribuidora Exemplo", regiao: "Mesma cidade", comportamento: "normal", fatorPreco: 0.95, frete: 25, prazoDias: 2, pagamento: "boleto 28 dias", validadeDias: 7, atrasoSeg: 8, areas: ["limpeza", "copa"], desconto: "vou_ver", descontoPct: 3 },
  { chave: "sim-info", nome: "InfoTec Exemplo", regiao: "Outro estado", comportamento: "similar", fatorPreco: 0.93, frete: 80, prazoDias: 5, pagamento: "cartão em 3x", validadeDias: 5, atrasoSeg: 14, areas: ["informatica"], desconto: "recusa" },
  { chave: "sim-copa", nome: "Atacadão da Copa Exemplo", regiao: "Mesma cidade", comportamento: "normal", fatorPreco: 1.02, frete: 0, prazoDias: 1, pagamento: "PIX à vista", validadeDias: 3, atrasoSeg: 6, areas: ["copa", "limpeza"], desconto: "fechar_hoje", descontoPct: 5 },
];

/**
 * Fornecedores fictícios para os testes da Ester pelo Telegram (08/11/2026): 3 de extintores e 3 de
 * hidráulica. Ficam no começo da fila da busca, então recebem as cotações desses itens primeiro. Cada
 * cotação manda o link do Telegram de cada um por e-mail (EMAIL_FORNECEDOR_TESTE); quem abre o link
 * responde como ele, e a persona automática para. Sem ninguém no link, respondem sozinhos.
 * Cleiton Extintores: a Ester já tem a proposta pronta dele.
 */
export const PERSONAS_TESTE: Persona[] = [
  { chave: "sim-cleiton", nome: "Cleiton Extintores", regiao: "Mesma cidade", comportamento: "normal", fatorPreco: 1.0, frete: 35, prazoDias: 3, pagamento: "boleto 28 dias", validadeDias: 10, atrasoSeg: 10, areas: ["extintores"], desconto: "percentual", descontoPct: 5 },
  { chave: "sim-chama", nome: "Chama Zero Equipamentos contra Incêndio", regiao: "Região metropolitana", comportamento: "normal", fatorPreco: 1.08, frete: 0, prazoDias: 5, pagamento: "30 dias no boleto", validadeDias: 15, atrasoSeg: 12, areas: ["extintores"], desconto: "novo_preco", descontoPct: 6 },
  { chave: "sim-brigada", nome: "Brigada Sul Extintores e Recargas", regiao: "Cidade vizinha", comportamento: "normal", fatorPreco: 0.95, frete: 60, prazoDias: 2, pagamento: "PIX à vista", validadeDias: 7, atrasoSeg: 14, areas: ["extintores"], desconto: "condicionado", descontoPct: 4 },
  { chave: "sim-fluxo", nome: "Fluxo Certo Hidráulica", regiao: "Mesma cidade", comportamento: "normal", fatorPreco: 1.0, frete: 25, prazoDias: 1, pagamento: "boleto 28 dias", validadeDias: 7, atrasoSeg: 10, areas: ["hidraulica"], desconto: "percentual", descontoPct: 4 },
  { chave: "sim-aguaviva", nome: "Água Viva Materiais Hidráulicos", regiao: "Região metropolitana", comportamento: "normal", fatorPreco: 0.93, frete: 70, prazoDias: 3, pagamento: "30/60 dias no boleto", validadeDias: 10, atrasoSeg: 12, areas: ["hidraulica"], desconto: "recusa" },
  { chave: "sim-tubolar", nome: "Tubolar Conexões e Tubos", regiao: "Cidade vizinha", comportamento: "normal", fatorPreco: 1.06, frete: 0, prazoDias: 2, pagamento: "boleto 21 dias", validadeDias: 5, atrasoSeg: 14, areas: ["hidraulica"], desconto: "fechar_hoje", descontoPct: 5 },
];

/**
 * Personas de situação difícil: preço ambíguo, proposta em duas mensagens, só Pix e PDF.
 * Vendem itens de obra e das outras áreas. Só entram no banco quando pedidas
 * (`semearSimulados({ extras: true })`, `SIM_PERSONAS=todas` no `npm run simular`),
 * para a demo de construção não mudar.
 */
export const PERSONAS_EXTRAS: Persona[] = [
  { chave: "sim-ambiguo", nome: "Comercial Dúbio Exemplo", regiao: "Mesma cidade", comportamento: "ambiguo", fatorPreco: 0.98, frete: 50, prazoDias: 2, pagamento: "boleto 28 dias", validadeDias: 7, atrasoSeg: 9, areas: [...CATEGORIAS_OBRA, "escritorio", "epi", "limpeza", "copa", "extintores"], desconto: "percentual", descontoPct: 4 },
  { chave: "sim-picado", nome: "Distribuidora Picada Exemplo", regiao: "Cidade vizinha", comportamento: "duas_mensagens", fatorPreco: 1.01, frete: 70, prazoDias: 3, pagamento: "boleto 28 dias", validadeDias: 10, atrasoSeg: 8, areas: [...CATEGORIAS_OBRA, "escritorio", "limpeza", "copa"], desconto: "novo_preco", descontoPct: 3 },
  { chave: "sim-pix", nome: "Só Pix Materiais Exemplo", regiao: "Mesma cidade", comportamento: "so_pix", fatorPreco: 0.94, frete: 40, prazoDias: 1, pagamento: "só Pix à vista, não trabalhamos com boleto", validadeDias: 3, atrasoSeg: 7, areas: [...CATEGORIAS_OBRA, "epi", "limpeza", "copa"], desconto: "condicionado", descontoPct: 3 },
  { chave: "sim-pdf", nome: "Orçamentos em PDF Exemplo", regiao: "Região metropolitana", comportamento: "pdf", fatorPreco: 0.99, frete: 90, prazoDias: 4, pagamento: "boleto 28 dias", validadeDias: 15, atrasoSeg: 11, areas: [...CATEGORIAS_OBRA, "escritorio", "informatica", "epi", "extintores"], desconto: "recusa" },
];

/**
 * Todas as personas: as de teste da Ester primeiro (extintores e hidráulica), depois as de comportamento especial (mais úteis na demo), depois as
 * da base, as das outras áreas e as de situação difícil. A ordem decide quem a busca chama primeiro.
 */
export const TODAS_PERSONAS: Persona[] = [...PERSONAS_TESTE, ...PERSONAS, ...PERSONAS_BASE, ...PERSONAS_AREAS, ...PERSONAS_EXTRAS];

/**
 * Vende o item? Pela categoria da base de itens, quando a persona tem categorias; pelas áreas do domínio,
 * quando tem áreas; senão (as de construção), pelo catálogo de obra.
 */
export function personaVende(p: Persona, descricao: string, categoria: string | null): boolean {
  if (p.categorias) return categoria !== null && p.categorias.includes(categoria);
  if (p.areas) return p.areas.includes(categoriaSim(descricao));
  return vendeItem(descricao);
}

/** Item da lista de preços de obra (o que as personas de construção vendem). Mesma resposta de antes da lista por categoria. */
export function precoDoCatalogo(descricao: string): ItemCatalogo | null {
  const c = itemDoCatalogo(descricao);
  return c && (CATEGORIAS_OBRA as readonly string[]).includes(c.categoria) ? c : null;
}

export function vendeItem(descricao: string): boolean {
  return precoDoCatalogo(descricao) !== null;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * Preço unitário na unidade pedida pelo comprador.
 * @param referencia preço real de mercado (mediana da busca), quando houver: os simulados ficam ancorados nele.
 */
export function precoUnitario(p: Persona, descricao: string, unidade: string, referencia?: number | null): number | null {
  // Persona de área conhece a lista inteira e, sem o item, usa o preço sintético da categoria.
  const c = p.areas ? itemDoCatalogo(descricao) : precoDoCatalogo(descricao);
  const sintetico = p.areas && !c ? dadosDaCategoria(categoriaSim(descricao)).precoSintetico.preco : null;
  if (!c && sintetico === null && !(referencia && referencia > 0)) return null;
  let base = c?.preco ?? sintetico ?? referencia!;
  if (c) base *= fatorDeUnidade(c.categoria, c.unidade, unidade);
  if (referencia && referencia > 0) base = referencia;
  return centavos(base * p.fatorPreco);
}

export type ItemPedido = { descricao: string; quantidade: number; unidade: string; destino: string | null };

/** "aí na obra", "no escritório": onde a persona diz que entrega o item. */
export const ondeEntrega = (descricao: string) => dadosDaCategoria(categoriaSim(descricao)).entrega;

/** Unitário da rodada: a 2ª rodada (botão do comprador) baixa o preço. */
export function unitarioDaRodada(p: Persona, item: ItemPedido, rodada: number, referencia?: number | null): number | null {
  let unit = precoUnitario(p, item.descricao, item.unidade, referencia);
  if (unit !== null && rodada > 1) unit = centavos(unit * (p.comportamento === "infla" ? 0.88 : 0.97));
  return unit;
}

/** Texto livre da proposta, do jeito que cada persona escreveria. `unitario` força o preço (proposta com desconto). */
export function textoProposta(p: Persona, item: ItemPedido, rodada: number, referencia?: number | null, unitario?: number): string | null {
  const unit = unitario ?? unitarioDaRodada(p, item, rodada, referencia);
  // Fornecedor da base sem referência de preço: diz que não tem, em vez de inventar.
  if (unit === null && p.categorias) return `Bom dia! No momento não temos ${item.descricao} para pronta entrega. Obrigado pelo contato.`;
  if (unit === null) return null;
  const qtd = `${item.quantidade} ${item.unidade}`;
  const total = brl(unit * item.quantidade);
  const frete = p.frete === null ? "" : p.frete === 0 ? "Frete grátis." : `Frete R$ ${brl(p.frete)}.`;
  const onde = ondeEntrega(item.descricao);
  switch (p.comportamento) {
    case "suspeito":
      return `Bom dia. Tenho ${item.descricao} a ${brl(unit)} cada, pronta entrega. Entrega em uns ${p.prazoDias} dias. Pagamento só com depósito antecipado.`;
    case "similar": {
      const eq = itemDoCatalogo(item.descricao)?.equivalente ?? `${item.descricao} de outra marca`;
      return `Olá! Não tenho exatamente o pedido, mas tenho ${eq}, mesma especificação técnica. R$ ${brl(unit)} a unidade, total R$ ${total} para ${qtd}. ${frete} Entrego em ${p.prazoDias} dias úteis no local. ${p.pagamento}. Proposta válida por ${p.validadeDias} dias. Preço já com impostos.`;
    }
    case "infla":
      return `Segue cotação: ${qtd} de ${item.descricao}\nValor unitário: R$ ${brl(unit)}\nTotal: R$ ${total}\n${frete}\nPrazo: ${p.prazoDias} dias\nPagamento: ${p.pagamento}\nValidade: ${p.validadeDias} dias\nEntregamos no endereço informado.`;
    case "ambiguo":
      // R5: um número só, sem "cada" nem "total". É o total.
      return `Boa tarde! ${qtd} de ${item.descricao} fica R$ ${total}. ${frete} Entrego em ${p.prazoDias} dias, ${p.pagamento}, vale ${p.validadeDias} dias.`;
    case "duas_mensagens":
      // Só o preço; as condições vão em textoSegundaParte.
      return `Oi! ${item.descricao}: R$ ${brl(unit)} cada, total R$ ${total} para ${qtd}. Já te passo o resto.`;
    case "so_pix":
      return `Olá! ${qtd} de ${item.descricao}: R$ ${brl(unit)} cada (total R$ ${total}). ${frete} Entrego em ${p.prazoDias} ${p.prazoDias === 1 ? "dia" : "dias"} ${onde}. Pagamento só no Pix à vista, não trabalhamos com boleto nem cartão. Validade ${p.validadeDias} dias.`;
    case "pdf":
      return "Bom dia, segue o orçamento em anexo.";
    default:
      return `Opa, tudo bem? Pra ${qtd} de ${item.descricao} fica R$ ${brl(unit)} cada (R$ ${total}). ${frete} Consigo entregar em ${p.prazoDias} ${p.prazoDias === 1 ? "dia" : "dias"} ${onde}. Pagamento ${p.pagamento}, proposta vale ${p.validadeDias} dias. Impostos inclusos.`;
  }
}

/** Segunda mensagem da persona "duas_mensagens": as condições que faltaram. */
export function textoSegundaParte(p: Persona, item?: ItemPedido): string {
  const frete = p.frete === null ? "frete a combinar" : p.frete === 0 ? "frete grátis" : `frete R$ ${brl(p.frete)}`;
  return `Completando: ${frete}, entrego em ${p.prazoDias} ${p.prazoDias === 1 ? "dia" : "dias"}${item ? ` ${ondeEntrega(item.descricao)}` : ""}, pagamento ${p.pagamento}, proposta válida por ${p.validadeDias ?? 3} dias.`;
}

/** Linhas do orçamento em PDF da persona "pdf" (o simulador monta o arquivo com elas). */
export function linhasOrcamentoPdf(p: Persona, item: ItemPedido, unit: number): string[] {
  return [
    `ORÇAMENTO - ${p.nome}`,
    `Item: ${item.descricao}`,
    `Quantidade: ${item.quantidade} ${item.unidade}`,
    `Valor unitário: R$ ${brl(unit)}`,
    `Total do produto: R$ ${brl(unit * item.quantidade)}`,
    p.frete === null ? "Frete: a combinar" : p.frete === 0 ? "Frete: grátis (CIF)" : `Frete: R$ ${brl(p.frete)} (CIF)`,
    `Prazo de entrega: ${p.prazoDias} dias úteis`,
    `Pagamento: ${p.pagamento}`,
    `Validade da proposta: ${p.validadeDias ?? 3} dias`,
    "Preços com impostos inclusos.",
  ];
}

/** Resposta à pergunta "unitário ou total?" da persona "ambiguo". */
export function textoEsclarecePreco(item: ItemPedido, unit: number): string {
  return `É o total: R$ ${brl(unit * item.quantidade)} pelas ${item.quantidade} ${item.unidade}, ou seja R$ ${brl(unit)} cada.`;
}

/** Resposta quando o assistente pede o que faltou na proposta. */
export function textoComplemento(p: Persona, item?: ItemPedido): string {
  const freteAte = dadosDaCategoria(item ? categoriaSim(item.descricao) : "cimenticios").freteAte;
  const partes = [`Prazo de entrega ${p.prazoDias} ${p.prazoDias === 1 ? "dia" : "dias"}`, `pagamento ${p.pagamento}`, `validade ${p.validadeDias ?? 3} dias`];
  partes.push(p.frete === null ? `frete R$ 250,00 ${freteAte}` : p.frete === 0 ? "frete grátis" : `frete R$ ${brl(p.frete)}`);
  return `Desculpe, faltou: ${partes.join(", ")}.`;
}

export const PERGUNTA_ANTES = "Boa tarde! Antes de cotar: qual o CEP da entrega e se tem restrição de horário para caminhão?";

// ---------- Resposta ao pedido automático de desconto ----------

/** Uma mensagem que a persona manda, com o atraso relativo ao dela (1 = o atraso normal). */
export type Fala = { texto: string; atraso: number };

/**
 * O que a persona responde ao pedido automático de desconto, a partir do unitário que ela
 * mandou. Puro: o simulador só agenda as falas. Lista vazia: não responde.
 */
export function respostaAoDesconto(p: Persona, item: ItemPedido, unitAnterior: number): Fala[] {
  const pct = p.descontoPct ?? 5;
  const novo = centavos(unitAnterior * (1 - pct / 100));
  switch (p.desconto) {
    case "ignora":
      return [];
    case "recusa":
      return [{ texto: "Esse já é o preço final, não tem como baixar. Fico no aguardo.", atraso: 1 }];
    case "percentual":
      return [{ texto: `Consigo ${pct}% de desconto no total, mantendo as outras condições.`, atraso: 1 }];
    case "condicionado":
      return [{ texto: `Se o pagamento for no Pix à vista, faço ${pct}% de desconto. No boleto fica o mesmo preço.`, atraso: 1 }];
    case "fechar_hoje":
      return [{ texto: `Faço ${pct}% de desconto se fechar hoje.`, atraso: 1 }];
    case "vou_ver":
      return [
        { texto: "Vou ver com o gerente e te retorno.", atraso: 0.5 },
        { texto: `O gerente liberou: R$ ${brl(novo)} cada, total R$ ${brl(novo * item.quantidade)}. O resto fica igual.`, atraso: 3 },
      ];
    case "novo_preco": {
      const texto = p.comportamento === "pdf" ? null : textoProposta(p, item, 1, null, novo);
      return texto ? [{ texto, atraso: 1 }] : [];
    }
  }
}
