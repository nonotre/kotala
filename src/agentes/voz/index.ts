// X5: ligação por voz em tempo real (Gemini Live). O agente liga para o
// fornecedor que não respondeu ao texto, pergunta as condições e chama a
// ferramenta registrar_cotacao; a conversa vira proposta no mapa, na mesma forma
// que o Extrator grava (Q1, Q2, alertas, negociação). A IA nunca fecha compra
// nem cita valor de outro fornecedor.
// A parte pura fica em conversa.ts e sessao.ts; aqui, o banco. O áudio fica nas telas (web/).

import { and, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "../../nucleo/db/cliente.ts";
import { contato, cotacao, evento, fornecedor, itemPedido, oferta, pedido, usuario } from "../../nucleo/db/schema.ts";
import { registrar } from "../../nucleo/registro.ts";
import { enviar } from "../../nucleo/mensagens/index.ts";
import { categoriaProvavel } from "../../dominio/categorias.ts";
import type { AlertaFornecedor, Extracao } from "../extrator/index.ts";
import {
  citarReferencia,
  compraramAntes,
  condicaoDoDesconto,
  deveNegociar,
  escolherAlavancas,
  jaPediuDesconto,
  marcaDe,
  montarNegociacao,
  produtoDe,
  reservarPedidoDeDesconto,
  resultadoNegociacao,
  unitarioDe,
  type CondicaoProposta,
  type MarcaNegociacao,
} from "../negociador/index.ts";
import {
  confirmacaoFalada,
  conferirFalaDoAgente,
  descontoParaFalar,
  faltasDaProposta,
  lerArgs,
  mesmosArgs,
  respostaAoRegistrar,
  type ArgsRegistrar,
  type DadosLigacao,
} from "./conversa.ts";
import { cortarTranscricao, falasDe, type MotivoFim } from "./sessao.ts";

export { conferirPedidoDaLigacao, FERRAMENTA_REGISTRAR, instrucoesDaLigacao, type ArgsRegistrar, type DadosLigacao } from "./conversa.ts";

export const MODELO_VOZ = () => process.env.VOZ_MODELO ?? "gemini-3.8-live";

type Linha = { cotacao: typeof cotacao.$inferSelect; fornecedor: typeof fornecedor.$inferSelect; item: typeof itemPedido.$inferSelect; pedido: typeof pedido.$inferSelect };

async function linhaDaCotacao(cotacaoId: string): Promise<Linha | null> {
  const [l] = await db
    .select({ cotacao, fornecedor, item: itemPedido, pedido })
    .from(cotacao)
    .innerJoin(fornecedor, eq(fornecedor.id, cotacao.fornecedorId))
    .innerJoin(itemPedido, eq(itemPedido.id, cotacao.itemPedidoId))
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .where(eq(cotacao.id, cotacaoId));
  return l ?? null;
}

/** A ligação só vale com o item cotando e a cotação aberta na rodada atual. */
export const ligacaoAberta = (l: { cotacao: { rodada: number; situacao: string }; item: { estado: string; rodada: number } }) =>
  l.item.estado === "cotando" && l.cotacao.rodada === l.item.rodada && ["aguardando", "respondeu"].includes(l.cotacao.situacao);

/**
 * Nome de quem compra: o mesmo de nomeDoComprador (src/fluxo/decisao.ts), sem importar o fluxo
 * nas telas. Só o nome da conta; nunca telefone, e-mail ou o nome do Telegram.
 */
async function nomeDoComprador(p: { responsavelId: string | null; compradorId: string }): Promise<string | null> {
  const id = p.responsavelId ?? (await db.select({ usuarioId: contato.usuarioId }).from(contato).where(eq(contato.id, p.compradorId)))[0]?.usuarioId ?? null;
  if (!id) return null;
  const [u] = await db.select({ nome: usuario.nome }).from(usuario).where(eq(usuario.id, id));
  return u?.nome.trim() || null;
}

const numOuNull = (v: string | null) => (v === null ? null : Number(v));

export async function dadosDaLigacao(cotacaoId: string): Promise<DadosLigacao | null> {
  const l = await linhaDaCotacao(cotacaoId);
  if (!l) return null;
  // A proposta deste fornecedor (só a dele), da rodada atual ou da anterior.
  const [anterior] = await db
    .select({ precoUnitario: oferta.precoUnitario, totalProduto: oferta.totalProduto, rodada: oferta.rodada })
    .from(oferta)
    .where(and(eq(oferta.itemPedidoId, l.item.id), eq(oferta.fornecedorId, l.fornecedor.id), lte(oferta.rodada, l.cotacao.rodada)))
    .orderBy(desc(oferta.rodada))
    .limit(1);
  const marcas = await db
    .select({ extraido: oferta.extraido })
    .from(oferta)
    .where(and(eq(oferta.itemPedidoId, l.item.id), eq(oferta.fornecedorId, l.fornecedor.id), sql`${oferta.extraido}->'negociacao'->>'pedidaEm' is not null`));
  const ms = marcas.map((m) => marcaDe(m.extraido)).filter((m): m is MarcaNegociacao => !!m);
  return {
    cotacaoId,
    situacao: l.cotacao.situacao,
    rodada: l.cotacao.rodada,
    fornecedor: l.fornecedor.nome,
    simulado: l.fornecedor.origem === "simulado",
    item: {
      id: l.item.id,
      descricao: l.item.descricao,
      quantidade: l.item.quantidade,
      unidade: l.item.unidade,
      estado: l.item.estado,
      rodada: l.item.rodada,
      aceitaSimilar: l.item.aceitaSimilar,
      especificacao: l.item.especificacao,
      codigo: l.item.itemChave?.startsWith("ITM-") ? l.item.itemChave : null,
      categoria: l.item.categoria ?? categoriaProvavel(l.item.descricao),
    },
    pedido: {
      id: l.pedido.id,
      destino: l.pedido.destino,
      cep: l.pedido.cep,
      prazoTexto: l.pedido.prazoTexto,
      modoEntrega: l.pedido.modoEntrega,
      janelaRecebimento: l.pedido.janelaRecebimento,
      entregas: l.pedido.entregas,
      pagamentoPreferido: l.pedido.pagamentoPreferido?.trim() || null,
      comprador: await nomeDoComprador(l.pedido),
    },
    anterior: anterior ? { precoUnitario: numOuNull(anterior.precoUnitario), totalProduto: numOuNull(anterior.totalProduto), rodada: anterior.rodada } : null,
    desconto: ms.some((m) => m.respondidaEm) ? "respondido" : ms.length ? "aberto" : "nao_pedido",
  };
}

type Resultado = { ok: boolean; resposta: string };

/** A leitura nova com o preço e o item da proposta anterior (para o completarComAnterior preencher o resto). */
function comoAnterior(e: Extracao, a: typeof oferta.$inferSelect): Extracao {
  const ex = (a.extraido ?? {}) as Partial<Extracao>;
  return {
    ...e,
    precoUnitario: numOuNull(a.precoUnitario),
    totalProduto: numOuNull(a.totalProduto),
    itemOferecido: a.itemOferecido,
    itemExato: a.itemExato,
    aderencia: ex.aderencia ?? e.aderencia,
    divergencias: ex.divergencias ?? e.divergencias,
    leituraPreco: ex.leituraPreco ?? e.leituraPreco,
  };
}

/** Marca do registro por voz em `oferta.extraido.voz`: os argumentos e a resposta dada (idempotência). */
type MarcaVoz = { args: unknown; resposta: string; em: string };
const vozDe = (extraido: unknown): MarcaVoz | null => {
  const v = (extraido as { voz?: MarcaVoz } | null)?.voz;
  return v && typeof v.resposta === "string" ? v : null;
};

/**
 * Registra o que foi dito na ligação. Valores conferidos em código (lerArgs → limpar do
 * Extrator); a cotação precisa estar aberta na rodada atual. Chamada repetida com os mesmos
 * argumentos devolve a mesma resposta sem gravar de novo; chamada nova substitui a proposta
 * da rodada (nunca duplica) e leva junto a marca do desconto. Devolve o texto que o agente segue.
 */
export async function registrarCotacaoPorVoz(cotacaoId: string, args: ArgsRegistrar | unknown, transcricaoBruta: string): Promise<Resultado> {
  const l = await linhaDaCotacao(cotacaoId);
  if (!l) return { ok: false, resposta: "Cotação não encontrada. Agradeça e encerre." };
  if (!ligacaoAberta(l)) return { ok: false, resposta: "Esta cotação já foi encerrada. Agradeça a atenção e encerre." };
  const { cotacao: c, item, pedido: ped } = l;
  const ctx = { pedidoId: ped.id, itemPedidoId: item.id };
  const transcricao = cortarTranscricao(transcricaoBruta);
  const qtd = Number(item.quantidade);
  const retirada = ped.modoEntrega === "retirada";
  const f = await import("../../fluxo/fornecedor.ts");

  const [anterior] = await db.select().from(oferta).where(and(eq(oferta.cotacaoId, c.id), eq(oferta.rodada, c.rodada))).limit(1);
  const ultimaVoz = vozDe(anterior?.extraido);
  if (ultimaVoz && mesmosArgs(ultimaVoz.args, args)) return { ok: true, resposta: ultimaVoz.resposta };

  const lida = lerArgs(args, { quantidade: qtd });
  let e: Extracao = lida.e;
  const temPropostaAnterior = !!anterior && (anterior.precoUnitario !== null || anterior.totalProduto !== null);

  if (e.classificacao === "parar") {
    await db.update(cotacao).set({ situacao: "parou", respondeuEm: new Date() }).where(eq(cotacao.id, c.id));
    await db.update(fornecedor).set({ parouEm: new Date() }).where(eq(fornecedor.id, c.fornecedorId));
    await registrar(db, { agente: "Voz", acao: "O fornecedor pediu para não ser mais contatado.", motivo: "Dito na ligação por voz.", ...ctx, fornecedorIds: [c.fornecedorId], dados: { transcricao, args } });
    await encerrarSeNinguemDeve(item.id);
    return { ok: true, resposta: "Registrado. Peça desculpas pelo incômodo e encerre a ligação." };
  }
  if (e.classificacao === "recusa") {
    // Como no texto: quem já mandou preço e agora diz que não consegue não está recusando o pedido.
    if (temPropostaAnterior) {
      await registrar(db, { agente: "Voz", acao: "O fornecedor manteve a proposta anterior.", motivo: "Dito na ligação por voz.", ...ctx, fornecedorIds: [c.fornecedorId], dados: { transcricao, args } });
      return { ok: true, resposta: "Certo: a proposta que ele já mandou continua valendo. Agradeça e encerre." };
    }
    await db.update(cotacao).set({ situacao: "encerrada", respondeuEm: new Date() }).where(eq(cotacao.id, c.id));
    await registrar(db, { agente: "Voz", acao: "O fornecedor não atende este pedido.", motivo: "Dito na ligação por voz.", ...ctx, fornecedorIds: [c.fornecedorId], dados: { transcricao, args } });
    await encerrarSeNinguemDeve(item.id);
    return { ok: true, resposta: "Registrado. Agradeça e encerre a ligação." };
  }

  // S: guardrails do fornecedor, com os mesmos avisos do texto. A ressalva é falada, não mandada por mensagem.
  await tratarAlertasDaVoz(e.alertas, l, transcricao);
  const bloqueante = e.alertas.find((a) => f.ALERTAS_BLOQUEANTES.includes(a));
  if (bloqueante) {
    return { ok: false, resposta: `Não registrei a proposta. Diga ao fornecedor: "${f.RESSALVA[bloqueante]}" Se ele der uma proposta regular, registre de novo sem esse alerta; senão agradeça e encerre.` };
  }

  // Completa com a proposta anterior da rodada (texto ou ligação): o que não foi dito agora continua valendo.
  const condicao = condicaoDoDesconto(e, "");
  let marca: MarcaNegociacao | null = marcaDe(anterior?.extraido);
  if (anterior) {
    const opcoes = { quantidade: qtd, condicional: !!condicao };
    // "Mantenho" sem valor novo (resposta ao desconto, só a confirmação): a proposta anterior segue como estava.
    const completa = f.completarComAnterior(e, anterior, opcoes) ?? (temPropostaAnterior ? f.completarComAnterior(comoAnterior(e, anterior), anterior, opcoes) : null);
    if (completa) {
      const { negociacao, ...resto } = completa;
      e = resto;
      marca = negociacao ?? marca;
    }
    const pendente = (anterior.extraido ?? null) as { aConfirmar?: ("preco" | "item")[] } | null;
    if (pendente?.aConfirmar?.length && !e.aConfirmar && lida.e.precoUnitario === null && lida.e.totalProduto === null) e = { ...e, aConfirmar: pendente.aConfirmar };
    // Alerta já ouvido nesta rodada não some porque a chamada nova não o repetiu.
    const jaAlertas = ((anterior.extraido ?? {}) as { alertas?: AlertaFornecedor[] }).alertas ?? [];
    e = { ...e, alertas: [...new Set([...jaAlertas, ...e.alertas])] };
  }
  if (e.classificacao !== "proposta" || (e.precoUnitario === null && e.totalProduto === null)) {
    return { ok: false, resposta: "Falta o preço. Pergunte o preço (por unidade ou total) antes de registrar." };
  }

  const precoAConfirmar = !!e.aConfirmar?.includes("preco");
  const agora = new Date();
  if (condicao && marca && !e.pagamento?.includes("não aplicado")) e = { ...e, pagamento: `${e.pagamento ? `${e.pagamento}; ` : ""}desconto condicionado: "${condicao}" (não aplicado ao total)` };
  const depois: CondicaoProposta = {
    precoUnitario: precoAConfirmar ? null : e.precoUnitario,
    totalProduto: precoAConfirmar ? null : e.totalProduto,
    frete: e.frete,
    prazoDias: e.prazoDias,
    pagamento: e.pagamento,
    prazoPagamentoDias: e.prazoPagamentoDias,
    impostosValor: e.impostosValor,
  };
  // I1: a marca aberta só fecha quando a resposta ao desconto veio (dita, preço mudou ou condição);
  // a mesma proposta registrada de novo não vira "manteve" sozinha. A já respondida é recalculada, como no texto.
  let negociacao: MarcaNegociacao | undefined = marca ?? undefined;
  let fechouAgora = false;
  if (marca && !precoAConfirmar) {
    const mudou = produtoDe(marca.antes, qtd) !== produtoDe(depois, qtd) || (marca.antes.frete ?? null) !== (depois.frete ?? null);
    if (marca.respondidaEm || lida.respostaDesconto || mudou || condicao) {
      fechouAgora = !marca.respondidaEm;
      negociacao = resultadoNegociacao(marca, depois, qtd, { agora, condicao, firme: lida.firme || marca.firme });
    }
  }
  const perguntaPendente = e.aConfirmar?.length ? f.perguntaDeConfirmacao(e, item) : undefined;
  const extraidoBase = { ...e, modelo: `voz:${MODELO_VOZ()}`, ...(perguntaPendente ? { perguntaPendente } : {}) };

  const [nova] = await db.transaction(async (tx) => {
    await tx.delete(oferta).where(and(eq(oferta.cotacaoId, c.id), eq(oferta.rodada, c.rodada)));
    const linhas = await tx
      .insert(oferta)
      .values({
        itemPedidoId: item.id,
        fornecedorId: c.fornecedorId,
        cotacaoId: c.id,
        rodada: c.rodada,
        itemOferecido: e.itemOferecido ?? item.descricao,
        itemExato: e.itemExato,
        embalagem: e.embalagem,
        quantidadeOfertada: e.quantidadeOfertada?.toString(),
        unidadeOfertada: e.unidadeOfertada,
        precoUnitario: precoAConfirmar ? undefined : e.precoUnitario?.toFixed(2),
        totalProduto: precoAConfirmar ? undefined : e.totalProduto?.toFixed(2),
        frete: e.frete?.toFixed(2),
        origemFrete: e.frete !== null ? "informado" : null,
        prazoDias: e.prazoDias,
        validadeDias: e.validadeDias,
        pagamento: e.pagamento,
        prazoPagamentoDias: e.prazoPagamentoDias,
        impostosNaoInclusos: e.impostosNaoInclusos,
        impostosValor: e.impostosValor?.toString(),
        entregaNoLocal: e.entregaNoLocal,
        formato: "voz",
        extraido: { ...extraidoBase, ...(negociacao ? { negociacao } : {}) },
      })
      .returning();
    await tx.update(cotacao).set({ situacao: "respondeu", respondeuEm: new Date() }).where(eq(cotacao.id, c.id));
    return linhas;
  });

  const faltam = faltasDaProposta(e, retirada);
  await registrar(db, {
    agente: "Voz",
    acao: precoAConfirmar
      ? "Registrou a proposta dita na ligação, com o preço a confirmar (unitário ou total)."
      : `Registrou a proposta dita na ligação: ${e.precoUnitario !== null ? `R$ ${e.precoUnitario.toFixed(2).replace(".", ",")} por ${item.unidade}` : `total R$ ${e.totalProduto!.toFixed(2).replace(".", ",")}`}${e.prazoDias !== null ? `, ${e.prazoDias} dias` : ""}${e.itemExato ? "" : " (item diferente)"}.`,
    motivo: [faltam.length ? `Faltou: ${faltam.join(", ")}.` : "O fornecedor confirmou os valores na ligação.", e.aConfirmar?.length ? "Ficou a confirmar na própria ligação." : ""].filter(Boolean).join(" "),
    ...ctx,
    fornecedorIds: [c.fornecedorId],
    dados: { args, aderencia: e.aderencia, divergencias: e.divergencias, leituraPreco: e.leituraPreco, alertas: e.alertas, transcricao },
  });
  if (fechouAgora && negociacao?.resultado) await f.registrarResultado(negociacao, c.fornecedorId, ctx);

  // I1: pede desconto uma vez por fornecedor e item, com as mesmas regras e a mesma reserva do texto.
  let desconto: string | null = null;
  if (nova && !negociacao) {
    const decisao = deveNegociar({
      temPreco: depois.precoUnitario !== null || depois.totalProduto !== null,
      aConfirmar: !!e.aConfirmar?.length,
      alertas: e.alertas.length,
      jaPedido: item.negociacao?.rodada === c.rodada || (await jaPediuDesconto(c.fornecedorId, item.id)),
      estadoItem: item.estado,
      prazoRespostasEm: item.prazoRespostasEm,
      inicio: c.enviadaEm ?? c.criadoEm,
      agora,
      itemExato: e.itemExato,
      aceitaSimilar: item.aceitaSimilar,
      prazoDias: e.prazoDias,
      prazoMaxDias: ped.prazoMaxDias,
    });
    if (decisao.ok && (await reservarPedidoDeDesconto(c.fornecedorId, item.id, ped.id))) {
      // Import tardio: a busca na internet só roda aqui (processo dos bots); a página da ligação não a carrega.
      const { referenciasDoItem } = await import("../busca/internet.ts");
      const [recompra, refs] = await Promise.all([compraramAntes(c.fornecedorId), referenciasDoItem(item.id)]);
      const referencia = citarReferencia(unitarioDe(depois, qtd), refs.mediana);
      const montado = montarNegociacao({
        // R13: com a forma do comprador, o padrão da empresa não é oferecido como alavanca.
        alavancas: escolherAlavancas({ recompra, quantidade: qtd, pagamento: e.pagamento, pagamentoPreferido: ped.pagamentoPreferido, frete: retirada ? null : e.frete, entregas: ped.entregas }),
        quantidade: item.quantidade,
        unidade: item.unidade,
        frete: e.frete,
        referencia,
        janelaAte: decisao.janelaAte,
        agora,
      });
      desconto = descontoParaFalar(montado.texto, montado.permitidos);
      if (desconto) {
        negociacao = {
          pedidaEm: agora.toISOString(),
          janelaAte: decisao.janelaAte.toISOString(),
          rodadaAuto: 1,
          alavancas: montado.alavancas,
          referenciaCitada: montado.validado ? referencia : null,
          antes: depois,
        };
        await registrar(db, {
          agente: "Negociador",
          acao: "Pediu desconto na ligação por voz.",
          motivo: `Uma vez por fornecedor e item. Alavancas: ${negociacao.alavancas.join(", ") || "nenhuma"}.${negociacao.referenciaCitada !== null ? " Citou só a referência pública." : " Não citou valor de fora."}`,
          ...ctx,
          fornecedorIds: [c.fornecedorId],
          dados: { alavancas: negociacao.alavancas, janelaAte: negociacao.janelaAte, referenciaCitada: negociacao.referenciaCitada, canal: "voz" },
        });
      }
    }
  }

  // Com a marca já gravada, o fechamento espera a janela do desconto.
  if (nova && negociacao && !marca) await db.update(oferta).set({ extraido: { ...extraidoBase, negociacao } }).where(eq(oferta.id, nova.id));
  await encerrarSeNinguemDeve(item.id);
  const [agoraItem] = await db.select({ estado: itemPedido.estado }).from(itemPedido).where(eq(itemPedido.id, item.id));
  const ressalvas = e.alertas.map((a) => f.RESSALVA[a]).join(" ");
  const resposta = respostaAoRegistrar({
    aConfirmar: confirmacaoFalada(e, { descricao: item.descricao, unidade: item.unidade, quantidade: qtd }),
    faltam,
    desconto,
    ressalva: ressalvas || null,
    aberta: agoraItem?.estado === "cotando",
  });
  if (nova) {
    const voz: MarcaVoz = { args, resposta, em: agora.toISOString() };
    await db.update(oferta).set({ extraido: { ...extraidoBase, ...(negociacao ? { negociacao } : {}), voz } }).where(eq(oferta.id, nova.id));
  }
  return { ok: true, resposta };
}

/**
 * Alertas ouvidos na ligação: registra e avisa o comprador (e o gestor nos graves), como no
 * texto, uma vez por alerta e cotação. Nada vai ao fornecedor por mensagem: a ressalva é falada.
 */
async function tratarAlertasDaVoz(alertas: AlertaFornecedor[], l: Linha, transcricao: string) {
  if (!alertas.length) return;
  const f = await import("../../fluxo/fornecedor.ts");
  const { avisarGestor } = await import("../guardrail/rastro.ts");
  const ctx = { pedidoId: l.pedido.id, itemPedidoId: l.item.id };
  for (const a of alertas) {
    const [ja] = await db
      .select({ id: evento.id })
      .from(evento)
      .where(and(eq(evento.agente, "Voz"), eq(evento.itemPedidoId, l.item.id), sql`${evento.dados}->>'alerta' = ${a}`, sql`${evento.dados}->>'cotacaoId' = ${l.cotacao.id}`))
      .limit(1);
    if (ja) continue;
    await registrar(db, {
      agente: "Voz",
      acao: `Alerta na ligação com o fornecedor: ${a}.`,
      motivo: "Sinal de risco ouvido na ligação; a ressalva foi dita na hora.",
      ...ctx,
      fornecedorIds: [l.fornecedor.id],
      dados: { alerta: a, cotacaoId: l.cotacao.id, transcricao: falasDe(transcricao, "fornecedor").slice(-500) },
    });
    const aviso = f.AVISO_COMPRADOR[a];
    if (aviso) await enviar(l.pedido.compradorId, `Pedido ${l.pedido.id}: na ligação, ${l.fornecedor.nome} ${aviso}`, { ...ctx, tipo: "aviso" });
    if (f.AVISO_GESTOR.includes(a)) {
      await avisarGestor({ chave: `fornecedor:${a}:${l.fornecedor.id}:${l.item.id}`, texto: `Pedido ${l.pedido.id}: ${l.fornecedor.nome} — alerta ${a} na ligação por voz.`, contatoId: l.pedido.compradorId, ...ctx });
    }
  }
}

/**
 * Fim da ligação (qualquer motivo: desligou, silêncio, tempo, queda). A transcrição vai para o
 * rastro mesmo sem proposta; a fala do agente passa pela conferência de saída (o áudio não dá
 * para barrar antes). Depois, sem segurar a resposta, o Extrator relê o lado do fornecedor
 * para achar alerta que o agente não marcou (guardrails.md: o mesmo classificador do texto).
 */
export async function registrarFimDaLigacao(cotacaoId: string, p: { motivo: MotivoFim; transcricao: string; duracaoSeg: number | null }): Promise<{ ok: boolean }> {
  const l = await linhaDaCotacao(cotacaoId);
  if (!l) return { ok: false };
  const transcricao = cortarTranscricao(p.transcricao);
  const ctx = { pedidoId: l.pedido.id, itemPedidoId: l.item.id };
  const [o] = await db.select().from(oferta).where(and(eq(oferta.cotacaoId, cotacaoId), eq(oferta.rodada, l.cotacao.rodada))).limit(1);
  const comProposta = !!o && o.formato === "voz";
  await registrar(db, {
    agente: "Voz",
    acao: comProposta ? "Ligação por voz encerrada, com proposta registrada." : "Ligação por voz encerrada, sem proposta.",
    motivo: { desligou: "Encerrada na tela.", silencio: "Ninguém falou na linha.", tempo: "Chegou ao tempo máximo.", queda: "A conexão caiu.", erro: "Erro na ligação.", saiu: "Saiu da página." }[p.motivo] ?? "Encerrada.",
    ...ctx,
    fornecedorIds: [l.fornecedor.id],
    dados: { motivo: p.motivo, duracaoSeg: p.duracaoSeg, cotacaoId, transcricao },
  });
  const fala = conferirFalaDoAgente(transcricao);
  if (!fala.ok) {
    await registrar(db, {
      agente: "Guardrail",
      acao: "A fala do assistente na ligação não passou na conferência de saída.",
      motivo: `${fala.motivos.join("; ")}. Conferir a transcrição.`,
      ...ctx,
      fornecedorIds: [l.fornecedor.id],
      dados: { classe: "saida_voz", motivos: fala.motivos, cotacaoId },
    });
  }
  if (comProposta) void conferirAlertasDepois(l, o, transcricao).catch((erro) => console.error("[voz] releitura da ligação", erro));
  return { ok: true };
}

async function conferirAlertasDepois(l: Linha, o: typeof oferta.$inferSelect, transcricao: string) {
  const doFornecedor = falasDe(transcricao, "fornecedor").trim();
  if (!doFornecedor) return;
  const { extrair } = await import("../extrator/index.ts");
  const r = await extrair(
    { descricao: l.item.descricao, quantidade: Number(l.item.quantidade), unidade: l.item.unidade, aceitaSimilar: l.item.aceitaSimilar, destino: l.pedido.destino, modoEntrega: l.pedido.modoEntrega },
    { texto: doFornecedor },
    { pedidoId: l.pedido.id, itemPedidoId: l.item.id },
  );
  const ja = new Set((o.extraido as { alertas?: string[] } | null)?.alertas ?? []);
  const novos = r.valor.alertas.filter((a) => !ja.has(a));
  if (!novos.length) return;
  const [atual] = await db.select({ extraido: oferta.extraido }).from(oferta).where(eq(oferta.id, o.id));
  if (!atual) return;
  const extraido = atual.extraido as Record<string, unknown>;
  await db.update(oferta).set({ extraido: { ...extraido, alertas: [...ja, ...novos] } }).where(eq(oferta.id, o.id));
  await tratarAlertasDaVoz(novos, l, transcricao);
}

/** Mesma regra do Cotador: fecha a cotação quando ninguém mais deve resposta (import tardio evita ciclo). */
async function encerrarSeNinguemDeve(itemPedidoId: number) {
  const { encerrarSeTodosResponderam } = await import("../cotador/index.ts");
  await encerrarSeTodosResponderam(itemPedidoId);
}
