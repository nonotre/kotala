// Lojas VTEX com API pública: catálogo (preço e estoque) e simulação de
// carrinho (frete real para o CEP). Sem conta e sem crédito.

import lojasJson from "../../dominio/lojas.json" with { type: "json" };
import { buscarHttp, comCache } from "./rede.ts";

export type LojaVtex = { nome: string; dominio: string };

/** Lojas em src/dominio/lojas.json, cada uma com as categorias que atende ("*" = qualquer item). */
type LojaDeDominio = LojaVtex & { categorias: string[] | "*" };
const DADOS = (lojasJson as unknown as { lojas: LojaDeDominio[] }).lojas;

/** Todas as lojas conhecidas (a leitura genérica de páginas as exclui: a API delas já foi consultada). */
export const LOJAS_VTEX: LojaVtex[] = DADOS.map(({ nome, dominio }) => ({ nome, dominio }));

/** Lojas que atendem alguma das categorias do item. Sem categoria que bata, só as de "*" (em geral nenhuma). */
export function lojasParaCategorias(ids: string[]): LojaVtex[] {
  return DADOS.filter((l) => l.categorias === "*" || l.categorias.some((c) => ids.includes(c))).map(({ nome, dominio }) => ({ nome, dominio }));
}

export type ProdutoVtex = {
  loja: LojaVtex;
  titulo: string;
  sku: string;
  seller: string;
  preco: number;
  disponivel: boolean;
  url: string;
  unidade: string | null;
};

type RespostaCatalogo = {
  productName: string;
  linkText: string;
  items: {
    itemId: string;
    measurementUnit?: string;
    sellers: { sellerId: string; commertialOffer: { Price: number; AvailableQuantity: number } }[];
  }[];
}[];

export async function catalogoVtex(loja: LojaVtex, consulta: string, max = 12): Promise<ProdutoVtex[]> {
  const url = `https://${loja.dominio}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(consulta)}&_from=0&_to=${max - 1}`;
  const r = await comCache("vtex-catalogo", `${loja.dominio}|${consulta}`, { pago: false }, async () => {
    const res = await buscarHttp(url);
    if (!res.ok && res.status !== 206) throw new Error(`${loja.nome}: HTTP ${res.status}`);
    return (await res.json()) as RespostaCatalogo;
  });
  if (!r) return [];
  const produtos: ProdutoVtex[] = [];
  for (const p of r.valor) {
    const item = p.items?.[0];
    if (!item) continue;
    const seller = item.sellers.find((s) => s.commertialOffer.AvailableQuantity > 0) ?? item.sellers[0];
    if (!seller || !(seller.commertialOffer.Price > 0)) continue;
    produtos.push({
      loja,
      titulo: p.productName,
      sku: item.itemId,
      seller: seller.sellerId,
      preco: seller.commertialOffer.Price,
      disponivel: seller.commertialOffer.AvailableQuantity > 0,
      url: `https://${loja.dominio}/${p.linkText}/p`,
      unidade: item.measurementUnit ?? null,
    });
  }
  return produtos;
}

export type Simulacao = {
  /** Entrega no CEP: preço e prazo; null quando não entrega. */
  entrega: { preco: number; prazoDias: number | null; nome: string } | null;
  /** Só retirada em loja (frete R$ 0 não é entrega). */
  soRetirada: string | null;
  motivo: string | null;
};

type RespostaSimulacao = {
  items?: { availability?: string }[];
  logisticsInfo?: { slas?: { name: string; deliveryChannel?: string; price: number; shippingEstimate?: string }[] }[];
  messages?: { code?: string; text?: string }[];
};

/** "5bd" (dias úteis) e "3d" viram dias; "2h" vira 0. */
export function diasDoPrazo(estimativa: string | undefined): number | null {
  if (!estimativa) return null;
  const m = /^(\d+)(bd|d|h|m)$/.exec(estimativa);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "h" || m[2] === "m" ? 0 : n;
}

export async function simularFrete(produto: ProdutoVtex, quantidade: number, cep: string): Promise<Simulacao> {
  const cepLimpo = cep.replace(/\D/g, "");
  const qtd = Math.min(999, Math.max(1, Math.ceil(quantidade)));
  const r = await comCache("vtex-simulacao", `${produto.loja.dominio}|${produto.sku}|${qtd}|${cepLimpo}`, { pago: false }, async () => {
    const res = await buscarHttp(`https://${produto.loja.dominio}/api/checkout/pub/orderForms/simulation?sc=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: produto.sku, quantity: qtd, seller: produto.seller }], postalCode: cepLimpo, country: "BRA" }),
    });
    if (!res.ok) throw new Error(`${produto.loja.nome}: simulação HTTP ${res.status}`);
    return (await res.json()) as RespostaSimulacao;
  });
  if (!r) return { entrega: null, soRetirada: null, motivo: "Sem simulação guardada" };
  const d = r.valor;
  const disp = d.items?.[0]?.availability;
  const slas = d.logisticsInfo?.flatMap((l) => l.slas ?? []) ?? [];
  const entregas = slas.filter((s) => s.deliveryChannel === "delivery").sort((a, b) => a.price - b.price);
  const retiradas = slas.filter((s) => s.deliveryChannel === "pickup-in-point");
  if (entregas[0]) {
    return { entrega: { preco: entregas[0].price / 100, prazoDias: diasDoPrazo(entregas[0].shippingEstimate), nome: entregas[0].name }, soRetirada: null, motivo: null };
  }
  if (retiradas[0]) return { entrega: null, soRetirada: retiradas[0].name, motivo: "Só retirada na loja para este CEP" };
  const motivo = disp === "withoutStock" ? "Sem estoque" : disp === "cannotBeDelivered" ? "Não entrega neste CEP" : (d.messages?.[0]?.code ?? "Sem opção de entrega");
  return { entrega: null, soRetirada: null, motivo };
}
