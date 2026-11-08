// R8 e R9: Agente Comparador. Monta o mapa de cotação (Q1) com o cálculo em
// código, pede à IA só a justificativa em texto (com checagem de números) e
// manda ao comprador com os botões de decisão. A IA nunca aprova nada.

import { registrar } from "../../nucleo/registro.ts";
import { dias, quantidade } from "../../texto.ts";
import { referenciasDoItem } from "../busca/internet.ts";
import { verificarVarios, type Verificacao } from "../verificacao/index.ts";
import { and, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../../nucleo/db/cliente.ts";
import { cotacao, evento, fornecedor, historicoCompra, itemPedido, mapaCotacao, mensagem, oferta, pedido } from "../../nucleo/db/schema.ts";
import { gerarTexto } from "../../nucleo/ia/index.ts";
import { contatoAtivoDoFornecedor, enviar, type Botao } from "../../nucleo/mensagens/index.ts";
import { aoEntrarItem, avancarItem, TransicaoConcorrente, TransicaoInvalida, type MudancaItem } from "../../nucleo/orquestrador/index.ts";
import { MAX_AMPLIACOES } from "../../config.ts";
import type { MarcaNegociacao } from "../negociador/index.ts";
import {
  comparar,
  formatarBRL,
  formatarNota,
  MINIMO_PROPOSTAS_VALIDAS,
  mudancasDoMapa,
  type BuscaAutomatica,
  type Comparacao,
  type ItemComparado,
  type Linha,
  type OfertaComparavel,
} from "./calculo.ts";

export * from "./calculo.ts";

const num = (v: string | null) => (v === null ? null : Number(v));

/** O que o comparador lê de `oferta.extraido` (jsonb sem tipo): guardrails, aderência, Q1 e a marca do desconto. */
type ExtraidoLido = {
  alertas?: unknown;
  divergencias?: unknown;
  aConfirmar?: unknown;
  precoUnitario?: unknown;
  totalProduto?: unknown;
  negociacao?: Partial<MarcaNegociacao>;
};
const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** Mesmo critério de `marcaDe` (negociador): só vale a marca com `pedidaEm`. Lido aqui para não criar ciclo de import. */
function marcaDoExtraido(extraido: unknown): Partial<MarcaNegociacao> | null {
  const m = (extraido as ExtraidoLido | null)?.negociacao;
  return m && typeof m.pedidaEm === "string" ? m : null;
}

export function lerExtraido(extraido: unknown): Pick<OfertaComparavel, "alertasConduta" | "divergencias" | "aConfirmar" | "precoLido" | "negociacao"> {
  const e = (extraido ?? {}) as ExtraidoLido;
  const marca = marcaDoExtraido(extraido);
  const aConfirmar = textos(e.aConfirmar).filter((x): x is "preco" | "item" => x === "preco" || x === "item");
  return {
    alertasConduta: textos(e.alertas),
    divergencias: textos(e.divergencias),
    aConfirmar,
    precoLido: aConfirmar.includes("preco") ? (numero(e.precoUnitario) ?? numero(e.totalProduto)) : null,
    negociacao: marca
      ? {
          resultado: marca.resultado ?? null,
          ...(typeof marca.descontoFrete === "number" ? { descontoFrete: marca.descontoFrete } : {}),
          ...(marca.condicao ? { condicao: marca.condicao } : {}),
        }
      : null,
  };
}

async function carregar(itemPedidoId: number, opcoes: { verificar?: boolean } = {}) {
  const [l] = await db
    .select({ item: itemPedido, pedido })
    .from(itemPedido)
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .where(eq(itemPedido.id, itemPedidoId));
  if (!l) return null;

  // A proposta mais recente de cada fornecedor, até a rodada atual: quem não respondeu à
  // negociação mantém a anterior. Fica de fora quem desistiu, pediu PARAR ou foi tirado do mapa.
  const todas = await db
    .select({ oferta, fornecedor, situacao: cotacao.situacao })
    .from(oferta)
    .innerJoin(fornecedor, eq(fornecedor.id, oferta.fornecedorId))
    .leftJoin(cotacao, eq(cotacao.id, oferta.cotacaoId))
    .where(and(eq(oferta.itemPedidoId, itemPedidoId), lte(oferta.rodada, l.item.rodada)))
    .orderBy(desc(oferta.rodada), desc(oferta.criadoEm));
  const fora = new Set([
    ...l.item.excluidos,
    ...todas.filter((x) => x.situacao === "desistiu" || x.situacao === "parou" || x.fornecedor.parouEm).map((x) => x.fornecedor.id),
  ]);
  const vistos = new Set<string>();
  const validasParaComparar = todas.filter((x) => {
    if (fora.has(x.fornecedor.id) || vistos.has(x.fornecedor.id)) return false;
    vistos.add(x.fornecedor.id);
    return true;
  });
  const qtd = Number(l.item.quantidade);
  const produtoDe = (o: { totalProduto: string | number | null; precoUnitario: string | number | null }) =>
    o.totalProduto !== null ? Number(o.totalProduto) : o.precoUnitario !== null ? Number(o.precoUnitario) * qtd : null;
  /**
   * X3 e I1: produto da proposta mais antiga do fornecedor, para mostrar quanto a negociação baixou.
   * Na mesma rodada a oferta é trocada (delete + insert), então o "antes" do pedido automático
   * de desconto mora na marca; entre rodadas, na oferta da rodada mais antiga.
   */
  const produtoOriginal = (fornecedorId: string, atualId: string): number | null => {
    const doFornecedor = todas.filter((x) => x.fornecedor.id === fornecedorId);
    const primeira = doFornecedor[doFornecedor.length - 1]!.oferta;
    const marca = marcaDoExtraido(primeira.extraido);
    if (marca?.antes) return produtoDe(marca.antes);
    return primeira.id !== atualId ? produtoDe(primeira) : null;
  };
  /** A marca mais recente do fornecedor neste item: a do pedido automático vale em qualquer rodada. */
  const extraidoComMarca = (fornecedorId: string) => todas.find((x) => x.fornecedor.id === fornecedorId && marcaDoExtraido(x.oferta.extraido))?.oferta.extraido;

  const ids = [...new Set(validasParaComparar.map((x) => x.fornecedor.id))];
  const conhecidos = new Set(
    ids.length
      ? (await db.select({ id: historicoCompra.fornecedorId }).from(historicoCompra).where(inArray(historicoCompra.fornecedorId, ids))).map((r) => r.id)
      : [],
  );

  // Q8: confere os fornecedores reais antes de comparar. A contagem do Cotador pula: a verificação só muda a nota.
  const verificacoes =
    opcoes.verificar === false ? new Map<string, Verificacao>() : await verificarVarios(validasParaComparar.filter((x) => x.fornecedor.origem === "real").map((x) => x.fornecedor.id));

  const ofertas: OfertaComparavel[] = validasParaComparar.map(({ oferta: o, fornecedor: f }) => ({
    ...lerExtraido(o.extraido),
    negociacao: lerExtraido(extraidoComMarca(f.id)).negociacao,
    id: o.id,
    fornecedorId: f.id,
    fornecedorNome: f.nome,
    simulado: f.origem === "simulado",
    verificado: f.verificado,
    homologado: f.homologado,
    conhecido: conhecidos.has(f.id),
    confiancaFornecedor: verificacoes.get(f.id)?.pontos ?? null,
    alertasFornecedor: verificacoes.get(f.id)?.alertas ?? [],
    itemOferecido: o.itemOferecido,
    itemExato: o.itemExato,
    precoUnitario: num(o.precoUnitario),
    totalProduto: num(o.totalProduto),
    frete: num(o.frete),
    impostosValor: num(o.impostosValor),
    impostosNaoInclusos: o.impostosNaoInclusos,
    prazoDias: o.prazoDias,
    validadeDias: o.validadeDias,
    pagamento: o.pagamento,
    prazoPagamentoDias: o.prazoPagamentoDias,
    entregaNoLocal: o.entregaNoLocal,
    precoConfirmado: o.precoConfirmado,
    rodada: o.rodada,
    produtoAnterior: produtoOriginal(f.id, o.id),
    online: o.formato === "busca",
    fonte: o.fonte,
  }));

  const [respostas] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cotacao)
    .where(and(eq(cotacao.itemPedidoId, itemPedidoId), eq(cotacao.rodada, l.item.rodada)));
  const brutas = new Map(validasParaComparar.map((x) => [x.oferta.id, x.oferta]));
  return { ...l, ofertas, brutas, verificacoes, consultados: respostas?.n ?? 0 };
}

const itemComparado = (d: { item: typeof itemPedido.$inferSelect; pedido: typeof pedido.$inferSelect }): ItemComparado => ({
  quantidade: Number(d.item.quantidade),
  aceitaSimilar: d.item.aceitaSimilar,
  prazoMaxDias: d.pedido.prazoMaxDias,
  modoEntrega: d.pedido.modoEntrega,
  urgencia: d.pedido.urgencia,
});

/**
 * I3: propostas válidas do item pelos mesmos portões do mapa, sem a verificação externa
 * de CNPJ (ela só muda a nota). O Cotador usa para decidir se busca mais fornecedores.
 */
export async function contarPropostasValidas(itemPedidoId: number): Promise<number> {
  const d = await carregar(itemPedidoId, { verificar: false });
  if (!d) return 0;
  const refs = await referenciasDoItem(itemPedidoId);
  return comparar(itemComparado(d), d.ofertas, refs.mediana).validas.length;
}

/** I3: fornecedores que a busca automática acrescentou na rodada (eventos do Cotador) e em quantas levas. */
export async function buscaAutomaticaDoItem(item: { id: number; rodada: number; ampliacoes: number }, urgencia: string): Promise<BuscaAutomatica | null> {
  const eventos = await db
    .select({ fornecedorIds: evento.fornecedorIds })
    .from(evento)
    .where(
      and(
        eq(evento.itemPedidoId, item.id),
        eq(evento.agente, "Cotador"),
        sql`${evento.dados}->>'tipo' = 'ampliacao'`,
        sql`(${evento.dados}->>'rodada')::int = ${item.rodada}`,
      ),
    );
  const levas = Math.max(item.ampliacoes, eventos.length);
  if (!levas) return null;
  const fornecedores = new Set(eventos.flatMap((e) => e.fornecedorIds ?? [])).size;
  return { fornecedores, levas, teto: urgencia === "normal" ? MAX_AMPLIACOES() : 1 };
}

/** Frase do mapa sobre a busca automática ("Consultei mais 5 fornecedores em 2 levas..."). */
export function textoBuscaAutomatica(b: BuscaAutomatica, validas: number): string {
  const quem = b.fornecedores ? `mais ${b.fornecedores} ${b.fornecedores === 1 ? "fornecedor" : "fornecedores"}` : "mais fornecedores";
  const frase = `Busca automática: consultei ${quem} em ${b.levas} ${b.levas === 1 ? "leva" : "levas"}, porque faltavam propostas válidas.`;
  // Com menos de 3 mesmo assim, diz quando parou pelo teto. Abaixo do teto o motivo pode ser
  // falta de candidatos ou fornecedor tirado do mapa: o registro do Cotador sabe, o mapa não chuta.
  if (validas >= MINIMO_PROPOSTAS_VALIDAS || b.levas < b.teto) return frase;
  return `${frase} Parei no limite de ${b.teto} ${b.teto === 1 ? "leva" : "levas"}.`;
}

const nomeComSelo = (o: OfertaComparavel) => `${o.fornecedorNome}${o.simulado ? " (simulado)" : o.online ? " (loja online)" : ""}`;

/** Frete como o mapa mostra: informado, estimado ou "a calcular no site" (Q8), com a estimativa à parte. */
export function textoFrete(l: Pick<Linha, "origemFrete" | "frete">): string {
  if (l.origemFrete === "nao_se_aplica") return "retirada";
  if (l.origemFrete === "a_calcular") return `frete a calcular no site (estimado ${formatarBRL(l.frete)} só para comparar)`;
  return `frete ${formatarBRL(l.frete)} (${l.origemFrete})`;
}

export function linhaMapa(l: Linha, i: number, verificacoes: Map<string, Verificacao> = new Map()): string {
  const o = l.oferta;
  const total = l.origemFrete === "a_calcular" ? "Total estimado" : "Total";
  const partes = [
    `${i + 1}. ${nomeComSelo(o)}`,
    `   ${total} ${formatarBRL(l.custo!)}: produto ${formatarBRL(l.produto!)} + ${textoFrete(l)}${l.impostos ? ` + impostos ${formatarBRL(l.impostos)}` : ""}`,
    `   Entrega em ${dias(o.prazoDias!)} · pagamento: ${o.pagamento ?? "não informado"} · nota ${formatarNota(l.nota!)}`,
  ];
  const v = verificacoes.get(o.fornecedorId);
  if (v && !o.simulado) partes.push(`   ${v.resumo}`);
  if (l.negociacao) partes.push(`   ${l.negociacao}`);
  if (!o.itemExato) partes.push(`   Equivalente: ${o.itemOferecido}`);
  // Link do Google Shopping aponta para o Google, não para a loja: não ajuda o comprador.
  if (o.online && o.fonte && !/google\.[a-z.]+\/search/.test(o.fonte)) partes.push(`   Anúncio: ${o.fonte}`);
  if (l.alertas.length) partes.push(`   Atenção: ${l.alertas.join("; ")}`);
  return partes.join("\n");
}

/** Template usado quando a IA falha ou cita número que não está no mapa. */
export function justificativaPadrao(c: Comparacao, urgencia: string): string {
  const v = c.vencedora!;
  const partes: string[] = [];
  if (c.podeDizerMelhor) partes.push(`${nomeComSelo(v.oferta)} tem a melhor nota com os critérios atuais.`);
  else partes.push(`${nomeComSelo(v.oferta)} ficou na frente entre as propostas válidas.`);
  if (c.maisBarata && c.maisBarata.oferta.id !== v.oferta.id) {
    partes.push(
      urgencia === "normal"
        ? `Custa ${formatarBRL(c.aMaisQueAMaisBarata)} a mais que a mais barata, compensados por prazo, confiança ou pagamento.`
        : `Custa ${formatarBRL(c.aMaisQueAMaisBarata)} a mais que a mais barata, mas entrega antes, e o pedido é urgente.`,
    );
  } else {
    partes.push("É também a de menor custo total.");
  }
  return partes.join(" ");
}

function valoresPermitidos(c: Comparacao): Set<string> {
  const s = new Set<string>();
  for (const l of [...c.validas, ...c.cortadas]) {
    for (const v of [l.custo, l.produto, l.frete, l.impostos, l.precoUnitarioEfetivo]) if (v !== null) s.add(formatarBRL(v));
  }
  s.add(formatarBRL(c.aMaisQueAMaisBarata));
  return s;
}

async function justificar(c: Comparacao, urgencia: string, ctx: { pedidoId: number; itemPedidoId: number }) {
  const ehAMaisBarata = !c.maisBarata || c.maisBarata.oferta.id === c.vencedora!.oferta.id;
  const resumo = {
    urgencia: { normal: "sem urgência", urgente: "pedido urgente", obra_parada: "atividade parada, prazo pesa o dobro" }[urgencia] ?? urgencia,
    pesos: c.pesos,
    podeDizerMelhor: c.podeDizerMelhor,
    vencedoraEhAMaisBarata: ehAMaisBarata,
    aMaisQueAMaisBarata: ehAMaisBarata ? null : formatarBRL(c.aMaisQueAMaisBarata),
    validas: c.validas.map((l) => ({
      fornecedor: nomeComSelo(l.oferta),
      total: formatarBRL(l.custo!),
      prazoDias: l.oferta.prazoDias,
      pagamento: l.oferta.pagamento,
      nota: formatarNota(l.nota!),
      criterios: Object.fromEntries(Object.entries(l.criterios!).map(([k, v]) => [k, Math.round(v)])),
      alertas: l.alertas,
    })),
    cortadas: c.cortadas.map((l) => ({ fornecedor: nomeComSelo(l.oferta), motivos: l.motivos })),
  };
  try {
    const r = await gerarTexto({
      papel: "forte",
      sistema:
        "Você explica ao comprador por que a primeira proposta da lista válida ficou na frente. " +
        "A ordem e as notas já foram calculadas: não recalcule nem mude a ordem. Use só valores que aparecem no JSON, exatamente como estão escritos. " +
        "Se podeDizerMelhor for false, nunca use a palavra 'melhor'. Se vencedoraEhAMaisBarata for true, diga que ela também é a de menor custo; senão, diga quanto custa a mais que a mais barata (aMaisQueAMaisBarata). " +
        "Português simples, no máximo 3 frases, sem listas e sem markdown.",
      prompt: JSON.stringify(resumo),
      contexto: { agente: "Comparador", ...ctx },
    });
    const texto = r.valor.trim();
    const permitidos = valoresPermitidos(c);
    const citados = texto.match(/R\$\s?[\d.]+,\d{2}/g) ?? [];
    const inventado = citados.some((v) => !permitidos.has(v.replace(/R\$\s?/, "R$ ")));
    if (!texto || inventado || (!c.podeDizerMelhor && /\bmelhor\b/i.test(texto))) return justificativaPadrao(c, urgencia);
    return texto;
  } catch {
    return justificativaPadrao(c, urgencia);
  }
}

export function botoesDecisao(itemPedidoId: number, c: Comparacao): Botao[] {
  const b: Botao[] = [];
  if (c.vencedora) b.push({ rotulo: `Aprovar ${c.vencedora.oferta.fornecedorNome}`, dado: `item:${itemPedidoId}:aprovar:${c.vencedora.oferta.id}` });
  if (c.validas.length > 1) b.push({ rotulo: "Escolher outra", dado: `item:${itemPedidoId}:outras` });
  b.push({ rotulo: "Reprovar", dado: `item:${itemPedidoId}:motivos` });
  return b;
}

/**
 * Q6 e U6: o mapa anterior da mesma rodada perde os botões (que apontariam para a
 * recomendação velha) e vira uma linha "substituído"; o mapa novo vai como mensagem
 * nova, para o comprador ser avisado. Só o Telegram edita mensagem.
 */
async function substituirMapaAnterior(compradorId: string, item: { id: number; pedidoId: number }, cabecalho: string) {
  const [anterior] = await db
    .select({ idExterno: mensagem.idExterno })
    .from(mensagem)
    .where(
      and(
        eq(mensagem.contatoId, compradorId),
        eq(mensagem.itemPedidoId, item.id),
        eq(mensagem.direcao, "saida"),
        eq(mensagem.situacao, "enviada"),
        eq(mensagem.canal, "telegram"),
        isNotNull(mensagem.idExterno),
        sql`${mensagem.botoes} @> ${JSON.stringify([{ dado: `item:${item.id}:motivos` }])}::jsonb`,
      ),
    )
    .orderBy(desc(mensagem.criadoEm))
    .limit(1);
  if (!anterior?.idExterno) return;
  await enviar(compradorId, `${cabecalho}\nMapa substituído: a versão atualizada vem logo abaixo.`, {
    pedidoId: item.pedidoId,
    itemPedidoId: item.id,
    tipo: "aviso",
    substitui: anterior.idExterno,
  });
}

async function montarMapa(m: MudancaItem) {
  const d = await carregar(m.itemPedidoId);
  if (!d) return;
  const { item, pedido: p } = d;
  const refs = await referenciasDoItem(item.id);
  const c: Comparacao = comparar(itemComparado(d), d.ofertas, refs.mediana);
  c.buscaAutomatica = await buscaAutomaticaDoItem(item, p.urgencia);
  // Lojas que já viraram proposta não se repetem na referência.
  const naProposta = new Set(d.ofertas.filter((o) => o.online).map((o) => o.fornecedorId));
  const blocoReferencia = textoReferencias({ ...refs, aceitas: refs.aceitas.filter((r) => !r.fornecedorId || !naProposta.has(r.fornecedorId)) }, item.unidade);
  const cabecalho = `Pedido ${p.id} · ${quantidade(item.quantidade, item.unidade)} de ${item.descricao}`;
  // Q6: já houve mapa nesta rodada: este é o mapa refeito (preço confirmado, fornecedor tirado...).
  const anterior = await ultimoMapa(item.id);
  const refeito = anterior && anterior.rodada === item.rodada ? anterior : null;
  const busca = c.buscaAutomatica ? textoBuscaAutomatica(c.buscaAutomatica, c.validas.length) : null;

  if (!c.vencedora) {
    const cortes = c.cortadas.map((l) => `- ${nomeComSelo(l.oferta)}: ${l.motivos.join("; ")}`);
    await avancarItem(m.itemPedidoId, "sem_propostas_validas", {
      agente: "Comparador",
      acao: "Nenhuma proposta passou nas regras.",
      motivo: d.ofertas.length ? `Cortadas: ${c.cortadas.map((l) => `${l.oferta.fornecedorNome} (${l.motivos.join(", ")})`).join("; ")}.` : "Nenhum fornecedor mandou proposta.",
      dados: { comparacao: c },
    }).catch(ignorarCorrida);
    if (refeito) await substituirMapaAnterior(p.compradorId, item, cabecalho);
    const texto = [
      refeito ? `${cabecalho}\nMapa atualizado.` : cabecalho,
      "",
      d.ofertas.length ? "Nenhuma proposta passou nas regras:" : `Nenhum dos ${d.consultados} fornecedores consultados mandou proposta.`,
      ...cortes,
      ...(busca ? ["", busca] : []),
      ...blocoReferencia,
    ].join("\n");
    await enviar(p.compradorId, texto, { pedidoId: p.id, itemPedidoId: item.id, tipo: "aviso" });
    return;
  }

  let justificativaMenosDeTres: string | null = null;
  if (c.validas.length < MINIMO_PROPOSTAS_VALIDAS) {
    justificativaMenosDeTres =
      p.urgencia !== "normal"
        ? `Apenas ${c.validas.length} ${c.validas.length === 1 ? "proposta válida" : "propostas válidas"}: pedido urgente, esperar mais custaria mais que o ganho da comparação.`
        : `Apenas ${c.validas.length} ${c.validas.length === 1 ? "proposta válida" : "propostas válidas"}: poucos fornecedores responderam a tempo.`;
    // I3: diz que a busca automática já tentou e por que parou.
    if (busca) justificativaMenosDeTres += ` ${busca}`;
  }

  const recomendacao = await justificar(c, p.urgencia, { pedidoId: p.id, itemPedidoId: item.id });
  await db.insert(mapaCotacao).values({
    itemPedidoId: item.id,
    rodada: item.rodada,
    dados: c,
    recomendacao,
    ofertaRecomendadaId: c.vencedora.oferta.id,
  });

  try {
    await avancarItem(
      m.itemPedidoId,
      "mapa_pronto",
      {
        agente: "Comparador",
        acao: `${refeito ? "Refez" : "Montou"} o mapa com ${c.validas.length} ${c.validas.length === 1 ? "proposta válida" : "propostas válidas"} e recomendou ${c.vencedora.oferta.fornecedorNome}.`,
        motivo: recomendacao,
        fornecedorIds: c.validas.map((l) => l.oferta.fornecedorId),
        dados: { pesos: c.pesos, referenciaUnitaria: c.referenciaUnitaria, referenciaOnline: c.referenciaOnline ?? null, buscaAutomatica: c.buscaAutomatica ?? null },
      },
      { justificativaMenosDeTres },
    );
  } catch (erro) {
    ignorarCorrida(erro);
    return;
  }

  const texto = textoMapa({
    c,
    cabecalho,
    rodada: item.rodada,
    recebidas: d.ofertas.length,
    consultados: d.consultados,
    verificacoes: d.verificacoes,
    recomendacao,
    justificativaMenosDeTres,
    urgente: p.urgencia !== "normal",
    pagamentoPreferido: p.pagamentoPreferido,
    busca: c.validas.length >= MINIMO_PROPOSTAS_VALIDAS ? busca : null,
    blocoReferencia,
    aviso: refeito
      ? `Mapa atualizado${(() => {
          const mudou = mudancasDoMapa(refeito.comparacao, c);
          return mudou.length ? `: ${mudou.join("; ")}` : "";
        })()}.`
      : m.de === "cotando" && item.negociacao && item.negociacao.rodada === item.rodada
        ? "Mapa depois da negociação."
        : null,
  });

  if (refeito) await substituirMapaAnterior(p.compradorId, item, cabecalho);
  await enviar(p.compradorId, texto, { pedidoId: p.id, itemPedidoId: item.id, botoes: botoesDecisao(item.id, c), tipo: "aviso" });
  // Só depois do mapa pronto: a resposta do fornecedor encontra o item esperando a decisão.
  await pedirConfirmacaoDePreco(d, c);
}

/** Texto do mapa para o chat (Telegram, e-mail, web). Função pura: os testes leem o mesmo texto que o comprador. */
export function textoMapa(a: {
  c: Comparacao;
  cabecalho: string;
  rodada: number;
  recebidas: number;
  consultados: number;
  verificacoes?: Map<string, Verificacao>;
  recomendacao: string;
  justificativaMenosDeTres?: string | null;
  urgente: boolean;
  pagamentoPreferido?: string | null;
  busca?: string | null;
  blocoReferencia?: string[];
  aviso?: string | null;
}): string {
  const { c } = a;
  const lojasOnline = [...c.validas, ...c.cortadas].filter((l) => l.oferta.online).length;
  const texto = [
    a.aviso ? `${a.cabecalho}\n${a.aviso}` : a.cabecalho,
    `Mapa de cotação${a.rodada > 1 ? `, rodada ${a.rodada}` : ""}: ${c.validas.length} ${c.validas.length === 1 ? "proposta válida" : "propostas válidas"} de ${a.recebidas} recebidas (${a.consultados} ${a.consultados === 1 ? "fornecedor consultado" : "fornecedores consultados"}${lojasOnline ? ` e ${lojasOnline} ${lojasOnline === 1 ? "loja online" : "lojas online"}` : ""}).`,
  ];
  if (a.busca) texto.push(a.busca);
  if (a.pagamentoPreferido) texto.push(`Pagamento preferido: ${a.pagamentoPreferido}. Cada proposta mostra a forma que o fornecedor aceita.`);
  texto.push("", ...c.validas.map((l, i) => linhaMapa(l, i, a.verificacoes)));
  // Q1/R8: quem só espera confirmar o preço não é "fora": aparece à parte, como "a confirmar".
  const aConfirmar = c.cortadas.filter((l) => l.aConfirmar);
  const fora = c.cortadas.filter((l) => !l.aConfirmar);
  if (aConfirmar.length) {
    texto.push("", "A confirmar com o fornecedor (fora do ranking até responder):");
    for (const l of aConfirmar) texto.push(`- ${nomeComSelo(l.oferta)}: ${l.motivos.join("; ")}`);
  }
  if (fora.length) {
    texto.push("", "Fora da comparação:");
    for (const l of fora) texto.push(`- ${nomeComSelo(l.oferta)}: ${l.motivos.join("; ")}`);
  }
  texto.push(...(a.blocoReferencia ?? []));
  if (c.vencedora) texto.push("", `${c.podeDizerMelhor ? "Recomendo" : "Na frente"}: ${c.vencedora.oferta.fornecedorNome}. ${a.recomendacao}`);
  if (a.justificativaMenosDeTres) texto.push("", a.justificativaMenosDeTres);
  if (a.urgente) texto.push("", "O prazo pesa o dobro porque o pedido é urgente.");
  return texto.join("\n");
}

const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** Bloco "Referência pública": preço real da internet, com fonte, data e frete para o CEP. */
export function textoReferencias(refs: Awaited<ReturnType<typeof referenciasDoItem>>, unidade: string): string[] {
  if (!refs.aceitas.length) return [];
  const linhas = ["", `Referência pública (internet${refs.mediana !== null ? `, mediana ${formatarBRL(refs.mediana)} por ${unidade}` : ""}):`];
  for (const r of refs.aceitas.slice(0, 3)) {
    const preco = r.precoUnitario !== null ? `${formatarBRL(Number(r.precoUnitario))} por ${unidade}` : formatarBRL(Number(r.precoFonte));
    const entrega =
      r.entregaNoCep === true && r.frete !== null
        ? `entrega no CEP por ${formatarBRL(Number(r.frete))}${r.fretePrazoDias !== null ? ` em ${dias(r.fretePrazoDias)}` : ""}`
        : (r.regiaoDoPreco ?? "");
    const estoque = `${r.disponivel === false ? " · sem estoque" : ""}${r.cnpjAtivo ? " · CNPJ ativo" : ""}`;
    linhas.push(`- ${r.loja}: ${preco}${r.conversao ? ` (${r.conversao})` : ""}${estoque}${entrega ? ` · ${entrega}` : ""} · coletado às ${hora(r.coletadoEm)}`);
    linhas.push(`  ${r.url}`);
  }
  return linhas;
}

/**
 * R8: preço muito abaixo da referência fica retido. Em vez de só cortar, pergunta
 * ao fornecedor se é isso mesmo (uma vez por proposta). Se ele confirmar, o mapa é refeito.
 */
async function pedirConfirmacaoDePreco(d: NonNullable<Awaited<ReturnType<typeof carregar>>>, c: Comparacao) {
  for (const l of c.cortadas) {
    if (l.portoes.naoRetida) continue;
    const bruta = d.brutas.get(l.oferta.id);
    if (!bruta || bruta.confirmacaoPedidaEm || bruta.precoConfirmado) continue;
    const ct = await contatoAtivoDoFornecedor(l.oferta.fornecedorId);
    if (!ct) continue;
    const unit = l.precoUnitarioEfetivo !== null ? `${formatarBRL(l.precoUnitarioEfetivo)} por ${d.item.unidade}` : formatarBRL(l.produto ?? 0);
    const texto =
      `Sobre a cotação ${d.item.id} (${quantidade(d.item.quantidade, d.item.unidade)} de ${d.item.descricao}): ` +
      `o seu preço de ${unit} ficou bem abaixo das outras propostas. Pode confirmar que é esse valor mesmo, para o item pedido e entregue no local? ` +
      "Responda SIM para confirmar.";
    const r = await enviar(ct.id, texto, { pedidoId: d.pedido.id, itemPedidoId: d.item.id, tipo: "confirmar_preco" });
    if (r.situacao !== "enviada") continue;
    await db.update(oferta).set({ confirmacaoPedidaEm: new Date() }).where(eq(oferta.id, l.oferta.id));
    await registrar(db, {
      agente: "Comparador",
      acao: `Pediu a ${l.oferta.fornecedorNome} para confirmar o preço.`,
      motivo: `Preço ${Math.round(l.abaixoDaReferencia * 100)}% abaixo da referência: fica retido até o fornecedor confirmar.`,
      pedidoId: d.pedido.id,
      itemPedidoId: d.item.id,
      fornecedorIds: [l.oferta.fornecedorId],
    });
  }
}

function ignorarCorrida(erro: unknown) {
  if (erro instanceof TransicaoInvalida || erro instanceof TransicaoConcorrente) return;
  throw erro;
}

/** Último mapa do item, para a decisão. */
export async function ultimoMapa(itemPedidoId: number) {
  const [m] = await db
    .select()
    .from(mapaCotacao)
    .where(eq(mapaCotacao.itemPedidoId, itemPedidoId))
    .orderBy(sql`${mapaCotacao.criadoEm} desc`)
    .limit(1);
  return m ? { ...m, comparacao: m.dados as Comparacao } : null;
}

export function ligarComparador() {
  aoEntrarItem("comparando", montarMapa);
}
