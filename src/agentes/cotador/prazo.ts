// R14b (regra do dono, 08/11/2026): o prazo de respostas venceu com menos de 3 propostas
// válidas. O Cotador não decide sozinho: pergunta ao comprador, uma vez por prazo, com dois
// botões (`item:<id>:prazo_encerrar` e `item:<id>:prazo_estender`). Os botões valem no
// Telegram, no chat web e nas telas, porque todos entram pela mesma receber().
//
// - Encerrar: segue o fechamento de sempre. O mapa sai com o que houver, com o aviso de
//   "menos de 3"; sem proposta válida, o item fica sem proposta.
// - Estender: prorroga o prazo (um prazo de respostas novo), dá prioridade à cotação,
//   pergunta a quem não respondeu o motivo e consulta mais fornecedores (I3).
// - Sem resposta do comprador em ESPERA_RESPOSTA_PRAZO_FRACAO do prazo de respostas: encerra.
//   Estender é pedido do comprador; sem pedido, não estende.
// - Vale também quando todos responderam antes do prazo com menos de 3 válidas: ninguém
//   mais vai responder, então a escolha é a mesma.
// - Até MAX_PRORROGACOES por rodada. Depois, encerra com aviso.
// - Sem fornecedor devendo resposta e sem fornecedor novo para consultar, estender não
//   ajuda: encerra sem perguntar.
//
// "Dar prioridade à cotação", no código:
//   1. a busca automática (I3) volta a rodar sozinha a cada vencimento, enquanto houver
//      levas e fornecedores novos, sem perguntar de novo, com o teto normal mesmo em pedido urgente;
//   2. quem não respondeu recebe a pergunta do motivo (uma vez por prorrogação);
//   3. o que esses fornecedores respondem sem proposta (recusa, explicação) é repassado ao comprador;
//   4. fica no rastro (evento com `prioridade: true`); as telas podem ler com prioridadeDoItem.
//
// Estado sem migração: eventos com `dados.tipo` "prazo_pergunta" e "prazo_resposta", por rodada.
// Enquanto espera o comprador, o prazo de respostas do item fica no fim da espera, para o
// varredor (varrerPrazos) não fechar antes; os fornecedores ainda podem mandar proposta.

import { and, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { ESPERA_RESPOSTA_PRAZO_FRACAO, FRACAO_LEMBRETE, MAX_PRORROGACOES, prazoRespostasMs } from "../../config.ts";
import { db } from "../../nucleo/db/cliente.ts";
import { cotacao, evento, fornecedor, itemPedido } from "../../nucleo/db/schema.ts";
import { enviar, type Botao, type Contato } from "../../nucleo/mensagens/index.ts";
import { avancarItem, TransicaoConcorrente, TransicaoInvalida } from "../../nucleo/orquestrador/index.ts";
import { registrar, type Agente } from "../../nucleo/registro.ts";
import { quando, quantidade } from "../../texto.ts";
import { candidatosNovos } from "../busca/index.ts";
import { referenciasDoItem } from "../busca/internet.ts";
import { MINIMO_PROPOSTAS_VALIDAS } from "../comparador/calculo.ts";
import { liberarSaida } from "../guardrail/rastro.ts";
import { ampliarBusca, avisarComprador, contarPropostasValidas, dadosDoItem, tetoAmpliacoes, type Dados } from "./index.ts";

export const ROTULO_ENCERRAR = "Encerrar e ver as opções";
export const ROTULO_ESTENDER = "Estender o prazo";

/** Quanto tempo o comprador tem para escolher, em ms. */
export const esperaRespostaPrazoMs = () => prazoRespostasMs() * ESPERA_RESPOSTA_PRAZO_FRACAO;

export type OrigemFalta = "venceu" | "todos_responderam";
export type EscolhaPrazo = "encerrar" | "estender" | "sem_resposta";

type DadosPergunta = { tipo: "prazo_pergunta"; rodada: number; validas: number; origem: OrigemFalta; /** Prazo do item durante a espera (ISO). */ ate: string };
type DadosResposta = { tipo: "prazo_resposta"; rodada: number; escolha: EscolhaPrazo; prioridade?: boolean; prorrogacao?: number; novoPrazo?: string };

export type SituacaoPrazo = {
  /** Pergunta feita e ainda sem resposta. */
  aberta: DadosPergunta | null;
  /** Última escolha registrada nesta rodada, se o último evento for uma resposta. */
  ultima: EscolhaPrazo | null;
  prorrogacoes: number;
  prioridade: boolean;
};

/** Estado da pergunta do prazo no item, lido dos eventos da rodada. */
export async function situacaoDoPrazo(itemPedidoId: number, rodada: number): Promise<SituacaoPrazo> {
  const linhas = await db
    .select({ dados: evento.dados })
    .from(evento)
    .where(
      and(
        eq(evento.itemPedidoId, itemPedidoId),
        sql`${evento.dados}->>'tipo' in ('prazo_pergunta', 'prazo_resposta')`,
        sql`(${evento.dados}->>'rodada')::int = ${rodada}`,
      ),
    )
    .orderBy(desc(evento.criadoEm));
  const ds = linhas.map((l) => l.dados as DadosPergunta | DadosResposta);
  const ultimo = ds[0];
  const prorrogacoes = ds.filter((x) => x.tipo === "prazo_resposta" && x.escolha === "estender").length;
  return {
    aberta: ultimo?.tipo === "prazo_pergunta" ? ultimo : null,
    ultima: ultimo?.tipo === "prazo_resposta" ? ultimo.escolha : null,
    prorrogacoes,
    prioridade: prorrogacoes > 0,
  };
}

/** O comprador estendeu o prazo deste item na rodada atual (cotação com prioridade). */
export async function prioridadeDoItem(itemPedidoId: number): Promise<boolean> {
  const [i] = await db.select({ rodada: itemPedido.rodada }).from(itemPedido).where(eq(itemPedido.id, itemPedidoId));
  return !!i && (await situacaoDoPrazo(itemPedidoId, i.rodada)).prioridade;
}

/** Cotações enviadas que ainda devem resposta nesta rodada. */
async function devendo(itemPedidoId: number, rodada: number) {
  return db
    .select()
    .from(cotacao)
    .where(and(eq(cotacao.itemPedidoId, itemPedidoId), eq(cotacao.rodada, rodada), eq(cotacao.situacao, "aguardando"), isNotNull(cotacao.enviadaEm)));
}

const frasePropostas = (n: number) => (n === 0 ? "nenhuma proposta válida" : `só ${n} ${n === 1 ? "proposta válida" : "propostas válidas"}`);
const ateQuando = (d: Date) => quando(d).replace(/^às/, "até as").replace(/^em/, "até");

/** Texto da pergunta ao comprador. Função pura. */
export function textoPerguntaPrazo(p: { pedidoId: number; descricao: string; validas: number; devendo: number; origem: OrigemFalta; ate: Date }): string {
  const abertura =
    p.origem === "venceu"
      ? `Pedido ${p.pedidoId}: o prazo de respostas de ${p.descricao} venceu ${p.validas ? `com ${frasePropostas(p.validas)}` : "sem proposta válida"} (o mínimo para comparar é ${MINIMO_PROPOSTAS_VALIDAS})${p.devendo ? `; ${p.devendo} ${p.devendo === 1 ? "fornecedor não respondeu" : "fornecedores não responderam"}` : ""}.`
      : `Pedido ${p.pedidoId}: todos os fornecedores consultados para ${p.descricao} já responderam, mas ${p.validas ? `há ${frasePropostas(p.validas)}` : "nenhuma proposta é válida"} (o mínimo para comparar é ${MINIMO_PROPOSTAS_VALIDAS}).`;
  return [
    abertura,
    p.validas ? "Quer encerrar e ver as opções que tenho, ou estender o prazo?" : "Quer encerrar (o item fica sem proposta) ou estender o prazo?",
    `Se estender, a cotação ganha prioridade: ${p.devendo ? "pergunto a quem não respondeu o que aconteceu e " : ""}procuro mais fornecedores.`,
    `Sem resposta ${ateQuando(p.ate)}, encerro com o que houver.`,
  ].join(" ");
}

export const botoesPrazo = (itemPedidoId: number): Botao[] => [
  { rotulo: ROTULO_ENCERRAR, dado: `item:${itemPedidoId}:prazo_encerrar` },
  { rotulo: ROTULO_ESTENDER, dado: `item:${itemPedidoId}:prazo_estender` },
];

/**
 * Faltam propostas válidas: decide o que fazer. "encerrar" deixa o fechamento normal seguir;
 * "pular" segura o item (pergunta feita, esperando o comprador, ou busca ampliada).
 * Chamada pelo varredor no fim do prazo e por encerrarSeTodosResponderam.
 */
export async function verificarFaltaDePropostas(itemPedidoId: number, origem: OrigemFalta): Promise<"encerrar" | "pular"> {
  const d = await dadosDoItem(itemPedidoId);
  if (!d || d.item.estado !== "cotando") return "pular";
  const { item } = d;
  // A rodada de negociação (botão do comprador) fecha no prazo, sem perguntar: quem não responde mantém a proposta.
  if (item.negociacao?.rodada === item.rodada) return "encerrar";
  const validas = await contarPropostasValidas(d);
  if (validas >= MINIMO_PROPOSTAS_VALIDAS) return "encerrar";
  const sit = await situacaoDoPrazo(item.id, item.rodada);
  if (sit.ultima === "encerrar" || sit.ultima === "sem_resposta") return "encerrar";

  if (sit.aberta) {
    if (new Date(sit.aberta.ate).getTime() > Date.now()) return "pular";
    // O comprador não respondeu: encerra com o que houver.
    const ok = await responder(d, sit.aberta, { lembreteEm: null }, { escolha: "sem_resposta" }, {
      agente: "Cotador",
      acao: "Encerrou a cotação com as propostas que havia.",
      motivo: "O comprador não respondeu se queria encerrar ou estender o prazo (R14b).",
    });
    if (ok) await avisarComprador(d, `sem resposta sobre o prazo de ${item.descricao}, encerrei ${validas === 1 ? "com a única proposta válida que havia" : validas ? `com as ${validas} propostas válidas que havia` : "sem proposta válida"}.`);
    return ok ? "encerrar" : "pular";
  }

  // Cotação com prioridade: a busca automática tenta resolver sozinha enquanto houver levas.
  if (sit.prioridade) {
    const r = await ampliarBusca(item.id, { prioridade: true });
    if (r.resultado !== "encerrar") return "pular";
  }

  if (sit.prorrogacoes >= MAX_PRORROGACOES()) {
    await registrar(db, {
      agente: "Cotador",
      acao: "Encerrou sem perguntar de novo.",
      motivo: `O prazo já foi estendido ${sit.prorrogacoes} ${sit.prorrogacoes === 1 ? "vez" : "vezes"}, que é o limite (R14b).`,
      pedidoId: d.pedido.id,
      itemPedidoId: item.id,
      dados: { tipo: "prazo_limite", rodada: item.rodada, validas },
    });
    await avisarComprador(d, `o prazo estendido de ${item.descricao} venceu ${validas ? `com ${frasePropostas(validas)}` : "sem proposta válida"}. Já estendi ${sit.prorrogacoes} ${sit.prorrogacoes === 1 ? "vez" : "vezes"}, que é o limite; encerro com o que tenho.`);
    return "encerrar";
  }

  // Estender só ajuda se alguém ainda pode responder ou se há fornecedor novo para consultar.
  const aguardando = (await devendo(item.id, item.rodada)).length;
  const podeBuscar = item.ampliacoes < tetoAmpliacoes(d.pedido.urgencia, true) && (await candidatosNovos(item)).length > 0;
  if (!aguardando && !podeBuscar) return "encerrar";

  // Pergunta (ou outro varredor perguntou antes): de todo jeito, o item espera.
  await perguntar(d, validas, aguardando, origem);
  return "pular";
}

/** Faz a pergunta ao comprador. O claim no prazo do item garante uma pergunta só, mesmo com dois varredores. */
async function perguntar(d: Dados, validas: number, aguardando: number, origem: OrigemFalta): Promise<boolean> {
  const { item } = d;
  const agora = Date.now();
  const fimEspera = new Date(agora + esperaRespostaPrazoMs());
  // Todos responderam antes do prazo: a espera não encurta o prazo prometido aos fornecedores.
  const ate = item.prazoRespostasEm && item.prazoRespostasEm.getTime() > fimEspera.getTime() ? item.prazoRespostasEm : fimEspera;
  const dados: DadosPergunta = { tipo: "prazo_pergunta", rodada: item.rodada, validas, origem, ate: ate.toISOString() };
  const ganhou = await db.transaction(async (tx) => {
    const claim = await tx
      .update(itemPedido)
      .set({ prazoRespostasEm: ate, lembreteEm: null })
      .where(
        and(
          eq(itemPedido.id, item.id),
          eq(itemPedido.estado, "cotando"),
          eq(itemPedido.rodada, item.rodada),
          item.prazoRespostasEm ? eq(itemPedido.prazoRespostasEm, item.prazoRespostasEm) : sql`${itemPedido.prazoRespostasEm} is null`,
        ),
      )
      .returning({ id: itemPedido.id });
    if (!claim.length) return false;
    await registrar(tx, {
      agente: "Cotador",
      acao: "Perguntou ao comprador se encerra ou estende o prazo.",
      motivo: `${frasePropostas(validas).replace(/^./, (c) => c.toUpperCase())} ${origem === "venceu" ? "no fim do prazo" : "com todos já respondidos"}; o mínimo é ${MINIMO_PROPOSTAS_VALIDAS} (R14b).`,
      pedidoId: d.pedido.id,
      itemPedidoId: item.id,
      dados,
    });
    return true;
  });
  if (!ganhou) return false;
  const texto = textoPerguntaPrazo({ pedidoId: d.pedido.id, descricao: item.descricao, validas, devendo: aguardando, origem, ate });
  await enviar(d.pedido.compradorId, texto, { pedidoId: d.pedido.id, itemPedidoId: item.id, tipo: "aviso", botoes: botoesPrazo(item.id) });
  return true;
}

/**
 * Registra a resposta à pergunta aberta, numa transação com o claim no prazo do item (o
 * mesmo valor gravado na pergunta). false: outra resposta ou o fim da espera chegou antes.
 */
async function responder(
  d: Dados,
  aberta: DadosPergunta,
  set: Partial<typeof itemPedido.$inferInsert>,
  resposta: Omit<DadosResposta, "tipo" | "rodada">,
  ev: { agente: Agente; acao: string; motivo: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const claim = await tx
      .update(itemPedido)
      .set(set)
      .where(and(eq(itemPedido.id, d.item.id), eq(itemPedido.estado, "cotando"), eq(itemPedido.rodada, aberta.rodada), eq(itemPedido.prazoRespostasEm, new Date(aberta.ate))))
      .returning({ id: itemPedido.id });
    if (!claim.length) return false;
    await registrar(tx, { ...ev, pedidoId: d.pedido.id, itemPedidoId: d.item.id, dados: { tipo: "prazo_resposta", rodada: aberta.rodada, ...resposta } satisfies DadosResposta });
    return true;
  });
}

// ---------- Botões do comprador: item:<id>:prazo_encerrar | prazo_estender ----------

function ignorarCorrida(erro: unknown) {
  if (!(erro instanceof TransicaoInvalida || erro instanceof TransicaoConcorrente)) throw erro;
}

function textoJaResolvido(d: Dados): string {
  if (d.item.estado === "cotando") return `Pedido ${d.pedido.id}: o prazo de ${d.item.descricao} já foi resolvido. A cotação segue aberta${d.item.prazoRespostasEm ? ` ${ateQuando(d.item.prazoRespostasEm)}` : ""}.`;
  if (d.item.estado === "comparando" || d.item.estado === "aguardando_decisao") return `Pedido ${d.pedido.id}: a cotação de ${d.item.descricao} já foi encerrada; o mapa vem com as propostas que chegaram.`;
  return `Pedido ${d.pedido.id}: esta cotação não está esperando essa escolha agora.`;
}

/** Devolve true quando o dado era um destes botões (tratado ou ignorado). */
export async function aoBotaoDoPrazo(contato: Pick<Contato, "id">, dado: string): Promise<boolean> {
  const m = /^item:(\d+):prazo_(encerrar|estender)$/.exec(dado);
  if (!m) return false;
  const d = await dadosDoItem(Number(m[1]));
  if (!d || d.pedido.compradorId !== contato.id) return true; // item de outra pessoa: ignora
  const ctx = { pedidoId: d.pedido.id, itemPedidoId: d.item.id };
  const sit = d.item.estado === "cotando" ? await situacaoDoPrazo(d.item.id, d.item.rodada) : null;
  if (!sit?.aberta) {
    await enviar(contato.id, textoJaResolvido(d), ctx);
    return true;
  }
  const ok = m[2] === "encerrar" ? await encerrarPeloComprador(d, sit.aberta) : await estenderPeloComprador(d, sit);
  if (!ok) await enviar(contato.id, textoJaResolvido((await dadosDoItem(d.item.id)) ?? d), ctx);
  return true;
}

async function encerrarPeloComprador(d: Dados, aberta: DadosPergunta): Promise<boolean> {
  const ok = await responder(d, aberta, { prazoRespostasEm: new Date(), lembreteEm: null }, { escolha: "encerrar" }, {
    agente: "Comprador",
    acao: "Pediu para encerrar a cotação e ver as opções que havia.",
    motivo: "Prazo de respostas com menos de 3 propostas válidas (R14b): decisão do comprador.",
  });
  if (!ok) return false;
  // O mapa sai pelo caminho de sempre (Comparador), com o aviso de "menos de 3".
  await avancarItem(d.item.id, "encerrar_cotacao", { agente: "Comprador", motivo: "O comprador pediu para encerrar com as propostas que havia." }).catch(ignorarCorrida);
  return true;
}

async function estenderPeloComprador(d: Dados, sit: SituacaoPrazo): Promise<boolean> {
  const { item } = d;
  const refs = await referenciasDoItem(item.id);
  const valorEstimado = refs.mediana ? refs.mediana * Number(item.quantidade) : null;
  const prazoMs = prazoRespostasMs(valorEstimado);
  const agora = Date.now();
  const novoPrazo = new Date(agora + prazoMs);
  const prorrogacao = sit.prorrogacoes + 1;
  const ok = await responder(
    d,
    sit.aberta!,
    { prazoRespostasEm: novoPrazo, lembreteEm: new Date(agora + prazoMs * FRACAO_LEMBRETE) },
    { escolha: "estender", prioridade: true, prorrogacao, novoPrazo: novoPrazo.toISOString() },
    {
      agente: "Comprador",
      acao: `Estendeu o prazo de respostas ${ateQuando(novoPrazo)} e deu prioridade à cotação (prorrogação ${prorrogacao} de ${MAX_PRORROGACOES()}).`,
      motivo: "Prazo de respostas com menos de 3 propostas válidas (R14b): decisão do comprador.",
    },
  );
  if (!ok) return false;
  const perguntados = await perguntarMotivo(d, novoPrazo);
  // I3 com prioridade: teto normal mesmo em pedido urgente. O aviso vai junto do aviso abaixo.
  const busca = await ampliarBusca(item.id, { prioridade: true, avisar: false });
  const atual = (await dadosDoItem(item.id)) ?? d;
  const partes = [`estendi o prazo de ${item.descricao} ${ateQuando(atual.item.prazoRespostasEm ?? novoPrazo)} e dei prioridade à cotação.`];
  if (perguntados) partes.push(`Perguntei a ${perguntados} ${perguntados === 1 ? "fornecedor que não respondeu" : "fornecedores que não responderam"} o que aconteceu; repasso o que disserem.`);
  if (busca.enviadas) partes.push(`Consultei mais ${busca.enviadas} ${busca.enviadas === 1 ? "fornecedor" : "fornecedores"}.`);
  if (!perguntados && !busca.enviadas) partes.push("Não achei fornecedor novo para consultar agora; tento de novo no fim do prazo.");
  if (atual.item.estado === "cotando") await avisarComprador(atual, partes.join(" "));
  return true;
}

// ---------- Motivo da falta de proposta ----------

/** Pergunta curta e neutra a quem não respondeu. Função pura. */
export function textoMotivo(item: { id: number; quantidade: string | number; unidade: string; descricao: string }, novoPrazo: Date): string {
  return (
    `Sobre a cotação ${item.id} (${quantidade(item.quantidade, item.unidade)} de ${item.descricao}): ainda não recebi sua proposta, e o prazo foi estendido ${ateQuando(novoPrazo)}. ` +
    "Aconteceu algum impedimento, como estoque, prazo de entrega, especificação ou região de entrega? " +
    "Se puder cotar, mande preço, frete e prazo por aqui. Se não for atender, é só avisar."
  );
}

/**
 * Pergunta o motivo a quem recebeu a cotação e não respondeu. Vai direto, sem a fila da
 * cadência (U3): é sobre a mesma cotação que ele deve, como o lembrete, e por isso sai com
 * `tipo: "lembrete"` e conta como o lembrete dele nesta rodada.
 */
async function perguntarMotivo(d: Dados, novoPrazo: Date): Promise<number> {
  const lista = (await devendo(d.item.id, d.item.rodada)).filter((c) => c.contatoId);
  if (!lista.length) return 0;
  const texto = textoMotivo(d.item, novoPrazo);
  // S: o texto leva a descrição do item; confere antes de mandar.
  if (!(await liberarSaida(texto, { compradorId: d.pedido.compradorId, pedidoId: d.pedido.id, itemPedidoId: d.item.id, oQue: "a pergunta do motivo" }))) return 0;
  const enviados: string[] = [];
  for (const c of lista) {
    const r = await enviar(c.contatoId!, texto, { itemPedidoId: d.item.id, tipo: "lembrete" });
    if (r.situacao !== "enviada") continue;
    await db.update(cotacao).set({ lembreteEm: new Date() }).where(eq(cotacao.id, c.id));
    enviados.push(c.fornecedorId);
  }
  if (enviados.length) {
    await registrar(db, {
      agente: "Cotador",
      acao: `Perguntou a ${enviados.length} ${enviados.length === 1 ? "fornecedor" : "fornecedores"} por que não mandou proposta.`,
      motivo: "O comprador estendeu o prazo (R14b): verificar o motivo da falta de proposta.",
      pedidoId: d.pedido.id,
      itemPedidoId: d.item.id,
      fornecedorIds: enviados,
      dados: { tipo: "prazo_motivo", rodada: d.item.rodada },
    });
  }
  return enviados.length;
}

/**
 * Cotação com prioridade: o que um fornecedor sem proposta responde (recusa, explicação)
 * vai ao comprador. Devolve true quando repassou.
 */
export async function repassarMotivoAoComprador(c: typeof cotacao.$inferSelect, texto: string): Promise<boolean> {
  const t = texto.trim();
  if (!t) return false;
  const d = await dadosDoItem(c.itemPedidoId);
  if (!d || d.item.rodada !== c.rodada || !(await situacaoDoPrazo(d.item.id, d.item.rodada)).prioridade) return false;
  const [f] = await db.select({ nome: fornecedor.nome }).from(fornecedor).where(eq(fornecedor.id, c.fornecedorId));
  const nome = f?.nome ?? "Um fornecedor";
  await avisarComprador(d, `${nome} respondeu sobre a falta de proposta de ${d.item.descricao}: "${t.slice(0, 300)}"`);
  await registrar(db, {
    agente: "Cotador",
    acao: `Repassou ao comprador o motivo de ${nome}.`,
    motivo: "Cotação com prioridade (R14b): o motivo da falta de proposta vai ao comprador.",
    pedidoId: d.pedido.id,
    itemPedidoId: d.item.id,
    fornecedorIds: [c.fornecedorId],
    dados: { tipo: "prazo_motivo_resposta", rodada: c.rodada, texto: t.slice(0, 1000) },
  });
  return true;
}

/** Tarefa do varredor, antes de varrerPrazos. Falha aqui deixa o fechamento normal valer. */
export async function verificarVencidos(agora: Date) {
  const vencidos = await db
    .select({ id: itemPedido.id })
    .from(itemPedido)
    .where(and(eq(itemPedido.estado, "cotando"), lte(itemPedido.prazoRespostasEm, agora)));
  for (const { id } of vencidos) {
    await verificarFaltaDePropostas(id, "venceu").catch((e) => console.error("[prazo]", id, e));
  }
}
