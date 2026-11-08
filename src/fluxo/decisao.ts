// R11: decisão e confirmação. O comprador aprova (em dois toques, para não
// aprovar sem querer), o pedido de compra vai ao vencedor, os demais são
// avisados e a confirmação do fornecedor fecha o item. A IA não fecha compra.

import { acharRecompra } from "../agentes/memoria/index.ts";
import { MAX_RODADAS, planejarNegociacao } from "../agentes/negociador/index.ts";
import { dias, MOTIVOS_CANCELAMENTO, quantidade, type MotivoCancelamento } from "../texto.ts";
import { and, eq, ne } from "drizzle-orm";
import { formatarBRL, ultimoMapa, type Linha } from "../agentes/comparador/index.ts";
import { contatoAtivo } from "../agentes/cotador/index.ts";
import { EMPRESA } from "../config.ts";
import { db } from "../nucleo/db/cliente.ts";
import { cotacao, fornecedor, historicoCompra, itemPedido, oferta, pedido } from "../nucleo/db/schema.ts";
import { enviar, type Botao, type Contato } from "../nucleo/mensagens/index.ts";
import {
  aoEntrarItem,
  avancarItem,
  TransicaoConcorrente,
  TransicaoInvalida,
  type MudancaItem,
} from "../nucleo/orquestrador/index.ts";

export const TEXTO_NAO_VENCEU = "O comprador escolheu outra proposta desta vez. Obrigado pela cotação!";


async function dados(itemPedidoId: number) {
  const [l] = await db
    .select({ item: itemPedido, pedido })
    .from(itemPedido)
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .where(eq(itemPedido.id, itemPedidoId));
  return l ?? null;
}

function ignorarCorrida(erro: unknown) {
  if (erro instanceof TransicaoInvalida || erro instanceof TransicaoConcorrente) return true;
  throw erro;
}

const nomeComSelo = (l: Linha) => `${l.oferta.fornecedorNome}${l.oferta.simulado ? " (simulado)" : ""}`;

// ---------- Botões do comprador: item:<id>:<acao>[:<ofertaId>] ----------

export async function aoBotaoDoComprador(contato: Contato, dado: string): Promise<boolean> {
  const m = /^item:(\d+):(aprovar|confirmar|outras|reprovar|buscar|voltar|motivos|negociar|excluir|cancelar|repetir|repetir_ok|cotar_novo)(?::([0-9a-f-]{36}|[a-z_]+))?$/.exec(dado);
  if (!m) return false;
  const itemPedidoId = Number(m[1]);
  const acao = m[2]!;
  const ofertaId = m[3];
  const d = await dados(itemPedidoId);
  if (!d || d.pedido.compradorId !== contato.id) return true;
  const ctx = { pedidoId: d.pedido.id, itemPedidoId };
  // X2: repetir ou cotar de novo só valem quando o item espera essa escolha.
  if (acao === "repetir" || acao === "repetir_ok" || acao === "cotar_novo") {
    if (d.item.estado !== "aguardando_recompra") {
      await enviar(contato.id, `Pedido ${d.pedido.id}: este item não está esperando essa escolha agora.`, ctx);
      return true;
    }
    if (acao === "cotar_novo") {
      await avancarItem(itemPedidoId, "cotar_de_novo", { agente: "Comprador", acao: "Preferiu cotar de novo.", motivo: "Decisão do comprador." }).catch(ignorarCorrida);
      return true;
    }
    const r = await acharRecompra(d.item);
    // Dois toques também na recompra: o primeiro pede confirmação.
    if (r && acao === "repetir") {
      await enviar(
        contato.id,
        `Confirma repetir a compra de ${quantidade(d.item.quantidade, d.item.unidade)} de ${d.item.descricao} com ${r.fornecedorNome}${r.simulado ? " (simulado)" : ""}, a ${formatarBRL(r.precoUnitario)} por ${d.item.unidade}? O fornecedor confirma se mantém o preço.`,
        { ...ctx, botoes: [{ rotulo: "Sim, repetir", dado: `item:${itemPedidoId}:repetir_ok`, estilo: "sucesso" }, { rotulo: "Cotar de novo", dado: `item:${itemPedidoId}:cotar_novo` }] },
      );
      return true;
    }
    if (!r) {
      await enviar(contato.id, `Pedido ${d.pedido.id}: o fornecedor da última compra não está mais disponível. Vou cotar de novo.`, ctx);
      await avancarItem(itemPedidoId, "cotar_de_novo", { agente: "Acompanhamento do pedido", motivo: "Fornecedor da recompra indisponível." }).catch(ignorarCorrida);
      return true;
    }
    const [o] = await db
      .insert(oferta)
      .values({
        itemPedidoId,
        fornecedorId: r.fornecedorId,
        rodada: d.item.rodada,
        itemOferecido: d.item.descricao,
        itemExato: true,
        precoUnitario: r.precoUnitario.toFixed(2),
        totalProduto: (r.precoUnitario * Number(d.item.quantidade)).toFixed(2),
        frete: r.frete?.toFixed(2) ?? null,
        origemFrete: r.frete !== null ? "informado" : null,
        prazoDias: r.prazoPrometidoDias,
        formato: "historico",
        extraido: { recompraDe: r.historicoId },
      })
      .returning();
    await avancarItem(
      itemPedidoId,
      "repetir_compra",
      { agente: "Comprador", acao: `Repetiu a compra com ${r.fornecedorNome}.`, motivo: "Compra repetida em menos de 3 meses, pelo preço da última.", fornecedorIds: [r.fornecedorId] },
      { fornecedorEscolhidoId: r.fornecedorId, ofertaEscolhidaId: o!.id },
    ).catch(ignorarCorrida);
    return true;
  }

  const aguardando = d.item.estado === "aguardando_decisao";

  if (!aguardando && acao !== "voltar") {
    await enviar(contato.id, `Pedido ${d.pedido.id}: este item não está esperando sua decisão agora.`, ctx);
    return true;
  }
  const mapa = await ultimoMapa(itemPedidoId);
  const linha = (id?: string) => mapa?.comparacao.validas.find((l) => l.oferta.id === id);

  switch (acao) {
    case "aprovar": {
      const l = linha(ofertaId);
      if (!l) break;
      const botoes: Botao[] = [
        { rotulo: "Sim, aprovar", dado: `item:${itemPedidoId}:confirmar:${l.oferta.id}`, estilo: "sucesso" },
        { rotulo: "Voltar", dado: `item:${itemPedidoId}:voltar` },
      ];
      await enviar(
        contato.id,
        `Confirma a compra de ${quantidade(d.item.quantidade, d.item.unidade)} de ${d.item.descricao} com ${nomeComSelo(l)} por ${formatarBRL(l.custo!)}, entrega em ${dias(l.oferta.prazoDias!)}?`,
        { ...ctx, botoes },
      );
      break;
    }
    case "confirmar": {
      const l = linha(ofertaId);
      if (!l) break;
      await avancarItem(
        itemPedidoId,
        "aprovar",
        { agente: "Comprador", acao: `Aprovou ${l.oferta.fornecedorNome} por ${formatarBRL(l.custo!)}.`, motivo: "Decisão do comprador.", fornecedorIds: [l.oferta.fornecedorId] },
        { fornecedorEscolhidoId: l.oferta.fornecedorId, ofertaEscolhidaId: l.oferta.id },
      ).catch(ignorarCorrida);
      break;
    }
    case "outras": {
      const botoes: Botao[] = (mapa?.comparacao.validas ?? []).map((l) => ({
        rotulo: `${l.oferta.fornecedorNome} · ${formatarBRL(l.custo!)}`,
        dado: `item:${itemPedidoId}:aprovar:${l.oferta.id}`,
      }));
      await enviar(contato.id, "Qual proposta você quer aprovar?", { ...ctx, botoes });
      break;
    }
    // N6: reprovar abre os motivos; cada motivo leva o pedido a um ponto diferente.
    case "motivos": {
      const v = mapa?.comparacao.vencedora;
      const botoes: Botao[] = [];
      if (d.item.rodada < MAX_RODADAS) botoes.push({ rotulo: "Preço alto: negociar", dado: `item:${itemPedidoId}:negociar` });
      botoes.push({ rotulo: "Prazo longo: buscar mais fornecedores", dado: `item:${itemPedidoId}:buscar` });
      if (v) botoes.push({ rotulo: `Não confio em ${v.oferta.fornecedorNome}`, dado: `item:${itemPedidoId}:excluir:${v.oferta.fornecedorId}` });
      botoes.push({ rotulo: "Cotar de novo com todos", dado: `item:${itemPedidoId}:reprovar` });
      botoes.push({ rotulo: "Desistir deste item", dado: `item:${itemPedidoId}:cancelar`, estilo: "perigo" });
      await enviar(contato.id, "Por que reprovar? Cada motivo leva a um caminho diferente.", { ...ctx, botoes });
      break;
    }
    case "negociar": {
      const plano = await planejarNegociacao(itemPedidoId, d.item.rodada);
      if (!("alvos" in plano)) {
        await enviar(contato.id, `Pedido ${d.pedido.id}: não dá para negociar agora. ${plano.motivo}`, ctx);
        break;
      }
      await avancarItem(
        itemPedidoId,
        "negociar",
        { agente: "Comprador", acao: "Reprovou por preço alto e pediu negociação.", motivo: "Motivo: preço alto.", fornecedorIds: plano.alvos },
        { rodada: plano.rodada, ampliacoes: 0, negociacao: plano, prazoRespostasEm: null, lembreteEm: null },
      ).catch(ignorarCorrida);
      break;
    }
    case "excluir": {
      if (!ofertaId || !/^[0-9a-f-]{36}$/.test(ofertaId)) break;
      const [f] = await db.select({ nome: fornecedor.nome }).from(fornecedor).where(eq(fornecedor.id, ofertaId));
      await avancarItem(
        itemPedidoId,
        "reavaliar",
        { agente: "Comprador", acao: `Tirou ${f?.nome ?? "um fornecedor"} do mapa.`, motivo: "Motivo: não confia no fornecedor.", fornecedorIds: [ofertaId] },
        { excluidos: [...new Set([...d.item.excluidos, ofertaId])] },
      ).catch(ignorarCorrida);
      break;
    }
    case "cancelar": {
      // Todo cancelamento tem justificativa: sem motivo, pergunta antes.
      const motivo = ofertaId && ofertaId in MOTIVOS_CANCELAMENTO ? (ofertaId as MotivoCancelamento) : null;
      if (!motivo) {
        await enviar(contato.id, `Por que desistir de ${d.item.descricao}?`, {
          ...ctx,
          botoes: (Object.keys(MOTIVOS_CANCELAMENTO) as MotivoCancelamento[]).map((k) => ({ rotulo: MOTIVOS_CANCELAMENTO[k], dado: `item:${itemPedidoId}:cancelar:${k}` })),
        });
        break;
      }
      await avancarItem(itemPedidoId, "cancelar", { agente: "Comprador", acao: "Desistiu deste item.", motivo: `Motivo: ${MOTIVOS_CANCELAMENTO[motivo]}.` }).catch(ignorarCorrida);
      await enviar(contato.id, `Pedido ${d.pedido.id}: ${d.item.descricao} cancelado (${MOTIVOS_CANCELAMENTO[motivo].toLowerCase()}). Nada foi comprado.`, ctx);
      break;
    }
    case "reprovar":
      await avancarItem(
        itemPedidoId,
        "reprovar",
        { agente: "Comprador", acao: "Reprovou e pediu nova rodada com todos.", motivo: "Motivo: quer nova rodada de cotação." },
        { prazoRespostasEm: null, lembreteEm: null },
      ).catch(ignorarCorrida);
      break;
    case "buscar":
      await avancarItem(
        itemPedidoId,
        "voltar_busca",
        { agente: "Comprador", acao: "Reprovou e pediu mais fornecedores.", motivo: "Motivo: prazo longo ou poucas opções." },
        { prazoRespostasEm: null, lembreteEm: null },
      ).catch(ignorarCorrida);
      break;
    case "voltar":
      await enviar(contato.id, "Certo, nada foi aprovado. Os botões do mapa continuam valendo.", ctx);
      break;
  }
  return true;
}

// ---------- Aprovado: pedido de compra ao vencedor e aviso aos demais ----------

async function enviarPedidoDeCompra(m: MudancaItem) {
  const d = await dados(m.itemPedidoId);
  if (!d?.item.fornecedorEscolhidoId || !d.item.ofertaEscolhidaId) return;
  const [o] = await db.select().from(oferta).where(eq(oferta.id, d.item.ofertaEscolhidaId));
  const [f] = await db.select().from(fornecedor).where(eq(fornecedor.id, d.item.fornecedorEscolhidoId));
  const ct = await contatoAtivo(d.item.fornecedorEscolhidoId);
  const mapa = await ultimoMapa(m.itemPedidoId);
  const l = mapa?.comparacao.validas.find((x) => x.oferta.id === d.item.ofertaEscolhidaId);
  if (!o || !f) return;

  // Loja online: não há conversa com a loja. O comprador finaliza no site; a confirmação é simulada.
  if (o.formato === "busca") return comprarNaLojaOnline(d, o, f, l?.custo ?? null);

  if (!ct) {
    await enviar(d.pedido.compradorId, `Pedido ${d.pedido.id}: ${f.nome} não tem mais canal ativo. Escolha outra proposta.`, { pedidoId: d.pedido.id, itemPedidoId: d.item.id });
    await avancarItem(m.itemPedidoId, "pedido_enviado", { agente: "Acompanhamento do pedido", motivo: "Sem canal do vencedor." }).catch(ignorarCorrida);
    await avancarItem(m.itemPedidoId, "fornecedor_desistiu", { agente: "Acompanhamento do pedido", motivo: "O vencedor não tem canal ativo." }).catch(ignorarCorrida);
    return;
  }

  const texto = [
    `Pedido de compra da ${EMPRESA.nome} (CNPJ ${EMPRESA.cnpj}), referente à cotação ${d.item.id}:`,
    `${quantidade(d.item.quantidade, d.item.unidade)} de ${o.itemOferecido}`,
    l ? `Total ${formatarBRL(l.custo!)}, como na sua proposta.` : "",
    o.formato === "historico" && o.precoUnitario ? `Mesmo preço da última compra: ${formatarBRL(Number(o.precoUnitario))} por ${d.item.unidade}${o.frete ? `, frete ${formatarBRL(Number(o.frete))}` : ""}.` : "",
    d.pedido.modoEntrega === "retirada" ? "Retirada na loja." : `Entrega: ${d.pedido.destino ?? "a combinar"}${d.pedido.janelaRecebimento ? ` (${d.pedido.janelaRecebimento})` : ""}.`,
    o.prazoDias !== null ? `Prazo: ${dias(o.prazoDias)}.` : "",
    `Pagamento: ${pagamentoCombinado(o)}.`,
    d.pedido.entregas ? `Entregas: ${d.pedido.entregas}.` : "",
    "Pode confirmar o fornecimento?",
  ]
    .filter(Boolean)
    .join("\n");
  await enviar(ct.id, texto, {
    itemPedidoId: d.item.id,
    tipo: "pedido_compra",
    botoes: [
      { rotulo: "Confirmo", dado: `compra:${d.item.id}:confirmo`, estilo: "sucesso" },
      { rotulo: "Não consigo atender", dado: `compra:${d.item.id}:desisto`, estilo: "perigo" },
    ],
  });

  const outros = await avisarQuemNaoVenceu(d.item.id, d.item.rodada, f.id);

  await avancarItem(m.itemPedidoId, "pedido_enviado", {
    agente: "Acompanhamento do pedido",
    acao: `Mandou o pedido de compra a ${f.nome} e avisou ${outros.length} ${outros.length === 1 ? "fornecedor" : "fornecedores"} que não venceram.`,
    motivo: "O comprador aprovou.",
    fornecedorIds: [f.id],
  }).catch(ignorarCorrida);
  await enviar(d.pedido.compradorId, `Pedido ${d.pedido.id}: mandei o pedido de compra a ${f.nome}${f.origem === "simulado" ? " (simulado)" : ""}. Aviso quando confirmar.`, {
    pedidoId: d.pedido.id,
    itemPedidoId: d.item.id,
    tipo: "aviso",
  });
}

/** Forma de pagamento combinada, como a proposta disse (U1.1); sem dado, pede para combinar. */
export function pagamentoCombinado(o: { pagamento: string | null; prazoPagamentoDias: number | null }): string {
  const forma = o.pagamento?.trim().replace(/\.$/, "");
  const prazo = o.prazoPagamentoDias ? `${dias(o.prazoPagamentoDias)} para pagar` : "";
  if (forma && prazo && !forma.includes(String(o.prazoPagamentoDias))) return `${forma} (${prazo})`;
  return forma || prazo || "a combinar com o comprador";
}

/** Avisa os demais que responderam nesta rodada. */
async function avisarQuemNaoVenceu(itemPedidoId: number, rodada: number, vencedorId: string) {
  const outros = await db
    .select({ contatoId: cotacao.contatoId })
    .from(cotacao)
    .where(and(eq(cotacao.itemPedidoId, itemPedidoId), eq(cotacao.rodada, rodada), eq(cotacao.situacao, "respondeu"), ne(cotacao.fornecedorId, vencedorId)));
  for (const c of outros) if (c.contatoId) await enviar(c.contatoId, TEXTO_NAO_VENCEU, { itemPedidoId, tipo: "nao_venceu" });
  return outros;
}

async function comprarNaLojaOnline(
  d: NonNullable<Awaited<ReturnType<typeof dados>>>,
  o: typeof oferta.$inferSelect,
  f: typeof fornecedor.$inferSelect,
  custo: number | null,
) {
  const ctx = { pedidoId: d.pedido.id, itemPedidoId: d.item.id };
  await avisarQuemNaoVenceu(d.item.id, d.item.rodada, f.id);
  await avancarItem(d.item.id, "pedido_enviado", { agente: "Acompanhamento do pedido", acao: `Compra em loja online: ${f.nome}.`, motivo: "O comprador aprovou uma proposta de loja online.", fornecedorIds: [f.id] }).catch(ignorarCorrida);
  await avancarItem(d.item.id, "fornecedor_confirmou", { agente: "Fornecedor", acao: `${f.nome} (loja online) confirmou, simulado.`, motivo: "Loja online: a confirmação é simulada; o comprador finaliza no site.", fornecedorIds: [f.id] }).catch(ignorarCorrida);
  await db.insert(historicoCompra).values({
    fornecedorId: f.id,
    itemChave: d.item.itemChave ?? d.item.descricao,
    descricao: d.item.descricao,
    precoUnitario: o.precoUnitario ?? String(Number(o.totalProduto ?? 0) / Number(d.item.quantidade)),
    quantidade: d.item.quantidade,
    frete: o.frete,
    data: new Date(),
    prazoPrometidoDias: o.prazoDias,
    simulado: true,
    itemPedidoId: d.item.id,
  });
  const texto = [
    `Pedido ${d.pedido.id}: compra aprovada em ${f.nome} (loja online)${custo !== null ? `, total ${formatarBRL(custo)}` : ""}.`,
    o.fonte ? `Finalize no site, com o endereço de entrega ${d.pedido.destino ?? "do local de entrega"}: ${o.fonte}` : "Finalize no site da loja.",
    `Simulei a confirmação da loja: ${quantidade(d.item.quantidade, d.item.unidade)} de ${d.item.descricao}${o.prazoDias !== null ? `, entrega em ${dias(o.prazoDias)}` : ""}, ${o.pagamento ?? "pagamento à vista"}. Confira o prazo e o frete no carrinho antes de pagar.`,
  ].join("\n");
  await enviar(d.pedido.compradorId, texto, { ...ctx, tipo: "aviso" });
}

// ---------- Resposta do vencedor: compra:<itemId>:confirmo|desisto ----------

export async function aoRespostaDoVencedor(contato: Contato, itemPedidoId: number, confirmou: boolean): Promise<boolean> {
  const d = await dados(itemPedidoId);
  if (!d || !contato.fornecedorId || d.item.fornecedorEscolhidoId !== contato.fornecedorId) return false;
  if (d.item.estado !== "pedido_enviado") {
    await enviar(contato.id, "Este pedido já foi resolvido. Obrigado!", { itemPedidoId });
    return true;
  }
  const [f] = await db.select().from(fornecedor).where(eq(fornecedor.id, contato.fornecedorId));
  const nome = `${f?.nome ?? "O fornecedor"}${f?.origem === "simulado" ? " (simulado)" : ""}`;
  const ctx = { pedidoId: d.pedido.id, itemPedidoId };

  if (confirmou) {
    try {
      await avancarItem(itemPedidoId, "fornecedor_confirmou", { agente: "Fornecedor", motivo: "Confirmou o fornecimento.", fornecedorIds: [contato.fornecedorId] });
    } catch (erro) {
      ignorarCorrida(erro);
      return true;
    }
    const [o] = d.item.ofertaEscolhidaId ? await db.select().from(oferta).where(eq(oferta.id, d.item.ofertaEscolhidaId)) : [];
    if (o) {
      await db.insert(historicoCompra).values({
        fornecedorId: contato.fornecedorId,
        itemChave: d.item.itemChave ?? d.item.descricao,
        descricao: d.item.descricao,
        precoUnitario: o.precoUnitario ?? String(Number(o.totalProduto ?? 0) / Number(d.item.quantidade)),
        quantidade: d.item.quantidade,
        frete: o.frete,
        data: new Date(),
        prazoPrometidoDias: o.prazoDias,
        simulado: f?.origem === "simulado",
        itemPedidoId,
      });
    }
    await enviar(contato.id, "Obrigado! Pedido confirmado.", ctx);
    await enviar(d.pedido.compradorId, `Pedido ${d.pedido.id}: ${nome} confirmou o fornecimento de ${quantidade(d.item.quantidade, d.item.unidade)} de ${d.item.descricao}.`, { ...ctx, tipo: "aviso" });
  } else {
    await db
      .update(cotacao)
      .set({ situacao: "desistiu" })
      .where(and(eq(cotacao.itemPedidoId, itemPedidoId), eq(cotacao.fornecedorId, contato.fornecedorId), eq(cotacao.rodada, d.item.rodada)));
    await enviar(contato.id, "Entendido, obrigado por avisar.", ctx);
    const [escolhida] = d.item.ofertaEscolhidaId ? await db.select({ formato: oferta.formato }).from(oferta).where(eq(oferta.id, d.item.ofertaEscolhidaId)) : [];
    if (escolhida?.formato === "historico") {
      // Recompra recusada: não há mapa a refazer, então volta à busca e cota de novo.
      await enviar(d.pedido.compradorId, `Pedido ${d.pedido.id}: ${nome} não mantém o preço da última compra. Vou cotar de novo.`, { ...ctx, tipo: "aviso" });
      await avancarItem(itemPedidoId, "recompra_recusada", { agente: "Fornecedor", motivo: "Não mantém o preço da última compra.", fornecedorIds: [contato.fornecedorId] }, { fornecedorEscolhidoId: null, ofertaEscolhidaId: null }).catch(ignorarCorrida);
    } else {
      await enviar(d.pedido.compradorId, `Pedido ${d.pedido.id}: ${nome} não consegue atender. Refaço o mapa sem ele.`, { ...ctx, tipo: "aviso" });
      await avancarItem(itemPedidoId, "fornecedor_desistiu", { agente: "Fornecedor", motivo: "Não consegue atender o pedido.", fornecedorIds: [contato.fornecedorId] }).catch(ignorarCorrida);
    }
  }
  return true;
}

/** Fornecedor que escreve "confirmo" em vez de tocar no botão. */
export async function pedidoEnviadoPara(fornecedorId: string) {
  const [i] = await db
    .select({ id: itemPedido.id })
    .from(itemPedido)
    .where(and(eq(itemPedido.fornecedorEscolhidoId, fornecedorId), eq(itemPedido.estado, "pedido_enviado")))
    .limit(1);
  return i?.id ?? null;
}

export function ligarDecisao() {
  aoEntrarItem("aprovado", enviarPedidoDeCompra);
}
