// R8 e R9: Agente Comparador. Monta o mapa de cotação (Q1) com o cálculo em
// código, pede à IA só a justificativa em texto (com checagem de números) e
// manda ao comprador com os botões de decisão. A IA nunca aprova nada.

import { registrar } from "../../nucleo/registro.ts";
import { dias, quantidade } from "../../texto.ts";
import { referenciasDoItem } from "../busca/internet.ts";
import { verificarVarios, type Verificacao } from "../verificacao/index.ts";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../nucleo/db/cliente.ts";
import { cotacao, fornecedor, historicoCompra, itemPedido, mapaCotacao, oferta, pedido } from "../../nucleo/db/schema.ts";
import { gerarTexto } from "../../nucleo/ia/index.ts";
import { contatoAtivoDoFornecedor, enviar, type Botao } from "../../nucleo/mensagens/index.ts";
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
  const produtoDe = (o: typeof oferta.$inferSelect) => (o.totalProduto !== null ? Number(o.totalProduto) : o.precoUnitario !== null ? Number(o.precoUnitario) * qtd : null);
  /** Proposta anterior (rodada menor) do mesmo fornecedor, para mostrar quanto a negociação baixou. */
  const anterior = (fornecedorId: string, rodada: number) => todas.find((x) => x.fornecedor.id === fornecedorId && x.oferta.rodada < rodada)?.oferta ?? null;

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
    rodada: o.rodada,
    produtoAnterior: (() => {
      const a = anterior(f.id, o.rodada);
      return a ? produtoDe(a) : null;
    })(),
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

const nomeComSelo = (o: OfertaComparavel) => `${o.fornecedorNome}${o.simulado ? " (simulado)" : o.online ? " (loja online)" : ""}`;

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
  if (o.produtoAnterior && l.produto !== null && o.produtoAnterior - l.produto >= 0.01) {
    partes.push(`   Negociado: o produto baixou de ${formatarBRL(o.produtoAnterior)} para ${formatarBRL(l.produto)}`);
  }
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
  b.push({ rotulo: "Reprovar", dado: `item:${itemPedidoId}:motivos` });
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
  // Lojas que já viraram proposta não se repetem na referência.
  const naProposta = new Set(d.ofertas.filter((o) => o.online).map((o) => o.fornecedorId));
  const blocoReferencia = textoReferencias({ ...refs, aceitas: refs.aceitas.filter((r) => !r.fornecedorId || !naProposta.has(r.fornecedorId)) }, item.unidade);
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

  const lojasOnline = d.ofertas.filter((o) => o.online).length;
  const motivoNovoMapa =
    m.evento === "reavaliar"
      ? "Mapa refeito."
      : m.de === "cotando" && item.negociacao && item.negociacao.rodada === item.rodada
        ? "Mapa depois da negociação."
        : null;
  const texto = [
    motivoNovoMapa ? `${cabecalho}\n${motivoNovoMapa}` : cabecalho,
    `Mapa de cotação${item.rodada > 1 ? `, rodada ${item.rodada}` : ""}: ${c.validas.length} ${c.validas.length === 1 ? "proposta válida" : "propostas válidas"} de ${d.ofertas.length} recebidas (${d.consultados} ${d.consultados === 1 ? "fornecedor consultado" : "fornecedores consultados"}${lojasOnline ? ` e ${lojasOnline} ${lojasOnline === 1 ? "loja online" : "lojas online"}` : ""}).`,
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

  await enviar(p.compradorId, texto.join("\n"), { pedidoId: p.id, itemPedidoId: item.id, botoes: botoesDecisao(item.id, c), tipo: "aviso" });
  // Só depois do mapa pronto: a resposta do fornecedor encontra o item esperando a decisão.
  await pedirConfirmacaoDePreco(d, c);
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
