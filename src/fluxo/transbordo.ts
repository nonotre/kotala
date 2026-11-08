// Transbordo inteligente (ideia da Ester, ideiastransbordo.md). Quando o comprador ou o fornecedor
// pede para falar com uma pessoa, o agente primeiro tenta resolver com o que sabe. Se a pessoa
// insistir, o agente pede a mensagem, repassa ao outro lado e traz a resposta de volta.
//
// - Fornecedor → comprador: usa o que já existe. A tentativa é o responderDuvida do Cotador (com
//   assunto) ou a pergunta "qual é o assunto?"; o recado vai ao comprador como dúvida pendente
//   (item_pedido.duvidaPendente), e a resposta dele volta pelo repassarRespostaDoComprador.
// - Comprador → fornecedor: o equivalente, com o estado em evento.dados (sem migração). O recado é
//   uma pergunta nova ao fornecedor: passa pela conferência de saída (liberarSaida), pela regra de
//   sigilo (nenhum valor ou menção de outro fornecedor) e pela cadência (pedirAoFornecedor: com
//   outra pergunta pendente, espera na fila). A próxima mensagem do fornecedor volta ao comprador.
//
// Os eventos ficam no agente "Cotador", com dados.transbordo = "comprador" | "fornecedor".

import { and, desc, eq, gte, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { responderDuvida } from "../agentes/cotador/index.ts";
import { aoProcurarPerguntas, aoVarrerFila, pedirAoFornecedor, type Pergunta } from "../agentes/cotador/cadencia.ts";
import { formatarBRL } from "../agentes/comparador/calculo.ts";
import { liberarSaida } from "../agentes/guardrail/rastro.ts";
import { semAcento } from "../agentes/guardrail/index.ts";
import { palavrasEmComum } from "../agentes/interpretador/index.ts";
import { PALAVRAS_PROIBIDAS, valoresEmReais } from "../agentes/negociador/index.ts";
import { EMPRESA } from "../config.ts";
import { db } from "../nucleo/db/cliente.ts";
import { contato, cotacao, evento, fornecedor, itemPedido, oferta, pedido } from "../nucleo/db/schema.ts";
import { contatoAtivoDoFornecedor, enviar, type Botao, type ResultadoEnvio } from "../nucleo/mensagens/index.ts";
import { registrar } from "../nucleo/registro.ts";
import { quando, quantidadeDe } from "../texto.ts";

/** Até quando vale um pedido de transbordo em andamento (tentou, escolher, aguardando a mensagem). */
export const VALIDADE_TRANSBORDO_MS = 30 * 60_000;
/** Até quando a resposta do fornecedor a um recado volta ao comprador. */
export const VALIDADE_RECADO_MS = 48 * 3600_000;

// ---------- Leitura do texto (código, sem IA) ----------

/** "Quero falar com o fornecedor", "passa um recado pro fornecedor", "me liga com a loja". */
export function pedeFalarComFornecedor(texto: string): boolean {
  const t = semAcento(texto);
  return (
    /\b(quero|queria|preciso|precisava|gostaria|posso|pode|podia|da pra|tem como|como)\b[^.?!]{0,20}\b(falar|conversar|contato|contatar|ligar|telefonar|whats\w*|zap)\b[^.?!]{0,40}\b(fornecedor|fornecedora|vendedor|distribuidor)\b/.test(t) ||
    /\b(passa|passe|da|de|manda|mande)\b[^.?!]{0,10}\b(contato|telefone|numero|whats\w*|email|e-mail)\b[^.?!]{0,10}\bd[oa]\s+(fornecedor|fornecedora|vendedor)\b/.test(t) ||
    /\b(recado|mensagem|pergunta|perguntar|avisar|avisa|pergunte)\b[^.?!]{0,25}\b(pro|pra|para o|para a|ao|a)\s+(fornecedor|fornecedora|vendedor)\b/.test(t) ||
    /\b(passa|passe|repassa|repasse)\b[^.?!]{0,25}\b(pro|pra|para o|para a|ao)\s+(fornecedor|fornecedora|vendedor)\b/.test(t)
  );
}

/** "Não resolveu", "preciso falar direto com ele": a pessoa insiste depois da tentativa. */
export function insiste(texto: string): boolean {
  const t = semAcento(texto);
  return /\bnao (resolveu|ajudou|e isso|serve|foi isso|era isso)\b|\b(preciso|quero|prefiro) (mesmo )?falar (direto|diretamente|mesmo|com (ele|ela|eles|o fornecedor|o comprador|uma pessoa|alguem))\b|\bdireto com (ele|ela|o fornecedor|o comprador)\b|\bfalar com (uma pessoa|alguem|um humano|o responsavel)\b/.test(t);
}

const PEDIDO_DE_CONTATO =
  /\b(quero|queria|preciso|gostaria de|posso|pode|da pra|tem como)?\s*(falar|conversar|contato|ligar|telefonar)\s*(com|pro|pra|para|ao|a)?\s*(o|a|um|uma)?\s*(fornecedor|comprador|responsavel|pessoa|alguem|humano|atendente|gerente|vendedor|setor de compras)?\b|\b(me liga|me ligue|liga pra mim|ligue pra mim|seu telefone|o telefone|numero de telefone|whatsapp|zap)\b|\bpor favor\b|\bobrigad[oa]\b/g;

/** Sobra assunto depois de tirar o pedido de falar com alguém ("quero falar com o comprador sobre o frete" tem; "quero falar com alguém" não). */
export function temAssunto(texto: string): boolean {
  const resto = semAcento(texto).replace(PEDIDO_DE_CONTATO, " ").replace(/[^a-z0-9?]+/g, " ").trim();
  const palavras = resto.split(" ").filter((p) => p.length > 2 && !/^(sobre|isso|aqui|agora|hoje|voce|voces|com|para|pra|pro|uma|um|que|ele|ela)$/.test(p));
  return palavras.length >= 2;
}

/** Recado com preço: além de repassar, segue para o Extrator como proposta. */
export const pareceProposta = (texto: string) => /R\$\s*\d|\b\d+[.,]\d{2}\b|\b\d+\s*reais\b/i.test(texto);

/**
 * Regra da área de compras: o que vai ao fornecedor nunca cita valor nem proposta de outro
 * fornecedor. O recado do comprador só pode ter valores da própria proposta deste fornecedor.
 */
export function conferirRecado(texto: string, valoresDoFornecedor: readonly number[]): { ok: boolean; motivos: string[] } {
  const motivos: string[] = [];
  for (const v of valoresEmReais(texto)) {
    if (!valoresDoFornecedor.some((p) => Math.abs(p - v) < 0.005)) motivos.push(`valor que não é da proposta dele (R$ ${v.toFixed(2).replace(".", ",")})`);
  }
  const t = semAcento(texto);
  // Só o que revela outro fornecedor; "pode sair mais barato?" é pergunta legítima do comprador.
  for (const p of PALAVRAS_PROIBIDAS.filter((x) => /concorrente|outro fornecedor|ranking/.test(x.motivo))) {
    if (p.padrao.test(t)) motivos.push(p.motivo);
  }
  return { ok: motivos.length === 0, motivos };
}

export type Candidato = {
  itemPedidoId: number;
  pedidoId: number;
  descricao: string;
  quantidade: string;
  unidade: string;
  estado: string;
  fornecedorId: string;
  fornecedor: string;
  atualizadoEm: Date;
};

/**
 * Com qual fornecedor falar: o citado pelo nome, ou o da cotação citada ("cotação 12", "pedido 7");
 * com um só fornecedor nas cotações em andamento, ele. Senão, até 4 opções em botões.
 */
export function escolherAlvo(texto: string, candidatos: readonly Candidato[]): { tipo: "um"; alvo: Candidato } | { tipo: "varios"; opcoes: Candidato[] } | { tipo: "nenhum" } {
  if (!candidatos.length) return { tipo: "nenhum" };
  const t = semAcento(texto);
  let lista = [...candidatos].sort((a, b) => b.atualizadoEm.getTime() - a.atualizadoEm.getTime());
  const pelaCotacao = /\bcotac[a-z]*\s*(?:n[ºo°.]?\s*)?(\d+)/.exec(t)?.[1];
  const peloPedido = /\bpedido\s*(?:n[ºo°.]?\s*)?(\d+)/.exec(t)?.[1];
  if (pelaCotacao) lista = lista.filter((c) => c.itemPedidoId === Number(pelaCotacao));
  else if (peloPedido) lista = lista.filter((c) => c.pedidoId === Number(peloPedido));
  const peloNome = lista.filter((c) => palavrasEmComum(texto, c.fornecedor));
  if (peloNome.length) lista = peloNome;
  const fornecedores = new Set(lista.map((c) => c.fornecedorId));
  if (lista.length && fornecedores.size === 1) return { tipo: "um", alvo: lista[0]! };
  if (!lista.length) return { tipo: "nenhum" };
  const opcoes: Candidato[] = [];
  for (const c of lista) if (opcoes.length < 4 && !opcoes.some((o) => o.fornecedorId === c.fornecedorId && o.itemPedidoId === c.itemPedidoId)) opcoes.push(c);
  return { tipo: "varios", opcoes };
}

// ---------- Estado (evento.dados, agente "Cotador") ----------

type EtapaComprador = "tentou" | "escolher" | "aguardando_mensagem" | "na_fila" | "repassada" | "respondida" | "nao_entregue";
export type EstadoComprador = {
  transbordo: "comprador";
  compradorId: string;
  etapa: EtapaComprador;
  itemPedidoId?: number;
  pedidoId?: number;
  fornecedorId?: string;
  fornecedor?: string;
  descricao?: string;
  insistiu?: boolean;
  recado?: string;
  /** Evento do recado na fila, que a pergunta repassada reserva. */
  recadoDe?: string;
};
type EtapaFornecedor = "tentou" | "aguardando_mensagem" | "repassada";
export type EstadoFornecedor = { transbordo: "fornecedor"; fornecedorId: string; contatoId: string; cotacaoId: string; etapa: EtapaFornecedor };

async function gravar(dados: EstadoComprador | EstadoFornecedor, e: { acao: string; motivo: string; pedidoId?: number; itemPedidoId?: number; fornecedorIds?: string[] }) {
  return registrar(db, { agente: "Cotador", ...e, dados });
}

async function ultimo<T>(filtro: ReturnType<typeof sql>, desde: Date): Promise<{ id: string; em: Date; dados: T } | null> {
  const [e] = await db
    .select({ id: evento.id, em: evento.criadoEm, dados: evento.dados })
    .from(evento)
    .where(and(eq(evento.agente, "Cotador"), gte(evento.criadoEm, desde), filtro))
    .orderBy(desc(evento.criadoEm))
    .limit(1);
  return e ? { id: e.id, em: e.em, dados: e.dados as T } : null;
}

const desde = (ms: number) => new Date(Date.now() - ms);

/** Transbordo do comprador em andamento (até 30 min), ou null. */
export async function estadoDoComprador(compradorId: string) {
  return ultimo<EstadoComprador>(sql`${evento.dados}->>'transbordo' = 'comprador' and ${evento.dados}->>'compradorId' = ${compradorId}`, desde(VALIDADE_TRANSBORDO_MS));
}

/** O comprador está escrevendo o recado ao fornecedor: a próxima mensagem dele é o recado (o roteador manda direto ao fluxo). */
export async function esperandoRecadoDoComprador(compradorId: string): Promise<boolean> {
  return (await estadoDoComprador(compradorId))?.dados.etapa === "aguardando_mensagem";
}

/** Último recado do comprador a este fornecedor (até 48 h). */
async function recadoAoFornecedor(fornecedorId: string) {
  return ultimo<EstadoComprador>(sql`${evento.dados}->>'transbordo' = 'comprador' and ${evento.dados}->>'fornecedorId' = ${fornecedorId} and ${evento.dados}->>'etapa' in ('na_fila', 'repassada', 'respondida', 'nao_entregue')`, desde(VALIDADE_RECADO_MS));
}

async function estadoDoFornecedor(fornecedorId: string) {
  return ultimo<EstadoFornecedor>(sql`${evento.dados}->>'transbordo' = 'fornecedor' and ${evento.dados}->>'fornecedorId' = ${fornecedorId}`, desde(VALIDADE_TRANSBORDO_MS));
}

// ---------- Comprador → fornecedor ----------

/** Contatos da mesma pessoa (o chat web abre um contato por conversa, ligado à mesma conta). */
async function contatosDaMesmaConta(compradorId: string): Promise<string[]> {
  const [eu] = await db.select({ usuarioId: contato.usuarioId }).from(contato).where(eq(contato.id, compradorId));
  if (!eu?.usuarioId) return [compradorId];
  const outros = await db.select({ id: contato.id }).from(contato).where(eq(contato.usuarioId, eu.usuarioId));
  return [...new Set([compradorId, ...outros.map((c) => c.id)])];
}

/**
 * Fornecedores com quem o comprador pode trocar recado: os que receberam a cotação (com contato) dos
 * itens em andamento dos últimos 7 dias; depois do pedido de compra, só o escolhido.
 */
export async function candidatosDoComprador(compradorId: string): Promise<Candidato[]> {
  const compradores = await contatosDaMesmaConta(compradorId);
  const linhas = await db
    .select({ item: itemPedido, pedidoId: pedido.id, fornecedorId: cotacao.fornecedorId, nome: fornecedor.nome })
    .from(cotacao)
    .innerJoin(itemPedido, eq(itemPedido.id, cotacao.itemPedidoId))
    .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
    .innerJoin(fornecedor, eq(fornecedor.id, cotacao.fornecedorId))
    .where(
      and(
        inArray(pedido.compradorId, compradores),
        inArray(itemPedido.estado, ["cotando", "comparando", "aguardando_decisao", "aprovado", "pedido_enviado"]),
        isNotNull(cotacao.contatoId),
        isNotNull(cotacao.enviadaEm),
        notInArray(cotacao.situacao, ["parou", "desistiu"]),
        gte(itemPedido.atualizadoEm, desde(7 * 24 * 3600_000)),
      ),
    );
  const vistos = new Set<string>();
  const out: Candidato[] = [];
  for (const l of linhas) {
    if (["aprovado", "pedido_enviado"].includes(l.item.estado) && l.item.fornecedorEscolhidoId !== l.fornecedorId) continue;
    const chave = `${l.item.id}:${l.fornecedorId}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ itemPedidoId: l.item.id, pedidoId: l.pedidoId, descricao: l.item.descricao, quantidade: l.item.quantidade, unidade: l.item.unidade, estado: l.item.estado, fornecedorId: l.fornecedorId, fornecedor: l.nome, atualizadoEm: l.item.atualizadoEm });
  }
  return out;
}

/** O que o sistema sabe da proposta deste fornecedor (a mais recente), para a tentativa e para a regra de sigilo. */
async function propostaDo(itemPedidoId: number, fornecedorId: string) {
  const [o] = await db
    .select()
    .from(oferta)
    .where(and(eq(oferta.itemPedidoId, itemPedidoId), eq(oferta.fornecedorId, fornecedorId)))
    .orderBy(desc(oferta.rodada), desc(oferta.criadoEm))
    .limit(1);
  return o ?? null;
}

const valoresDaProposta = (o: typeof oferta.$inferSelect | null) =>
  o ? [o.precoUnitario, o.totalProduto, o.frete, o.impostosValor].filter((v): v is string => v !== null).map(Number) : [];

/** A tentativa do lado do comprador: o que já se sabe da proposta dele, em texto montado em código. */
export function textoTentativa(
  alvo: Pick<Candidato, "fornecedor" | "itemPedidoId" | "quantidade" | "unidade" | "descricao">,
  o: Pick<typeof oferta.$inferSelect, "precoUnitario" | "totalProduto" | "frete" | "prazoDias" | "pagamento" | "validadeDias"> | null,
  prazoRespostasEm: Date | null,
): string {
  const cab = `Sobre ${alvo.fornecedor} na cotação ${alvo.itemPedidoId} (${quantidadeDe(alvo.quantidade, alvo.unidade, alvo.descricao)}):`;
  const linhas = [cab];
  if (o && (o.precoUnitario !== null || o.totalProduto !== null)) {
    const partes = [
      o.precoUnitario !== null ? `${formatarBRL(Number(o.precoUnitario))} por ${alvo.unidade}` : null,
      o.totalProduto !== null ? `total ${formatarBRL(Number(o.totalProduto))}` : null,
      o.frete !== null ? (Number(o.frete) > 0 ? `frete ${formatarBRL(Number(o.frete))}` : "frete grátis") : "frete não informado",
      o.prazoDias !== null ? `entrega em ${o.prazoDias} ${o.prazoDias === 1 ? "dia" : "dias"}` : "prazo de entrega não informado",
      o.pagamento ? `pagamento: ${o.pagamento}` : null,
      o.validadeDias !== null ? `validade de ${o.validadeDias} dias` : null,
    ].filter(Boolean);
    linhas.push(`- Proposta: ${partes.join("; ")}.`);
  } else {
    linhas.push(`- Ainda não mandou proposta${prazoRespostasEm ? `; o prazo de respostas vai ${quando(prazoRespostasEm)}` : ""}.`);
  }
  linhas.push("", `Se isso não resolve e precisa falar com ${alvo.fornecedor}, me diga de novo que quer falar com o fornecedor: eu peço a sua mensagem, repasso e trago a resposta.`);
  return linhas.join("\n");
}

const opcoesDe = (a: { pedidoId?: number; itemPedidoId?: number }) => ({ pedidoId: a.pedidoId, itemPedidoId: a.itemPedidoId });

async function tentarComComprador(compradorId: string, alvo: Candidato) {
  const [it] = await db.select({ prazo: itemPedido.prazoRespostasEm }).from(itemPedido).where(eq(itemPedido.id, alvo.itemPedidoId));
  await enviar(compradorId, textoTentativa(alvo, await propostaDo(alvo.itemPedidoId, alvo.fornecedorId), it?.prazo ?? null), { ...opcoesDe(alvo), tipo: "aviso" });
  await gravar(
    { transbordo: "comprador", compradorId, etapa: "tentou", itemPedidoId: alvo.itemPedidoId, pedidoId: alvo.pedidoId, fornecedorId: alvo.fornecedorId, fornecedor: alvo.fornecedor, descricao: alvo.descricao },
    { acao: `O comprador pediu para falar com ${alvo.fornecedor}; respondeu com o que já sabia.`, motivo: "Transbordo inteligente: primeiro tenta resolver.", ...opcoesDe(alvo), fornecedorIds: [alvo.fornecedorId] },
  );
}

async function pedirRecado(compradorId: string, alvo: Pick<Candidato, "itemPedidoId" | "pedidoId" | "fornecedorId" | "fornecedor" | "descricao">) {
  await enviar(compradorId, `Certo. Me mande a mensagem para ${alvo.fornecedor} (cotação ${alvo.itemPedidoId}), que eu repasso e trago a resposta aqui.`, { ...opcoesDe(alvo), tipo: "aviso" });
  await gravar(
    { transbordo: "comprador", compradorId, etapa: "aguardando_mensagem", itemPedidoId: alvo.itemPedidoId, pedidoId: alvo.pedidoId, fornecedorId: alvo.fornecedorId, fornecedor: alvo.fornecedor, descricao: alvo.descricao },
    { acao: `Pediu ao comprador a mensagem para ${alvo.fornecedor}.`, motivo: "O comprador insistiu em falar com o fornecedor.", ...opcoesDe(alvo), fornecedorIds: [alvo.fornecedorId] },
  );
}

/**
 * Mensagem do comprador: recado em escrita, pedido de falar com o fornecedor, ou insistência depois
 * da tentativa. `insistiu`: o Assistente já tentou resolver e o comprador insistiu. Devolve true
 * quando tratou a mensagem.
 */
export async function aoTransbordoDoComprador(compradorId: string, texto: string, o: { insistiu?: boolean } = {}): Promise<boolean> {
  const est = await estadoDoComprador(compradorId);
  if (est?.dados.etapa === "aguardando_mensagem") {
    await receberRecado(compradorId, texto, est.dados);
    return true;
  }
  const insistindo = !!o.insistiu || (est?.dados.etapa === "tentou" && insiste(texto));
  if (!insistindo && !pedeFalarComFornecedor(texto)) return false;
  // Já tentou com este fornecedor e o comprador insiste: pede a mensagem, sem perguntar de novo com quem.
  const anterior = est?.dados.etapa === "tentou" && est.dados.itemPedidoId && est.dados.fornecedorId ? est.dados : null;
  const candidatos = await candidatosDoComprador(compradorId);
  const doTexto = escolherAlvo(texto, candidatos);
  const alvo =
    anterior && (doTexto.tipo !== "um" || doTexto.alvo.fornecedorId === anterior.fornecedorId)
      ? (candidatos.find((c) => c.itemPedidoId === anterior.itemPedidoId && c.fornecedorId === anterior.fornecedorId) ?? null)
      : doTexto.tipo === "um"
        ? doTexto.alvo
        : null;
  if (alvo) {
    const jaTentou = anterior?.fornecedorId === alvo.fornecedorId && anterior.itemPedidoId === alvo.itemPedidoId;
    if (insistindo || jaTentou) await pedirRecado(compradorId, alvo);
    else await tentarComComprador(compradorId, alvo);
    return true;
  }
  if (doTexto.tipo === "varios") {
    const botoes: Botao[] = doTexto.opcoes.map((c) => ({ rotulo: `${c.fornecedor} · cotação ${c.itemPedidoId}`.slice(0, 40), dado: `tb:${c.itemPedidoId}:${c.fornecedorId}` }));
    await enviar(compradorId, "Com qual fornecedor quer falar?", { botoes, tipo: "aviso" });
    await gravar({ transbordo: "comprador", compradorId, etapa: "escolher", insistiu: insistindo }, { acao: "Perguntou ao comprador com qual fornecedor quer falar.", motivo: `${doTexto.opcoes.length} fornecedores nas cotações em andamento.` });
    return true;
  }
  await enviar(compradorId, "Não achei cotação em andamento com fornecedor para eu repassar uma mensagem. Se for sobre uma cotação específica, diga o número dela.", { tipo: "aviso" });
  return true;
}

/** Botão "tb:<item>:<fornecedor>" da pergunta "com qual fornecedor?". */
export async function aoBotaoDoTransbordo(compradorId: string, dado: string): Promise<boolean> {
  const b = /^tb:(\d+):([0-9a-f-]{36})$/.exec(dado);
  if (!b) return false;
  const alvo = (await candidatosDoComprador(compradorId)).find((c) => c.itemPedidoId === Number(b[1]) && c.fornecedorId === b[2]);
  if (!alvo) {
    await enviar(compradorId, "Essa cotação não está mais em andamento com esse fornecedor.", { tipo: "aviso" });
    return true;
  }
  const est = await estadoDoComprador(compradorId);
  if (est?.dados.etapa === "escolher" && est.dados.insistiu) await pedirRecado(compradorId, alvo);
  else await tentarComComprador(compradorId, alvo);
  return true;
}

/** Texto que vai ao fornecedor com o recado (o recado do comprador vai entre aspas, como ele escreveu). */
export const textoRecado = (itemPedidoId: number, descricao: string | undefined, recado: string) =>
  `Recado do comprador sobre a cotação ${itemPedidoId}${descricao ? ` (${descricao})` : ""}: "${recado.trim()}"\nPode responder por aqui, que eu repasso.`;

async function receberRecado(compradorId: string, texto: string, est: EstadoComprador) {
  const ctx = opcoesDe(est);
  if (!est.itemPedidoId || !est.fornecedorId) return;
  // Sigilo: nada de valor ou menção de outro fornecedor. O estado continua: a próxima mensagem é o recado.
  const sigilo = conferirRecado(texto, valoresDaProposta(await propostaDo(est.itemPedidoId, est.fornecedorId)));
  if (!sigilo.ok) {
    await enviar(compradorId, `Não repassei: o recado tinha ${sigilo.motivos.join("; ")}. Proposta de fornecedor é sigilosa e não vai a outro. Pode escrever de novo sem isso?`, { ...ctx, tipo: "aviso" });
    await registrar(db, { agente: "Cotador", acao: `Não repassou o recado do comprador a ${est.fornecedor}.`, motivo: `Sigilo das propostas: ${sigilo.motivos.join("; ")}.`, ...ctx, fornecedorIds: [est.fornecedorId] });
    return;
  }
  const corpo = textoRecado(est.itemPedidoId, est.descricao, texto);
  // S: conferência de saída (dado pessoal, "sem nota", "por fora", link suspeito); barrado, avisa e espera outro texto.
  const liberada = await liberarSaida(corpo, {
    compradorId,
    ...ctx,
    oQue: "o recado do comprador",
    avisoComprador: (motivos) => `Não repassei o recado a ${est.fornecedor}: ele tinha ${motivos}. Só cotamos com nota fiscal, sem dado pessoal e sem pagamento por fora. Pode escrever de novo?`,
  });
  if (!liberada) return;
  const ct = await contatoAtivoDoFornecedor(est.fornecedorId);
  if (!ct) {
    await enviar(compradorId, `Não consigo mais falar com ${est.fornecedor} por aqui (ele saiu das mensagens).`, { ...ctx, tipo: "aviso" });
    await gravar({ ...est, etapa: "nao_entregue", recado: texto.slice(0, 1000) }, { acao: `Não entregou o recado a ${est.fornecedor}.`, motivo: "Fornecedor sem contato ativo.", ...ctx, fornecedorIds: [est.fornecedorId] });
    return;
  }
  // O recado entra no estado antes do envio: com outra pergunta pendente, a cadência o manda depois.
  const fila = await gravar({ ...est, etapa: "na_fila", recado: texto.slice(0, 1000) }, { acao: `Recebeu o recado do comprador para ${est.fornecedor}.`, motivo: "Vai pela cadência: uma pergunta por vez ao fornecedor.", ...ctx, fornecedorIds: [est.fornecedorId] });
  const r = await pedirAoFornecedor(ct.id, perguntaDoRecado(fila.id, { ...est, recado: texto }));
  if (r.enviada) await enviar(compradorId, `Repassei a ${est.fornecedor}. Trago a resposta aqui assim que ele responder.`, { ...ctx, tipo: "aviso" });
  else if (r.pendente) await enviar(compradorId, `${est.fornecedor} ainda tem uma pergunta nossa em aberto. Mando o seu recado assim que ele responder, e trago a resposta aqui.`, { ...ctx, tipo: "aviso" });
}

/** A pergunta do recado na cadência. A reserva grava "repassada" uma vez só, sob lock. */
function perguntaDoRecado(recadoDe: string, est: EstadoComprador): Pergunta {
  const ctx = opcoesDe(est);
  return {
    tipo: "cotacao", // a cadência não tem tipo próprio de recado: vai sozinho, com a prioridade de uma mensagem da cotação
    itemPedidoId: est.itemPedidoId ?? null,
    texto: textoRecado(est.itemPedidoId!, est.descricao, est.recado ?? ""),
    opcoes: { ...ctx, tipo: "resposta" },
    reservar: () =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`recado:${recadoDe}`}))`);
        const [ja] = await tx.select({ id: evento.id }).from(evento).where(and(eq(evento.agente, "Cotador"), sql`${evento.dados}->>'recadoDe' = ${recadoDe}`)).limit(1);
        if (ja) return false;
        await registrar(tx, {
          agente: "Cotador",
          acao: `Repassou o recado do comprador a ${est.fornecedor}.`,
          motivo: "Transbordo: o comprador insistiu e mandou a mensagem; a resposta volta a ele.",
          ...ctx,
          fornecedorIds: est.fornecedorId ? [est.fornecedorId] : [],
          dados: { ...est, etapa: "repassada", recadoDe } satisfies EstadoComprador,
        });
        return true;
      }),
    marcar: async (r: ResultadoEnvio) => {
      if (r.situacao === "enviada") return;
      await gravar({ ...est, etapa: "nao_entregue", recadoDe }, { acao: `Não entregou o recado a ${est.fornecedor}.`, motivo: r.erro ?? r.situacao, ...ctx, fornecedorIds: est.fornecedorId ? [est.fornecedorId] : [] });
      await enviar(est.compradorId, `Não consegui entregar o seu recado a ${est.fornecedor}.`, { ...ctx, tipo: "aviso" });
    },
  };
}

/** Fonte da cadência: recado na fila para este fornecedor. */
async function perguntasDeRecado(_contatoId: string, fornecedorId: string): Promise<Pergunta[]> {
  const r = await recadoAoFornecedor(fornecedorId);
  if (!r || r.dados.etapa !== "na_fila") return [];
  return [perguntaDoRecado(r.id, r.dados)];
}

/** Rede de segurança do varredor: fornecedores com recado na fila. */
async function contatosComRecado(): Promise<string[]> {
  const linhas = await db
    .select({ dados: evento.dados })
    .from(evento)
    .where(and(eq(evento.agente, "Cotador"), gte(evento.criadoEm, desde(VALIDADE_RECADO_MS)), sql`${evento.dados}->>'transbordo' = 'comprador'`, sql`${evento.dados}->>'etapa' = 'na_fila'`));
  const out: string[] = [];
  for (const f of new Set(linhas.map((l) => (l.dados as EstadoComprador).fornecedorId).filter((x): x is string => !!x))) {
    const ultimoRecado = await recadoAoFornecedor(f);
    if (ultimoRecado?.dados.etapa !== "na_fila") continue;
    const ct = await contatoAtivoDoFornecedor(f);
    if (ct) out.push(ct.id);
  }
  return out;
}

let ligado = false;
/** Liga o recado do comprador à cadência (chamado por ligarComprador). */
export function ligarTransbordo() {
  if (ligado) return;
  ligado = true;
  aoProcurarPerguntas(perguntasDeRecado);
  aoVarrerFila(contatosComRecado);
}

// ---------- Fornecedor → comprador ----------

type Linha = { item: typeof itemPedido.$inferSelect; pedido: typeof pedido.$inferSelect };

export const TEXTO_TENTATIVA_FORNECEDOR = `Sou o assistente automatizado de compras da ${EMPRESA.nome} e resolvo por aqui a maior parte: dúvidas sobre o item, a quantidade, a entrega, o prazo e o pagamento. Qual é o assunto? Se precisar mesmo falar com o comprador, é só dizer, que eu peço a sua mensagem e repasso.`;
export const TEXTO_PEDIR_MENSAGEM_FORNECEDOR = "Certo. Me mande a mensagem para o comprador, que eu repasso e trago a resposta por aqui.";

/**
 * O fornecedor pediu para falar com uma pessoa (classificação "responsavel" do Extrator).
 * 1ª vez: tenta resolver (com assunto, o responderDuvida do Cotador, que responde com os dados do
 * pedido ou leva a dúvida ao comprador; sem assunto, pergunta qual é). Se insistir: pede a mensagem.
 */
export async function aoFornecedorPedirPessoa(c: typeof cotacao.$inferSelect, contatoId: string, texto: string, l: Linha) {
  const ctx = { pedidoId: l.pedido.id, itemPedidoId: l.item.id };
  const est = await estadoDoFornecedor(c.fornecedorId);
  const base: Omit<EstadoFornecedor, "etapa"> = { transbordo: "fornecedor", fornecedorId: c.fornecedorId, contatoId, cotacaoId: c.id };
  if (est && est.dados.cotacaoId === c.id && est.dados.etapa === "tentou") {
    await enviar(contatoId, TEXTO_PEDIR_MENSAGEM_FORNECEDOR, { ...ctx, tipo: "resposta" });
    await gravar({ ...base, etapa: "aguardando_mensagem" }, { acao: "Pediu ao fornecedor a mensagem para o comprador.", motivo: "O fornecedor insistiu em falar com uma pessoa.", ...ctx, fornecedorIds: [c.fornecedorId] });
    return;
  }
  if (temAssunto(texto)) await responderDuvida(c.id, contatoId, texto, texto);
  else await enviar(contatoId, TEXTO_TENTATIVA_FORNECEDOR, { ...ctx, tipo: "resposta" });
  await gravar(
    { ...base, etapa: "tentou" },
    { acao: "Fornecedor pediu uma pessoa; o assistente tentou resolver antes.", motivo: temAssunto(texto) ? "Respondeu com os dados do pedido (ou levou a dúvida ao comprador)." : "Perguntou qual é o assunto.", ...ctx, fornecedorIds: [c.fornecedorId] },
  );
}

/**
 * Mensagem do fornecedor que é recado ao comprador (depois de "me mande a mensagem") ou resposta a
 * um recado do comprador. Devolve "tratada" (não segue), "seguir" (repassou, mas a mensagem tem
 * preço e segue também para a leitura da proposta) ou null (não é do transbordo).
 */
export async function aoMensagemDoFornecedorNoTransbordo(fornecedorId: string, contatoId: string, texto: string): Promise<"tratada" | "seguir" | null> {
  if (!texto.trim()) return null;
  const proposta = pareceProposta(texto);
  const est = await estadoDoFornecedor(fornecedorId);
  if (est?.dados.etapa === "aguardando_mensagem") {
    const [l] = await db
      .select({ item: itemPedido, pedido, nome: fornecedor.nome })
      .from(cotacao)
      .innerJoin(itemPedido, eq(itemPedido.id, cotacao.itemPedidoId))
      .innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId))
      .innerJoin(fornecedor, eq(fornecedor.id, cotacao.fornecedorId))
      .where(eq(cotacao.id, est.dados.cotacaoId));
    if (l) {
      const ctx = { pedidoId: l.pedido.id, itemPedidoId: l.item.id };
      // Mesmo mecanismo da dúvida do fornecedor: a próxima mensagem do comprador volta a ele.
      await db
        .update(itemPedido)
        .set({ duvidaPendente: { cotacaoId: est.dados.cotacaoId, fornecedorId, contatoId, fornecedor: l.nome, pergunta: texto.slice(0, 500), em: new Date().toISOString() } })
        .where(eq(itemPedido.id, l.item.id));
      await enviar(l.pedido.compradorId, `Pedido ${l.pedido.id}: ${l.nome} mandou um recado para você sobre a cotação ${l.item.id}: "${texto.slice(0, 500)}". Responda aqui que eu repasso a ele.`, { ...ctx, tipo: "aviso" });
      if (!proposta) await enviar(contatoId, "Repassei ao comprador. Trago a resposta por aqui assim que ele responder.", { ...ctx, tipo: "resposta" });
      await gravar({ ...est.dados, etapa: "repassada" }, { acao: `Repassou o recado de ${l.nome} ao comprador.`, motivo: "Transbordo: o fornecedor insistiu e mandou a mensagem; a resposta do comprador volta a ele.", ...ctx, fornecedorIds: [fornecedorId] });
      return proposta ? "seguir" : "tratada";
    }
  }
  const r = await recadoAoFornecedor(fornecedorId);
  if (r?.dados.etapa === "repassada" && r.dados.compradorId) {
    const ctx = opcoesDe(r.dados);
    await enviar(r.dados.compradorId, `${r.dados.pedidoId ? `Pedido ${r.dados.pedidoId}: ` : ""}resposta de ${r.dados.fornecedor} ao seu recado (cotação ${r.dados.itemPedidoId}): "${texto.slice(0, 1000)}"`, { ...ctx, tipo: "aviso" });
    if (!proposta) await enviar(contatoId, "Obrigado! Repassei ao comprador.", { ...ctx, tipo: "resposta" });
    await gravar({ ...r.dados, etapa: "respondida" }, { acao: `Levou ao comprador a resposta de ${r.dados.fornecedor} ao recado.`, motivo: "Transbordo: resposta do fornecedor volta a quem mandou o recado.", ...ctx, fornecedorIds: [fornecedorId] });
    return proposta ? "seguir" : "tratada";
  }
  return null;
}
