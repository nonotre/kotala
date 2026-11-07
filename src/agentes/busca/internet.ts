// R3: busca real na internet, em etapas, com o motivo de cada corte.
// Entende → Coleta (VTEX, Serper, páginas) → Filtra → Confere → Ordena.
// O resultado é preço de referência com fonte e data, nunca proposta inventada.

import { and, eq } from "drizzle-orm";
import { db } from "../../nucleo/db/cliente.ts";
import { fornecedor, itemPedido, oferta, pedido, referenciaPreco } from "../../nucleo/db/schema.ts";
import { registrar } from "../../nucleo/registro.ts";
import { verificarVarios } from "../verificacao/index.ts";
import { planejar } from "./entende.ts";
import { confianca, converter, mediana, normalizar, ordenar, relevante, type Termos } from "./filtro.ts";
import { baixarPagina, precoDoJsonLd, precoPorIa } from "./pagina.ts";
import { LimiteDeBusca, MAX_CONSULTAS_ITEM, MODO_SNAPSHOT } from "./rede.ts";
import * as serper from "./serper.ts";
const { shopping, temSerper, web } = serper;
import { catalogoVtex, LOJAS_VTEX, simularFrete } from "./vtex.ts";

/** Sites que bloqueiam leitura automática ou exigem login: não tenta. */
const NAO_LER = /mercadolivre|mercadolibre|magazineluiza|magalu|casasbahia|americanas|amazon\.|shopee|olx|facebook|instagram|youtube|leroymerlin/i;
const MAX_PAGINAS = 4;
const MAX_IA_PAGINAS = 2;

type Coleta = {
  loja: string;
  dominio: string;
  titulo: string;
  url: string;
  metodo: "vtex_api" | "jsonld" | "ia_trecho" | "serper_shopping";
  precoFonte: number;
  disponivel: boolean | null;
  frete: number | null;
  fretePrazoDias: number | null;
  entregaNoCep: boolean | null;
  regiaoDoPreco: string | null;
  trecho: string | null;
};

type Avaliada = Coleta & {
  aceita: boolean;
  motivoCorte: string | null;
  precoUnitario: number | null;
  conversao: string | null;
  confianca: number;
};

/** Tira parâmetros de rastreamento do link (srsltid, utm_*, gclid...). */
export function limparUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(srsltid|utm_|gclid|gbraid|wbraid|fbclid|_gl$|ref$)/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return url;
  }
}

const dominioDe = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

function avaliar(c: Coleta, termos: Termos, unidadePedido: string): Avaliada {
  const base = { ...c, precoUnitario: null, conversao: null, confianca: confianca(c.metodo, c.disponivel, c.entregaNoCep) };
  const rel = relevante(c.titulo, termos);
  if (!rel.ok) return { ...base, aceita: false, motivoCorte: rel.motivo! };
  if (!c.url) return { ...base, aceita: false, motivoCorte: "Sem link da fonte" };
  const conv = converter(c.precoFonte, c.titulo, unidadePedido, termos);
  if (conv.corte) return { ...base, aceita: false, motivoCorte: conv.corte };
  return { ...base, aceita: true, motivoCorte: null, precoUnitario: conv.precoUnitario, conversao: conv.conversao };
}

export type ResultadoBusca = {
  aceitas: number;
  lojas: number;
  medianaUnitaria: number | null;
  consultasPagas: number;
  doCache: boolean;
  aviso: string | null;
};

export async function buscarNaInternet(itemPedidoId: number): Promise<ResultadoBusca> {
  const [l] = await db
    .select({ item: itemPedido, pedido })
    .from(itemPedido)
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .where(eq(itemPedido.id, itemPedidoId));
  if (!l) return { aceitas: 0, lojas: 0, medianaUnitaria: null, consultasPagas: 0, doCache: false, aviso: "Item não existe" };
  const { item, pedido: p } = l;
  const ctx = { pedidoId: p.id, itemPedidoId };
  const quantidade = Number(item.quantidade);

  // 1. Entende
  const plano = await planejar({ descricao: item.descricao, unidade: item.unidade, especificacao: item.especificacao }, ctx);
  const consulta = plano.consultas[0]!;

  const coletas: Coleta[] = [];
  const falhas: string[] = [];
  const pagasAntes = serper.pagasNesteProcesso;
  let aviso: string | null = null;

  // 2a. Coleta nas lojas VTEX (sem crédito), com frete real para o CEP.
  for (const loja of LOJAS_VTEX) {
    try {
      const produtos = await catalogoVtex(loja, consulta);
      const relevantes = produtos.filter((pr) => relevante(pr.titulo, plano.termos).ok);
      // Frete só para os 2 primeiros relevantes de cada loja: poupa chamadas.
      for (const [i, pr] of relevantes.slice(0, 4).entries()) {
        let frete: number | null = null;
        let prazo: number | null = null;
        let entregaNoCep: boolean | null = null;
        let regiao: string | null = "Região padrão do site";
        if (p.cep && i < 2 && pr.disponivel) {
          try {
            const s = await simularFrete(pr, quantidade, p.cep);
            if (s.entrega) {
              frete = s.entrega.preco;
              prazo = s.entrega.prazoDias;
              entregaNoCep = true;
              regiao = `Entrega no CEP ${p.cep}`;
            } else {
              entregaNoCep = false;
              regiao = s.soRetirada ? `Só retirada (${s.soRetirada})` : (s.motivo ?? "Não entrega no CEP");
            }
          } catch (e) {
            falhas.push(`${loja.nome} (frete): ${e instanceof Error ? e.message : e}`);
          }
        }
        coletas.push({
          loja: loja.nome,
          dominio: loja.dominio,
          titulo: pr.titulo,
          url: pr.url,
          metodo: "vtex_api",
          precoFonte: pr.preco,
          disponivel: pr.disponivel,
          frete,
          fretePrazoDias: prazo,
          entregaNoCep,
          regiaoDoPreco: regiao,
          trecho: null,
        });
      }
      // Os não relevantes também entram, para registrar o corte.
      for (const pr of produtos.filter((x) => !relevantes.includes(x)).slice(0, 3)) {
        coletas.push({ loja: loja.nome, dominio: loja.dominio, titulo: pr.titulo, url: pr.url, metodo: "vtex_api", precoFonte: pr.preco, disponivel: pr.disponivel, frete: null, fretePrazoDias: null, entregaNoCep: null, regiaoDoPreco: null, trecho: null });
      }
    } catch (e) {
      falhas.push(`${loja.nome}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 2b. Serper: shopping e web, no máximo MAX_CONSULTAS_ITEM consultas pagas.
  if (temSerper() || MODO_SNAPSHOT()) {
    const maxPagas = MAX_CONSULTAS_ITEM();
    try {
      if (maxPagas >= 1) {
        const r = await shopping(consulta);
        for (const s of r.slice(0, 10)) {
          if (s.preco === null) continue;
          coletas.push({
            loja: s.loja,
            dominio: dominioDe(s.link),
            titulo: s.titulo,
            url: s.link,
            metodo: "serper_shopping",
            precoFonte: s.preco,
            disponivel: null,
            frete: null,
            fretePrazoDias: null,
            entregaNoCep: null,
            regiaoDoPreco: s.entrega ? `Google Shopping: ${s.entrega}` : "Google Shopping",
            trecho: `${s.titulo} · ${s.precoTexto}`,
          });
        }
      }
      if (maxPagas >= 2) {
        const r = await web(`${consulta} preço`);
        const vtex = new Set(LOJAS_VTEX.map((x) => x.dominio.replace(/^www\./, "")));
        const paginas = r.filter((o) => !NAO_LER.test(o.link) && !vtex.has(dominioDe(o.link))).slice(0, MAX_PAGINAS);
        let usosIa = 0;
        for (const o of paginas) {
          const html = await baixarPagina(o.link);
          if (!html) {
            falhas.push(`${dominioDe(o.link)}: página não abriu`);
            continue;
          }
          let lido = precoDoJsonLd(html);
          if (!lido && usosIa < MAX_IA_PAGINAS) {
            usosIa++;
            lido = await precoPorIa(html, item.descricao, ctx).catch(() => null);
          }
          if (!lido) {
            falhas.push(`${dominioDe(o.link)}: sem preço legível`);
            continue;
          }
          coletas.push({
            loja: dominioDe(o.link),
            dominio: dominioDe(o.link),
            titulo: lido.titulo || o.titulo,
            url: o.link,
            metodo: lido.metodo,
            precoFonte: lido.preco,
            disponivel: lido.disponivel,
            frete: null,
            fretePrazoDias: null,
            entregaNoCep: null,
            regiaoDoPreco: "Preço do site, sem CEP",
            trecho: lido.trecho,
          });
        }
      }
    } catch (e) {
      if (e instanceof LimiteDeBusca) aviso = e.message;
      falhas.push(`Serper: ${e instanceof Error ? e.message : e}`);
    }
  } else {
    aviso = "Sem SERPER_API_KEY: busca só nas lojas VTEX.";
  }

  const consultasPagas = serper.pagasNesteProcesso - pagasAntes;

  // 3 a 5. Filtra, confere e ordena.
  const avaliadas = ordenar(coletas.map((c) => avaliar(c, plano.termos, item.unidade)));
  const aceitas = avaliadas.filter((a) => a.aceita);
  const coletadoEm = new Date();

  await db.transaction(async (tx) => {
    await tx.delete(referenciaPreco).where(eq(referenciaPreco.itemPedidoId, itemPedidoId));
    for (const a of avaliadas.slice(0, 20)) {
      let fornecedorId: string | null = null;
      if (a.aceita && a.dominio) {
        // Loja real encontrada vira fornecedor conhecido, sem canal: não é contatada.
        // O link do Google Shopping aponta para o Google: aí a chave é o nome da loja, sem site.
        const doShopping = a.metodo === "serper_shopping";
        const [f] = await tx
          .insert(fornecedor)
          .values({
            chave: doShopping ? `loja:${normalizar(a.loja)}` : `web:${a.dominio}`,
            nome: a.loja,
            origem: "real",
            fonte: doShopping ? null : `https://${a.dominio}`,
          })
          .onConflictDoUpdate({ target: fornecedor.chave, set: { nome: a.loja } })
          .returning({ id: fornecedor.id });
        fornecedorId = f!.id;
      }
      await tx.insert(referenciaPreco).values({
        itemPedidoId,
        fornecedorId,
        loja: a.loja,
        titulo: a.titulo.slice(0, 300),
        url: limparUrl(a.url),
        metodo: a.metodo,
        precoFonte: a.precoFonte.toFixed(2),
        unidadeFonte: null,
        precoUnitario: a.precoUnitario?.toFixed(2) ?? null,
        conversao: a.conversao,
        disponivel: a.disponivel,
        frete: a.frete?.toFixed(2) ?? null,
        fretePrazoDias: a.fretePrazoDias,
        entregaNoCep: a.entregaNoCep,
        regiaoDoPreco: a.regiaoDoPreco,
        trecho: a.trecho,
        aceita: a.aceita,
        motivoCorte: a.motivoCorte,
        confianca: a.confianca,
        coletadoEm,
      });
    }
  });

  // Q8: confere o CNPJ das lojas aceitas (no máximo 4; consultas públicas, sem crédito).
  const lojasAceitas = await db
    .select({ id: referenciaPreco.fornecedorId })
    .from(referenciaPreco)
    .where(eq(referenciaPreco.itemPedidoId, itemPedidoId));
  await verificarVarios(lojasAceitas.map((x) => x.id).filter((x): x is string => !!x).slice(0, 4));

  const precos = aceitas.filter((a) => a.disponivel !== false && a.precoUnitario !== null).map((a) => a.precoUnitario!);
  const med = mediana(precos);
  const lojas = new Set(aceitas.map((a) => a.loja)).size;
  const cortes = new Map<string, number>();
  for (const a of avaliadas.filter((x) => !x.aceita)) cortes.set(a.motivoCorte!, (cortes.get(a.motivoCorte!) ?? 0) + 1);

  await registrar(db, {
    agente: "Busca",
    acao: `Buscou "${consulta}" na internet: ${aceitas.length} ${aceitas.length === 1 ? "preço aceito" : "preços aceitos"} de ${lojas} ${lojas === 1 ? "loja" : "lojas"}${med !== null ? `, mediana R$ ${med.toFixed(2).replace(".", ",")} por ${item.unidade}` : ""}.`,
    motivo: [
      consultasPagas ? `${consultasPagas} ${consultasPagas === 1 ? "consulta paga" : "consultas pagas"} no Serper.` : MODO_SNAPSHOT() ? "Modo snapshot: só buscas guardadas." : "Sem consulta paga (resultado guardado ou sem Serper).",
      cortes.size ? `Cortes: ${[...cortes].map(([m, n]) => `${m} (${n})`).join("; ")}.` : "",
      falhas.length ? `Falhas: ${falhas.slice(0, 4).join("; ")}.` : "",
      aviso ?? "",
    ]
      .filter(Boolean)
      .join(" "),
    ...ctx,
    dados: { plano, consultasPagas, falhas },
  });

  return { aceitas: aceitas.length, lojas, medianaUnitaria: med, consultasPagas, doCache: false, aviso };
}

/** Referências aceitas do item, para o mapa e para o Comparador. */
export async function referenciasDoItem(itemPedidoId: number) {
  const brutas = await db
    .select({ r: referenciaPreco, verificado: fornecedor.verificado })
    .from(referenciaPreco)
    .leftJoin(fornecedor, eq(fornecedor.id, referenciaPreco.fornecedorId))
    .where(eq(referenciaPreco.itemPedidoId, itemPedidoId));
  const linhas = brutas.map((b) => ({ ...b.r, cnpjAtivo: b.verificado === true }));
  // Em estoque primeiro, depois as mais confiáveis.
  const aceitas = linhas
    .filter((r) => r.aceita)
    .sort((a, b) => Number(b.disponivel !== false) - Number(a.disponivel !== false) || b.confianca - a.confianca);
  const precos = aceitas.filter((r) => r.disponivel !== false && r.precoUnitario !== null).map((r) => Number(r.precoUnitario));
  return { aceitas, mediana: mediana(precos) };
}

/** Quantas lojas online viram proposta no mapa, no máximo. */
export const MAX_OFERTAS_ONLINE = 3;
/** Dados que o anúncio não traz e ficam simulados até a loja confirmar. */
export const SIMULADO_ONLINE = { prazoDias: 4, pagamento: "Cartão ou PIX à vista", prazoPagamentoDias: 0, validadeDias: 1 } as const;

/**
 * Loja achada na internet vira proposta do mapa (conta para as 3 propostas válidas).
 * Preço e frete vêm do anúncio, com link; prazo de entrega (quando a loja não simula),
 * pagamento e validade ficam simulados e marcados como tal. Refeito a cada busca.
 */
export async function ofertasDaInternet(itemPedidoId: number): Promise<number> {
  const [item] = await db.select().from(itemPedido).where(eq(itemPedido.id, itemPedidoId));
  if (!item) return 0;
  const { aceitas } = await referenciasDoItem(itemPedidoId);
  const escolhidas: typeof aceitas = [];
  const vistos = new Set<string>();
  for (const r of aceitas) {
    if (!r.fornecedorId || r.precoUnitario === null || r.disponivel === false || vistos.has(r.fornecedorId)) continue;
    vistos.add(r.fornecedorId);
    escolhidas.push(r);
    if (escolhidas.length >= MAX_OFERTAS_ONLINE) break;
  }
  await db.transaction(async (tx) => {
    await tx.delete(oferta).where(and(eq(oferta.itemPedidoId, itemPedidoId), eq(oferta.rodada, item.rodada), eq(oferta.formato, "busca")));
    for (const r of escolhidas) {
      const simulados = ["pagamento", "validade", ...(r.fretePrazoDias === null ? ["prazo de entrega"] : []), ...(r.frete === null ? ["frete (estimado no mapa)"] : [])];
      await tx.insert(oferta).values({
        itemPedidoId,
        fornecedorId: r.fornecedorId!,
        rodada: item.rodada,
        itemOferecido: r.titulo,
        itemExato: true,
        precoUnitario: r.precoUnitario,
        frete: r.entregaNoCep && r.frete !== null ? r.frete : null,
        origemFrete: r.entregaNoCep && r.frete !== null ? "informado" : null,
        prazoDias: r.fretePrazoDias ?? SIMULADO_ONLINE.prazoDias,
        validadeDias: SIMULADO_ONLINE.validadeDias,
        pagamento: SIMULADO_ONLINE.pagamento,
        prazoPagamentoDias: SIMULADO_ONLINE.prazoPagamentoDias,
        entregaNoLocal: r.entregaNoCep === false ? false : r.entregaNoCep,
        formato: "busca",
        fonte: r.url,
        extraido: { loja: r.loja, metodo: r.metodo, coletadoEm: r.coletadoEm, simulados },
      });
    }
  });
  if (escolhidas.length) {
    await registrar(db, {
      agente: "Busca",
      acao: `Montou ${escolhidas.length} ${escolhidas.length === 1 ? "proposta" : "propostas"} de loja online: ${escolhidas.map((r) => r.loja).join(", ")}.`,
      motivo: "Preço e frete do anúncio, com link; prazo, pagamento e validade simulados até a loja confirmar.",
      pedidoId: item.pedidoId,
      itemPedidoId,
      fornecedorIds: escolhidas.map((r) => r.fornecedorId!),
    });
  }
  return escolhidas.length;
}
