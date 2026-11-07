// Textos e regras de apresentação do pedido. Sem JSX e sem banco: tudo sai dos
// estados reais do pedido, dos itens, das cotações e do mapa.

import { MOTIVOS_CANCELAMENTO } from "../../../src/texto.ts";
import { COLUNAS } from "@/lib/dados";
import type { DadosPedido, ItemDoPedido } from "@/lib/dados-pedido";
import { hora, quantidade } from "@/lib/formato";

export { MOTIVOS_CANCELAMENTO };

/** Limite de rodadas de cotação por item (o mesmo do backend). */
export const MAX_RODADAS = 3;

export type Indicador = "failed" | "caution-major" | "caution-minor" | "undefined" | "succeeded" | "normal" | "in-progress" | "incomplete" | "not-started" | "pending" | "unknown" | "informative";

export const ESTADO_ITEM: Record<string, string> = {
  na_fila: "Na fila",
  buscando: "Buscando fornecedores",
  aguardando_recompra: "Compra repetida: repetir ou cotar de novo?",
  cotando: "Esperando propostas",
  comparando: "Montando o mapa",
  aguardando_decisao: "Aguardando sua decisão",
  aprovado: "Aprovado",
  pedido_enviado: "Pedido enviado ao fornecedor",
  confirmado: "Confirmado pelo fornecedor",
  sem_proposta: "Sem proposta válida",
  cancelado: "Cancelado",
};

export const INDICADOR_ITEM: Record<string, Indicador> = {
  na_fila: "not-started",
  buscando: "in-progress",
  aguardando_recompra: "informative",
  cotando: "in-progress",
  comparando: "pending",
  aguardando_decisao: "informative",
  aprovado: "succeeded",
  pedido_enviado: "in-progress",
  confirmado: "succeeded",
  sem_proposta: "incomplete",
  cancelado: "undefined",
};

export const ESTADO_PEDIDO: Record<string, string> = {
  interpretando: "Lendo o pedido",
  aguardando_confirmacao: "Aguardando sua confirmação",
  em_andamento: "Em andamento",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

export const INDICADOR_PEDIDO: Record<string, Indicador> = {
  interpretando: "pending",
  aguardando_confirmacao: "informative",
  em_andamento: "in-progress",
  concluido: "succeeded",
  cancelado: "undefined",
};

export const SITUACAO: Record<string, string> = {
  aguardando: "Aguardando",
  respondeu: "Respondeu",
  sem_resposta: "Sem resposta",
  parou: "Pediu para parar",
  desistiu: "Desistiu",
  encerrada: "Não atende",
};

export const INDICADOR_SITUACAO: Record<string, Indicador> = {
  aguardando: "pending",
  respondeu: "succeeded",
  sem_resposta: "incomplete",
  parou: "incomplete",
  desistiu: "incomplete",
  encerrada: "not-started",
};

/** Como a proposta chegou. */
export const FORMATO_OFERTA: Record<string, string> = {
  texto: "Mensagem",
  pdf: "PDF",
  foto: "Foto",
  voz: "Ligação",
  busca: "Busca na internet",
  historico: "Compra anterior",
};

export const CANAL: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  email: "E-mail",
  web: "Conversa no site",
  voz: "Voz",
  simulado: "Canal simulado",
};

/** "1. 40 sacos de Cimento CP II 50 kg". */
export const tituloItem = (i: ItemDoPedido["item"]) => `${i.ordem}. ${quantidade(i.quantidade, i.unidade)} de ${i.descricao}`;

export const DECIDIDOS = ["aprovado", "pedido_enviado", "confirmado"];

// ---------- Abas ----------

export type AbaId = "resumo" | "busca" | "cotacoes" | "comparacao" | "negociacao" | "decisao" | "historico";

export type AbaPedido = { id: AbaId; rotulo: string; href: string; desabilitada: boolean; motivo?: string; oculta?: boolean };

export const hrefAba = (pedidoId: number, aba: AbaId, itemId?: number) =>
  `/pedidos/${pedidoId}${aba === "resumo" ? "" : `/${aba}`}${itemId !== undefined ? `#item-${itemId}` : ""}`;

/** Aba sem conteúdo ainda fica desabilitada, com o motivo. Negociação só aparece quando existe. */
export function abasDoPedido(d: DadosPedido): AbaPedido[] {
  const { pedido: p, itens } = d;
  const confirmado = !["interpretando", "aguardando_confirmacao"].includes(p.estado);
  const temBusca = itens.some((i) => i.cotacoesTodas.length || i.referencias.length);
  const temCotacao = itens.some((i) => i.cotacoesTodas.length);
  const temMapa = itens.some((i) => i.mapasPorRodada.length);
  const temNegociacao = itens.some((i) => i.item.negociacao || i.mapasPorRodada.length > 1 || i.ofertas.some((o) => o.rodada > 1));
  const temDecisao = temMapa || itens.some((i) => DECIDIDOS.includes(i.item.estado) || i.item.estado === "sem_proposta");
  const aba = (id: AbaId, rotulo: string, desabilitada: boolean, motivo?: string, oculta?: boolean): AbaPedido => ({ id, rotulo, href: hrefAba(p.id, id), desabilitada, motivo, oculta });
  return [
    aba("resumo", "Resumo", false),
    aba("busca", "Busca", !temBusca, confirmado ? "A busca ainda não achou fornecedor" : "A busca começa depois que você confirmar o pedido"),
    aba("cotacoes", "Cotações", !temCotacao, "Nenhum fornecedor recebeu a cotação ainda"),
    aba("comparacao", "Comparação", !temMapa, "O mapa aparece quando as propostas chegarem"),
    aba("negociacao", "Negociação", false, undefined, !temNegociacao),
    aba("decisao", "Decisão", !temDecisao, "Ainda não há o que decidir"),
    aba("historico", "Histórico", false),
  ];
}

// ---------- Progresso das etapas ----------

export type Progresso = { atual: number; apoio: string[]; nome: string; invalido: boolean };

const FINAIS = ["confirmado", "sem_proposta", "cancelado"];

/** O item que está andando agora: o primeiro que não terminou e não está na fila. */
export function itemDaVez(d: DadosPedido): ItemDoPedido | null {
  const abertos = d.itens.filter((i) => !FINAIS.includes(i.item.estado));
  return abertos.find((i) => i.item.estado !== "na_fila") ?? abertos[0] ?? null;
}

export function progressoDoPedido(d: DadosPedido): Progresso {
  const { pedido: p, itens } = d;
  const vez = itemDaVez(d);
  const terminou = p.estado === "concluido" || (p.estado === "em_andamento" && itens.length > 0 && !vez);
  const atual = terminou ? COLUNAS.length : vez ? COLUNAS.indexOf(vez.coluna) : 0;

  const solicitado =
    p.estado === "interpretando" ? "Lendo o pedido" : p.estado === "aguardando_confirmacao" ? "Falta confirmar" : p.estado === "cancelado" && atual === 0 ? "Cancelado" : "Você confirmou";

  const consultados = itens.reduce((t, i) => t + i.cotacoes.length, 0);
  const respostas = itens.reduce((t, i) => t + i.cotacoes.filter((c) => c.cotacao.situacao === "respondeu").length, 0);
  const cotando =
    consultados > 0 ? (respostas === 1 ? `1 de ${consultados} respondeu` : `${respostas} de ${consultados} responderam`) : atual >= 1 ? (vez?.item.estado === "buscando" ? "Procurando fornecedores" : "Sem cotação nova") : "Ainda não começou";

  const validas = itens.reduce((t, i) => t + (i.mapa?.comparacao.validas.length ?? 0), 0);
  const comparando =
    vez?.item.estado === "aguardando_recompra"
      ? "Compra repetida: falta escolher"
      : atual < 2 && !itens.some((i) => i.mapa)
        ? "Ainda não começou"
        : validas === 0
          ? "Nenhuma proposta válida"
          : validas === 1
            ? "1 proposta válida"
            : `${validas} propostas válidas`;

  const ativos = itens.filter((i) => i.item.estado !== "cancelado");
  const decididos = ativos.filter((i) => DECIDIDOS.includes(i.item.estado)).length;
  const decidido = ativos.length > 1 ? `${decididos} de ${ativos.length} itens aprovados` : decididos ? "Você aprovou" : "Só com a sua aprovação";

  const apoio = [solicitado, cotando, comparando, decidido];
  const nome = p.estado === "cancelado" ? "Pedido cancelado" : terminou ? "Pedido concluído" : `Etapa: ${COLUNAS[atual]}`;
  return { atual, apoio, nome, invalido: p.estado === "cancelado" };
}

// ---------- O que falta agora ----------

export type Quem = "comprador" | "fornecedor" | "sistema" | "fim";

export type ProximoPasso = { quem: Quem; texto: string; botao: { texto: string; href: string; aba: AbaId } | null };

const ROTULO_ABA: Record<AbaId, string> = {
  resumo: "Resumo",
  busca: "Busca",
  cotacoes: "Cotações",
  comparacao: "Comparação",
  negociacao: "Negociação",
  decisao: "Decisão",
  historico: "Histórico",
};

/** Uma frase só, a partir do estado real. Prioridade: o que depende do comprador. */
export function proximoPasso(d: DadosPedido): ProximoPasso {
  const { pedido: p, itens } = d;
  const ir = (aba: AbaId, itemId?: number) => ({ texto: `Ir para ${ROTULO_ABA[aba]}`, href: hrefAba(p.id, aba, itemId), aba });

  if (p.estado === "interpretando") return { quem: "sistema", texto: "O assistente está lendo o pedido.", botao: null };
  if (p.estado === "aguardando_confirmacao") return { quem: "comprador", texto: "Confira o que o assistente entendeu e confirme o pedido.", botao: ir("resumo") };
  if (p.estado === "cancelado") return { quem: "fim", texto: p.motivoCancelamento ? `Pedido cancelado: ${p.motivoCancelamento}` : "Pedido cancelado.", botao: null };

  const com = (estado: string) => itens.find((i) => i.item.estado === estado);
  const duvida = itens.find((i) => i.item.duvidaPendente);
  if (duvida?.item.duvidaPendente) {
    return { quem: "comprador", texto: `${duvida.item.duvidaPendente.fornecedor} tem uma dúvida sobre ${duvida.item.descricao}.`, botao: ir("cotacoes", duvida.item.id) };
  }
  const decidir = com("aguardando_decisao");
  if (decidir) return { quem: "comprador", texto: `Decida a compra de ${decidir.item.descricao}.`, botao: ir("decisao", decidir.item.id) };
  const recompra = com("aguardando_recompra");
  if (recompra) return { quem: "comprador", texto: `Repita a compra de ${recompra.item.descricao} ou cote de novo.`, botao: ir("resumo", recompra.item.id) };
  const cotando = com("cotando");
  if (cotando) {
    const r = cotando.cotacoes.filter((c) => c.cotacao.situacao === "respondeu").length;
    const prazo = cotando.item.prazoRespostasEm ? `, respostas até ${hora(cotando.item.prazoRespostasEm)}` : "";
    return { quem: "fornecedor", texto: `Esperando propostas para ${cotando.item.descricao}: ${r} de ${cotando.cotacoes.length}${prazo}.`, botao: ir("cotacoes", cotando.item.id) };
  }
  const buscando = com("buscando");
  if (buscando) return { quem: "sistema", texto: `Procurando fornecedores para ${buscando.item.descricao}.`, botao: ir("busca", buscando.item.id) };
  const comparando = com("comparando");
  if (comparando) return { quem: "sistema", texto: `Montando o mapa de ${comparando.item.descricao}.`, botao: null };
  const enviado = com("pedido_enviado") ?? com("aprovado");
  if (enviado) {
    const nome = enviado.escolhido?.nome ?? "o fornecedor";
    return { quem: "fornecedor", texto: `Esperando ${nome} confirmar ${enviado.item.descricao}.`, botao: ir("decisao", enviado.item.id) };
  }
  const fila = com("na_fila");
  if (fila) return { quem: "sistema", texto: `${fila.item.descricao} está na fila.`, botao: null };
  return { quem: "fim", texto: p.estado === "concluido" ? "Pedido concluído: todos os itens terminaram." : "Nada pendente neste pedido.", botao: null };
}
