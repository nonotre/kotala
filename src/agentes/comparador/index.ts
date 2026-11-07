// R8 e R9: Agente Comparador. Monta o mapa de cotação (Q1) com o cálculo em
// código, pede à IA só a justificativa em texto (com checagem de números) e
// manda ao comprador com os botões de decisão. A IA nunca aprova nada.

import { dias, quantidade } from "../../texto.ts";
import { referenciasDoItem } from "../busca/internet.ts";
import { verificarVarios, type Verificacao } from "../verificacao/index.ts";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../nucleo/db/cliente.ts";
import { cotacao, fornecedor, historicoCompra, itemPedido, mapaCotacao, oferta, pedido } from "../../nucleo/db/schema.ts";
import { gerarTexto } from "../../nucleo/ia/index.ts";
import { enviar, type Botao } from "../../nucleo/mensagens/index.ts";
import { aoEntrarItem, avancarItem, TransicaoConcorrente, TransicaoInvalida, type MudancaItem } from "../../nucleo/orquestrador/index.ts";
import { comparar, formatarBRL, formatarNota, MINIMO_PROPOSTAS_VALIDAS, type Comparacao, type Linha, type OfertaComparavel } from "./calculo.ts";

export * from "./calculo.ts";

const num = (v: string | null) => (v === null ? null : Number(v));

async function carregar(itemPedidoId: number) {
  const [l] = await db
    .select({ item: itemPedido, pedido })
    .from(itemPedido)
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .where(eq(itemPedido.id, itemPedidoId));
  if (!l) return null;

  // Ofertas da rodada atual, de quem não desistiu nem pediu PARAR.
  const linhas = await db
    .select({ oferta, fornecedor, situacao: cotacao.situacao })
    .from(oferta)
    .innerJoin(fornecedor, eq(fornecedor.id, oferta.fornecedorId))
    .leftJoin(cotacao, eq(cotacao.id, oferta.cotacaoId))
    .where(and(eq(oferta.itemPedidoId, itemPedidoId), eq(oferta.rodada, l.item.rodada)));
  const validasParaComparar = linhas.filter((x) => x.situacao !== "desistiu" && x.situacao !== "parou" && !x.fornecedor.parouEm);

  const ids = [...new Set(validasParaComparar.map((x) => x.fornecedor.id))];
  const conhecidos = new Set(
    ids.length
      ? (await db.select({ id: historicoCompra.fornecedorId }).from(historicoCompra).where(inArray(historicoCompra.fornecedorId, ids))).map((r) => r.id)
      : [],
  );

  // Q8: confere os fornecedores reais antes de comparar.
  const verificacoes = await verificarVarios(validasParaComparar.filter((x) => x.fornecedor.origem === "real").map((x) => x.fornecedor.id));

  const ofertas: OfertaComparavel[] = validasParaComparar.map(({ oferta: o, fornecedor: f }) => ({
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
  }));

  const [respostas] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cotacao)
    .where(and(eq(cotacao.itemPedidoId, itemPedidoId), eq(cotacao.rodada, l.item.rodada)));
  return { ...l, ofertas, verificacoes, consultados: respostas?.n ?? 0 };
}

const nomeComSelo = (o: OfertaComparavel) => `${o.fornecedorNome}${o.simulado ? " (simulado)" : ""}`;

function linhaMapa(l: Linha, i: number, verificacoes: Map<string, Verificacao>): string {
  const o = l.oferta;
  const frete = l.origemFrete === "nao_se_aplica" ? "retirada" : `frete ${formatarBRL(l.frete)} (${l.origemFrete})`;
  const partes = [
    `${i + 1}. ${nomeComSelo(o)}`,
    `   Total ${formatarBRL(l.custo!)}: produto ${formatarBRL(l.produto!)} + ${frete}${l.impostos ? ` + impostos ${formatarBRL(l.impostos)}` : ""}`,
    `   Entrega em ${dias(o.prazoDias!)} · ${o.pagamento ?? "pagamento não informado"} · nota ${formatarNota(l.nota!)}`,
  ];
  const v = verificacoes.get(o.fornecedorId);
  if (v && !o.simulado) partes.push(`   ${v.resumo}`);
  if (!o.itemExato) partes.push(`   Equivalente: ${o.itemOferecido}`);
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
    urgencia: { normal: "sem urgência", urgente: "pedido urgente", obra_parada: "obra parada, prazo pesa o dobro" }[urgencia] ?? urgencia,
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
        "Você explica ao comprador de obra por que a primeira proposta da lista válida ficou na frente. " +
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
  b.push({ rotulo: "Cotar de novo", dado: `item:${itemPedidoId}:reprovar` });
  b.push({ rotulo: "Buscar mais fornecedores", dado: `item:${itemPedidoId}:buscar` });
  return b;
}

async function montarMapa(m: MudancaItem) {
  const d = await carregar(m.itemPedidoId);
  if (!d) return;
  const { item, pedido: p } = d;
  const refs = await referenciasDoItem(item.id);
  const c = comparar(
    {
      quantidade: Number(item.quantidade),
      aceitaSimilar: item.aceitaSimilar,
      prazoMaxDias: p.prazoMaxDias,
      modoEntrega: p.modoEntrega,
      urgencia: p.urgencia,
    },
    d.ofertas,
    refs.mediana,
  );
  const blocoReferencia = textoReferencias(refs, item.unidade);
  const cabecalho = `Pedido ${p.id} · ${quantidade(item.quantidade, item.unidade)} de ${item.descricao}`;

  if (!c.vencedora) {
    const cortes = c.cortadas.map((l) => `- ${nomeComSelo(l.oferta)}: ${l.motivos.join("; ")}`);
    await avancarItem(m.itemPedidoId, "sem_propostas_validas", {
      agente: "Comparador",
      acao: "Nenhuma proposta passou nas regras.",
      motivo: d.ofertas.length ? `Cortadas: ${c.cortadas.map((l) => `${l.oferta.fornecedorNome} (${l.motivos.join(", ")})`).join("; ")}.` : "Nenhum fornecedor mandou proposta.",
      dados: { comparacao: c },
    }).catch(ignorarCorrida);
    const texto = [cabecalho, "", d.ofertas.length ? "Nenhuma proposta passou nas regras:" : `Nenhum dos ${d.consultados} fornecedores consultados mandou proposta.`, ...cortes, ...blocoReferencia].join("\n");
    await enviar(p.compradorId, texto, { pedidoId: p.id, itemPedidoId: item.id, tipo: "aviso" });
    return;
  }

  let justificativaMenosDeTres: string | null = null;
  if (c.validas.length < MINIMO_PROPOSTAS_VALIDAS) {
    justificativaMenosDeTres =
      p.urgencia !== "normal"
        ? `Apenas ${c.validas.length} ${c.validas.length === 1 ? "proposta válida" : "propostas válidas"}: pedido urgente, esperar mais custaria mais que o ganho da comparação.`
        : `Apenas ${c.validas.length} ${c.validas.length === 1 ? "proposta válida" : "propostas válidas"}: poucos fornecedores responderam a tempo.`;
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
        acao: `Montou o mapa com ${c.validas.length} ${c.validas.length === 1 ? "proposta válida" : "propostas válidas"} e recomendou ${c.vencedora.oferta.fornecedorNome}.`,
        motivo: recomendacao,
        fornecedorIds: c.validas.map((l) => l.oferta.fornecedorId),
        dados: { pesos: c.pesos, referenciaUnitaria: c.referenciaUnitaria },
      },
      { justificativaMenosDeTres },
    );
  } catch (erro) {
    ignorarCorrida(erro);
    return;
  }

  const texto = [
    cabecalho,
    `Mapa de cotação${item.rodada > 1 ? `, rodada ${item.rodada}` : ""}: ${c.validas.length} ${c.validas.length === 1 ? "proposta válida" : "propostas válidas"} de ${d.ofertas.length} recebidas (${d.consultados} consultados).`,
    "",
    ...c.validas.map((l, i) => linhaMapa(l, i, d.verificacoes)),
  ];
  if (c.cortadas.length) {
    texto.push("", "Fora da comparação:");
    for (const l of c.cortadas) texto.push(`- ${nomeComSelo(l.oferta)}: ${l.motivos.join("; ")}`);
  }
  texto.push(...blocoReferencia);
  texto.push("", `${c.podeDizerMelhor ? "Recomendo" : "Na frente"}: ${c.vencedora.oferta.fornecedorNome}. ${recomendacao}`);
  if (justificativaMenosDeTres) texto.push("", justificativaMenosDeTres);
  if (p.urgencia !== "normal") texto.push("", "O prazo pesa o dobro porque o pedido é urgente.");
  texto.push("", "A decisão é sua: nada é comprado sem a sua aprovação.");

  await enviar(p.compradorId, texto.join("\n"), { pedidoId: p.id, itemPedidoId: item.id, botoes: botoesDecisao(item.id, c), tipo: "aviso" });
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
