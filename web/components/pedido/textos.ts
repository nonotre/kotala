// Textos e regras de apresentação do pedido. Sem JSX e sem banco: tudo sai dos
// estados reais do pedido, dos itens, das cotações e do mapa.

import { MOTIVOS_CANCELAMENTO } from "../../../src/texto.ts";
import { COLUNAS } from "@/lib/dados";
import { ROTULO_COLUNA } from "@/lib/colunas";
import type { DadosPedido, ItemDoPedido } from "@/lib/dados-pedido";
import { hora, quantidade } from "@/lib/formato";
import { hrefAba, type AbaId, type EtapaId } from "./rotas";

export { MOTIVOS_CANCELAMENTO };
export { abaDaRota, areaDaAba, ETAPA_DA_ABA, hrefAba, type AbaId, type AreaId, type EtapaId } from "./rotas";

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
  interpretando: "Lendo a cotação",
  aguardando_confirmacao: "Aguardando sua confirmação",
  em_andamento: "Em andamento",
  concluido: "Concluída",
  cancelado: "Cancelada",
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

// ---------- Abas e etapas ----------
// Dois níveis: Pedido (Resumo e Histórico) e Compra, em 4 etapas na ordem em que
// acontecem. Cada tela continua em `/pedidos/<id>/<aba>`: os endereços antigos
// (busca, cotacoes, comparacao, negociacao, decisao) seguem valendo sem redirect.

/** Uma tela do pedido. `oculta`: só aparece quando existe (a Negociação) ou quando é a aberta. */
export type AbaPedido = { id: AbaId; rotulo: string; href: string; oculta?: boolean };

export type EstadoEtapa = "concluida" | "atual" | "futura";

/** Uma etapa da compra: o progresso e, ao mesmo tempo, o link para as telas dela. */
export type Etapa = {
  id: EtapaId;
  rotulo: string;
  /** A tela que abre ao clicar na etapa. */
  href: string;
  estado: EstadoEtapa;
  /** Pedido cancelado nesta etapa. */
  invalida: boolean;
  /** Texto curto abaixo do nome: o andamento ou, desabilitada, o motivo. */
  apoio: string;
  desabilitada: boolean;
  /** As telas da etapa. Com mais de uma visível, aparece o alternador. */
  vistas: AbaPedido[];
};

export type NavegacaoPedido = { pedidoId: number; hrefCompra: string; vistasPedido: AbaPedido[]; etapas: Etapa[] };

const ROTULO_ABA: Record<AbaId, string> = {
  resumo: "Resumo",
  historico: "Histórico",
  solicitado: "Solicitada",
  busca: "Busca",
  cotacoes: "Propostas",
  comparacao: "Mapa de cotações",
  negociacao: "Negociação",
  decisao: "Decisão",
};

const NAO_CONFIRMADO = ["interpretando", "aguardando_confirmacao"];

/** O que já existe no pedido para mostrar em cada tela. */
function conteudo(d: DadosPedido) {
  const { itens } = d;
  const temBusca = itens.some((i) => i.cotacoesTodas.length || i.referencias.length);
  const temCotacao = itens.some((i) => i.cotacoesTodas.length);
  const temMapa = itens.some((i) => i.mapasPorRodada.length);
  const temRecompra = itens.some((i) => i.recompra);
  const temNegociacao = itens.some((i) => i.item.negociacao || i.mapasPorRodada.length > 1 || i.ofertas.some((o) => o.rodada > 1));
  const temDecisao = temMapa || itens.some((i) => DECIDIDOS.includes(i.item.estado) || i.item.estado === "sem_proposta");
  return { temBusca, temCotacao, temMapa, temRecompra, temNegociacao, temDecisao };
}

/**
 * As 4 etapas da compra. Concluída e atual são clicáveis; futura fica desabilitada com o motivo,
 * a não ser que já tenha o que mostrar (o mapa pronto abre a Decisão ainda em Comparando).
 */
export function navegacaoDoPedido(d: DadosPedido): NavegacaoPedido {
  const { pedido: p } = d;
  const c = conteudo(d);
  const progresso = progressoDoPedido(d);
  const aba = (id: AbaId, oculta?: boolean): AbaPedido => ({ id, rotulo: ROTULO_ABA[id], href: hrefAba(p.id, id), oculta });
  const confirmado = !NAO_CONFIRMADO.includes(p.estado);
  const cancelado = p.estado === "cancelado";

  const definicoes: { id: EtapaId; rotulo: string; vistas: AbaPedido[]; inicio: AbaId; tem: boolean; motivo: string }[] = [
    { id: "solicitado", rotulo: ROTULO_COLUNA.Solicitado, vistas: [aba("solicitado")], inicio: "solicitado", tem: true, motivo: "" },
    {
      id: "cotando",
      rotulo: ROTULO_COLUNA.Cotando,
      vistas: [aba("busca"), aba("cotacoes")],
      // A etapa abre no que está andando: as cotações, quando já saíram; antes, a busca.
      inicio: c.temCotacao ? "cotacoes" : "busca",
      tem: c.temBusca,
      motivo: cancelado ? "A cotação foi cancelada antes da busca" : confirmado ? "A busca ainda não começou" : "A busca começa depois que você confirmar a cotação",
    },
    {
      id: "comparando",
      rotulo: ROTULO_COLUNA.Comparando,
      vistas: [aba("comparacao"), aba("negociacao", !c.temNegociacao)],
      inicio: "comparacao",
      tem: c.temMapa || c.temRecompra || c.temNegociacao,
      motivo: cancelado ? "A cotação foi cancelada antes do mapa" : "O mapa aparece quando as propostas chegarem",
    },
    {
      id: "decidido",
      rotulo: ROTULO_COLUNA.Decidido,
      vistas: [aba("decisao")],
      inicio: "decisao",
      tem: c.temDecisao,
      motivo: cancelado ? "A cotação foi cancelada sem decisão" : "Ainda não há o que decidir",
    },
  ];

  const etapas = definicoes.map((e, n): Etapa => {
    const estado: EstadoEtapa = n < progresso.atual ? "concluida" : n === progresso.atual ? "atual" : "futura";
    const desabilitada = estado === "futura" && !e.tem;
    return {
      id: e.id,
      rotulo: e.rotulo,
      href: hrefAba(p.id, e.inicio),
      estado,
      invalida: progresso.invalido && n === progresso.atual,
      apoio: desabilitada ? e.motivo : progresso.apoio[n]!,
      desabilitada,
      vistas: e.vistas,
    };
  });

  // Compra abre na etapa atual; pedido terminado, na última.
  const daVez = etapas.find((e) => e.estado === "atual") ?? etapas[etapas.length - 1]!;
  return { pedidoId: p.id, hrefCompra: daVez.href, vistasPedido: [aba("resumo"), aba("historico")], etapas };
}

/** "Cotação 14: Extintor ABC 6 kg", "Cotação 14: 3 itens" ou só "Cotação 14". Sem quantidade no título (Liria, interface.md). */
export function tituloPedido(d: DadosPedido) {
  const { pedido: p, itens } = d;
  if (itens.length === 1) return `Cotação ${p.id}: ${itens[0]!.item.descricao}`;
  if (itens.length > 1) return `Cotação ${p.id}: ${itens.length} itens`;
  return `Cotação ${p.id}`;
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
  // Cancelado com tudo parado: a etapa em que parou é a última que chegou a ter conteúdo.
  const c = conteudo(d);
  const ondeParou = c.temDecisao ? 3 : c.temMapa || c.temRecompra ? 2 : c.temBusca ? 1 : 0;
  const atual = terminou ? COLUNAS.length : vez ? COLUNAS.indexOf(vez.coluna) : p.estado === "cancelado" ? ondeParou : 0;

  const solicitado =
    p.estado === "interpretando" ? "Lendo a cotação" : p.estado === "aguardando_confirmacao" ? "" : p.estado === "cancelado" && atual === 0 ? "Cancelada" : "Você confirmou";

  const consultados = itens.reduce((t, i) => t + i.cotacoes.length, 0);
  const respostas = itens.reduce((t, i) => t + i.cotacoes.filter((c) => c.cotacao.situacao === "respondeu").length, 0);
  const cotando =
    consultados > 0 ? (respostas === 1 ? `1 de ${consultados} respondeu` : `${respostas} de ${consultados} responderam`) : atual >= 1 ? (vez?.item.estado === "buscando" ? "Procurando fornecedores" : "Sem proposta nova") : "";

  const validas = itens.reduce((t, i) => t + (i.mapa?.comparacao.validas.length ?? 0), 0);
  const comparando =
    vez?.item.estado === "aguardando_recompra"
      ? "Compra repetida: falta escolher"
      : atual < 2 && !itens.some((i) => i.mapa)
        ? ""
        : validas === 0
          ? "Nenhuma proposta válida"
          : validas === 1
            ? "1 proposta válida"
            : `${validas} propostas válidas`;

  const ativos = itens.filter((i) => i.item.estado !== "cancelado");
  const decididos = ativos.filter((i) => DECIDIDOS.includes(i.item.estado)).length;
  const aDecidir = itens.some((i) => i.item.estado === "aguardando_decisao");
  const todos = (estados: string[]) => ativos.length > 0 && ativos.every((i) => estados.includes(i.item.estado));
  const decidido = todos(["confirmado"])
    ? "Fornecedor confirmou o pedido"
    : todos(["pedido_enviado", "confirmado"])
      ? "Pedido enviado ao fornecedor"
      : ativos.length > 1
        ? `${decididos} de ${ativos.length} itens aprovados`
        : decididos
          ? "Você aprovou"
          : aDecidir
            ? "Falta a sua aprovação"
            : "";

  const apoio = [solicitado, cotando, comparando, decidido];
  const nome = p.estado === "cancelado" ? "Cotação cancelada" : terminou ? "Cotação concluída" : `Etapa: ${ROTULO_COLUNA[COLUNAS[atual]!]}`;
  return { atual, apoio, nome, invalido: p.estado === "cancelado" };
}

// ---------- O que falta agora ----------

export type Quem = "comprador" | "fornecedor" | "sistema" | "fim" | "cancelado";

export type ProximoPasso = { quem: Quem; texto: string; botao: { texto: string; href: string; aba: AbaId } | null };

/** Uma frase só, a partir do estado real. Prioridade: o que depende do comprador. */
export function proximoPasso(d: DadosPedido): ProximoPasso {
  const { pedido: p, itens } = d;
  const ir = (aba: AbaId, itemId?: number, texto = `Ir para ${ROTULO_ABA[aba]}`) => ({ texto, href: hrefAba(p.id, aba, itemId), aba });

  if (p.estado === "interpretando") return { quem: "sistema", texto: "Leitura da cotação em andamento.", botao: null };
  if (p.estado === "aguardando_confirmacao") return { quem: "comprador", texto: "Confirmação pendente: revise a leitura e confirme a cotação.", botao: ir("solicitado", undefined, "Conferir e confirmar") };
  if (p.estado === "cancelado") return { quem: "cancelado", texto: p.motivoCancelamento ? `Cotação cancelada: ${p.motivoCancelamento}` : "Cotação cancelada.", botao: null };

  const com = (estado: string) => itens.find((i) => i.item.estado === estado);
  // Dúvida só pede resposta enquanto a cotação está aberta (o assistente só repassa nesses estados).
  const duvida = itens.find((i) => i.item.duvidaPendente && (i.item.estado === "cotando" || i.item.estado === "buscando"));
  if (duvida?.item.duvidaPendente) {
    return { quem: "comprador", texto: `Dúvida pendente de ${duvida.item.duvidaPendente.fornecedor} sobre ${duvida.item.descricao}.`, botao: ir("cotacoes", duvida.item.id) };
  }
  const decidir = com("aguardando_decisao");
  if (decidir) return { quem: "comprador", texto: `Aprovação pendente: ${decidir.item.descricao}.`, botao: ir("decisao", decidir.item.id) };
  const recompra = com("aguardando_recompra");
  if (recompra) return { quem: "comprador", texto: `Recompra disponível para ${recompra.item.descricao}: repetir ou cotar novamente.`, botao: ir("comparacao", recompra.item.id, "Repetir ou cotar de novo") };
  const cotando = com("cotando");
  if (cotando) {
    const r = cotando.cotacoes.filter((c) => c.cotacao.situacao === "respondeu").length;
    const prazo = cotando.item.prazoRespostasEm ? `, respostas até ${hora(cotando.item.prazoRespostasEm)}` : "";
    return { quem: "fornecedor", texto: `Aguardando propostas de ${cotando.item.descricao}: ${r} de ${cotando.cotacoes.length}${prazo}.`, botao: ir("cotacoes", cotando.item.id) };
  }
  const buscando = com("buscando");
  if (buscando) return { quem: "sistema", texto: `Busca de fornecedores em andamento: ${buscando.item.descricao}.`, botao: ir("busca", buscando.item.id) };
  const comparando = com("comparando");
  if (comparando) return { quem: "sistema", texto: `Mapa de cotações em preparação: ${comparando.item.descricao}.`, botao: null };
  const enviado = com("pedido_enviado") ?? com("aprovado");
  if (enviado) {
    const nome = enviado.escolhido?.nome ?? "o fornecedor";
    return { quem: "fornecedor", texto: `Aguardando a confirmação de ${nome}: ${enviado.item.descricao}.`, botao: ir("decisao", enviado.item.id) };
  }
  const fila = com("na_fila");
  if (fila) return { quem: "sistema", texto: `Na fila: ${fila.item.descricao}.`, botao: null };
  return { quem: "fim", texto: p.estado === "concluido" ? "Cotação concluída: todos os itens terminaram." : "Nada pendente nesta cotação.", botao: null };
}
