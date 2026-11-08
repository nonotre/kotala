// U3: cadência, uma pergunta por vez ao fornecedor. A fila é calculada do estado
// (cotacao, oferta, item, mensagem, evento), sem tabela nova e sem perder nada num
// reinício: "pergunta pendente" é uma pergunta aberta enviada depois da última
// mensagem que o contato mandou. A pendência vence em 25% do prazo de respostas,
// para um fornecedor mudo não travar a fila.
//
// Passam direto, sem esta fila: encerramento e cancelamento, "não venceu", respostas
// (dúvida, recebimento da proposta, que já leva o pedido de desconto), lembrete da
// mesma cotação e pedido de compra. Entram na fila: rodada de negociação do botão,
// confirmação de preço retido (R8, confirmar-preco.ts), pergunta de categoria (U5) e
// qualquer pergunta nova.

import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { prazoRespostasMs } from "../../config.ts";
import { db } from "../../nucleo/db/cliente.ts";
import { contato, cotacao, evento, fornecedor, itemPedido, mensagem, oferta } from "../../nucleo/db/schema.ts";
import { enviar, type OpcoesEnvio, type ResultadoEnvio } from "../../nucleo/mensagens/index.ts";
import { registrar } from "../../nucleo/registro.ts";
import { categoriasDoCadastro } from "../../dominio/categorias.ts";
import { marcaDe } from "../negociador/index.ts";

export type TipoPergunta = "cotacao" | "negociacao" | "desconto" | "completar" | "confirmar_preco" | "pedido_compra" | "categoria";
export type PerguntaAberta = { tipo: TipoPergunta; desde: Date };

import { ESPERA_PERGUNTA_FRACAO } from "../../config.ts";
export { ESPERA_PERGUNTA_FRACAO };
export const esperaMaxMs = () => prazoRespostasMs() * ESPERA_PERGUNTA_FRACAO;
/** Até 3 perguntas numa mensagem; o resto espera a próxima resposta. */
export const MAX_PERGUNTAS_JUNTAS = 3;
/** U5: só pergunta a categoria de quem respondeu a uma cotação nestes dias (não acorda fornecedor antigo). */
const DIAS_CATEGORIA = 2;
/** U5: etapa do cadastro enquanto a pergunta de categoria está aberta (o texto do fornecedor segue o fluxo da cotação). */
export const ETAPA_CATEGORIA_COTACAO = "categoria_cotacao";

/** Marca da cobrança do que falta, em `oferta.extraido.pergunta`. */
export type MarcaPergunta = { tipo: "completar"; em: string };
export const perguntaDe = (extraido: unknown): MarcaPergunta | null => {
  const p = (extraido as { pergunta?: MarcaPergunta } | null)?.pergunta;
  return p && typeof p.em === "string" ? p : null;
};

/** A pergunta aberta mais recente que o contato ainda não respondeu, ou null. Função pura. */
export function pendenteEntre(abertas: readonly PerguntaAberta[], ultimaEntrada: Date | null, agora: Date, esperaMax: number): PerguntaAberta | null {
  const vivas = abertas.filter((a) => (!ultimaEntrada || a.desde.getTime() > ultimaEntrada.getTime()) && agora.getTime() - a.desde.getTime() < esperaMax);
  return vivas.sort((a, b) => b.desde.getTime() - a.desde.getTime())[0] ?? null;
}

const data = (v: Date | string | null | undefined) => (v ? new Date(v) : null);

/** Perguntas abertas ao contato, tiradas do estado. */
async function perguntasAbertas(contatoId: string, fornecedorId: string | null, agora: Date): Promise<PerguntaAberta[]> {
  const out: PerguntaAberta[] = [];
  const cotacoes = await db
    .select({ enviadaEm: cotacao.enviadaEm, rodada: cotacao.rodada })
    .from(cotacao)
    .innerJoin(itemPedido, and(eq(itemPedido.id, cotacao.itemPedidoId), eq(itemPedido.rodada, cotacao.rodada)))
    .where(and(eq(cotacao.contatoId, contatoId), eq(cotacao.situacao, "aguardando"), isNotNull(cotacao.enviadaEm), eq(itemPedido.estado, "cotando")));
  for (const c of cotacoes) out.push({ tipo: c.rodada > 1 ? "negociacao" : "cotacao", desde: c.enviadaEm! });
  if (!fornecedorId) return out;

  const ofertas = await db
    .select({ extraido: oferta.extraido, confirmacaoPedidaEm: oferta.confirmacaoPedidaEm, precoConfirmado: oferta.precoConfirmado, estado: itemPedido.estado })
    .from(oferta)
    .innerJoin(itemPedido, eq(itemPedido.id, oferta.itemPedidoId))
    .where(and(eq(oferta.fornecedorId, fornecedorId), inArray(itemPedido.estado, ["cotando", "aguardando_decisao"])));
  for (const o of ofertas) {
    const m = marcaDe(o.extraido);
    if (o.estado === "cotando" && m && !m.respondidaEm && new Date(m.janelaAte) > agora) out.push({ tipo: "desconto", desde: new Date(m.pedidaEm) });
    const p = perguntaDe(o.extraido);
    if (o.estado === "cotando" && p) out.push({ tipo: "completar", desde: new Date(p.em) });
    if (o.estado === "aguardando_decisao" && o.confirmacaoPedidaEm && !o.precoConfirmado) out.push({ tipo: "confirmar_preco", desde: o.confirmacaoPedidaEm });
  }

  const compras = await db
    .select({ em: itemPedido.atualizadoEm })
    .from(itemPedido)
    .where(and(eq(itemPedido.estado, "pedido_enviado"), eq(itemPedido.fornecedorEscolhidoId, fornecedorId)));
  for (const c of compras) out.push({ tipo: "pedido_compra", desde: c.em });

  const [f] = await db.select({ categorias: fornecedor.categorias }).from(fornecedor).where(eq(fornecedor.id, fornecedorId));
  if (f && !f.categorias.length) {
    const quando = await categoriaPerguntadaEm(fornecedorId);
    if (quando) out.push({ tipo: "categoria", desde: quando });
  }
  return out;
}

async function categoriaPerguntadaEm(fornecedorId: string): Promise<Date | null> {
  const [e] = await db
    .select({ em: evento.criadoEm })
    .from(evento)
    .where(and(eq(evento.agente, "Fornecedor"), sql`${evento.dados}->>'perguntaCategoria' = ${fornecedorId}`))
    .orderBy(desc(evento.criadoEm))
    .limit(1);
  return e?.em ?? null;
}

/** Pergunta que o contato ainda deve responder (a mais recente), ou null. */
export async function perguntaPendente(contatoId: string, agora = new Date()): Promise<PerguntaAberta | null> {
  const [ct] = await db.select({ fornecedorId: contato.fornecedorId }).from(contato).where(eq(contato.id, contatoId));
  const [ent] = await db
    .select({ em: sql<Date | string | null>`max(${mensagem.criadoEm})` })
    .from(mensagem)
    .where(and(eq(mensagem.contatoId, contatoId), eq(mensagem.direcao, "entrada"), eq(mensagem.situacao, "recebida")));
  const abertas = await perguntasAbertas(contatoId, ct?.fornecedorId ?? null, agora);
  return pendenteEntre(abertas, data(ent?.em), agora, esperaMaxMs());
}

// ---------- Perguntas prontas e envio ----------

export type Pergunta = {
  tipo: TipoPergunta;
  itemPedidoId: number | null;
  /** Mensagem inteira, quando vai sozinha. */
  texto: string;
  /** Versão de uma linha, para juntar com outras do mesmo item; sem ela, vai sempre sozinha. */
  linha?: string;
  /** Cabeçalho da mensagem juntada ("Sobre a cotação 12 (50 sacos de cimento):"). */
  cabecalho?: string;
  opcoes?: OpcoesEnvio;
  /** Reserva a pergunta antes de enviar (evita mandar duas vezes). false desiste. */
  reservar?: () => Promise<boolean>;
  /** Grava a marca depois do envio (enviadaEm, pedidaEm...). */
  marcar?: (r: ResultadoEnvio) => Promise<void>;
};

/** Ordem de prioridade ao juntar: completar > confirmar preço > desconto > negociação > categoria. */
const PRIORIDADE: Record<TipoPergunta, number> = { completar: 0, confirmar_preco: 1, desconto: 2, negociacao: 3, cotacao: 4, pedido_compra: 5, categoria: 9 };

type Fonte = (contatoId: string, fornecedorId: string, agora: Date) => Promise<Pergunta[]>;
const fontes: Fonte[] = [];
/** Quem tem perguntas guardadas no estado (ex.: rodada do botão no Cotador) se registra aqui. */
export function aoProcurarPerguntas(fn: Fonte) {
  fontes.push(fn);
}

/** Junta perguntas do mesmo item numa lista numerada (no máximo 3). O validador de R$ roda depois, na mensagem final. */
export function juntarPerguntas(cabecalho: string, linhas: readonly string[]): string {
  return [cabecalho, ...linhas.slice(0, MAX_PERGUNTAS_JUNTAS).map((l, i) => `${i + 1}. ${l}`), "Responda por aqui, do seu jeito."].join("\n");
}

/** Ordena as prontas e escolhe o que sai agora: as do primeiro item (juntáveis) ou uma sozinha. Função pura. */
export function escolherEnvio(prontas: readonly Pergunta[]): Pergunta[] {
  if (!prontas.length) return [];
  const ordenadas = [...prontas].sort((a, b) => PRIORIDADE[a.tipo] - PRIORIDADE[b.tipo] || (a.itemPedidoId ?? Infinity) - (b.itemPedidoId ?? Infinity));
  // Item diferente não se junta; categoria (sem item) vai só quando não há pergunta de item.
  const comItem = ordenadas.filter((p) => p.itemPedidoId !== null);
  if (!comItem.length) return [ordenadas[0]!];
  const primeiroItem = [...comItem].sort((a, b) => a.itemPedidoId! - b.itemPedidoId!)[0]!.itemPedidoId;
  const doItem = comItem.filter((p) => p.itemPedidoId === primeiroItem);
  const juntaveis = doItem.filter((p) => p.linha);
  return juntaveis.length > 1 ? juntaveis.slice(0, MAX_PERGUNTAS_JUNTAS) : [doItem[0]!];
}

/** Envia uma pergunta respeitando a cadência. Com pergunta pendente, não envia nem marca: fica pronta no estado. */
export async function pedirAoFornecedor(contatoId: string, p: Pergunta, agora = new Date()): Promise<{ enviada: boolean; pendente: PerguntaAberta | null; resultado?: ResultadoEnvio }> {
  const pendente = await perguntaPendente(contatoId, agora);
  if (pendente) return { enviada: false, pendente };
  return enviarPerguntas(contatoId, [p]);
}

async function enviarPerguntas(contatoId: string, ps: Pergunta[]): Promise<{ enviada: boolean; pendente: null; resultado?: ResultadoEnvio }> {
  const reservadas: Pergunta[] = [];
  for (const p of ps) if (!p.reservar || (await p.reservar())) reservadas.push(p);
  if (!reservadas.length) return { enviada: false, pendente: null };
  const [primeira] = reservadas;
  const texto = reservadas.length > 1 ? juntarPerguntas(primeira!.cabecalho ?? "Sobre a cotação:", reservadas.map((p) => p.linha!)) : primeira!.texto;
  const r = await enviar(contatoId, texto, { ...primeira!.opcoes, itemPedidoId: primeira!.itemPedidoId ?? primeira!.opcoes?.itemPedidoId });
  for (const p of reservadas) await p.marcar?.(r);
  return { enviada: r.situacao === "enviada", pendente: null, resultado: r };
}

/**
 * Libera a fila do contato: sem pergunta pendente, manda o que estiver pronto no estado.
 * Chamado no fim de cada resposta do fornecedor e pelo varredor (rede de segurança).
 */
export async function despacharPerguntas(contatoId: string, agora = new Date()): Promise<boolean> {
  const [ct] = await db.select({ fornecedorId: contato.fornecedorId }).from(contato).where(eq(contato.id, contatoId));
  if (!ct?.fornecedorId) return false;
  if (await perguntaPendente(contatoId, agora)) return false;
  const prontas = (await Promise.all([...fontes, perguntaDeCategoria].map((f) => f(contatoId, ct.fornecedorId!, agora)))).flat();
  const escolhidas = escolherEnvio(prontas);
  if (!escolhidas.length) return false;
  return (await enviarPerguntas(contatoId, escolhidas)).enviada;
}

// ---------- U5: categoria do fornecedor no primeiro contato ----------

export const TEXTO_CATEGORIA =
  "Uma pergunta rápida, para eu mandar só os pedidos certos: o que vocês vendem? Toque nas categorias (pode marcar várias) e depois em Pronto.";

/** Mesmos botões do cadastro (src/fluxo/fornecedor.ts: cad:cat:<i> e cad:pronto). */
export function botoesCategoria() {
  const cats = categoriasDoCadastro().map((c) => c.nome);
  return [...cats.map((c, i) => ({ rotulo: c, dado: `cad:cat:${i}` })), { rotulo: "Pronto", dado: "cad:pronto" }];
}

/**
 * Fornecedor real sem categorias, que já respondeu a uma cotação (para não atrasar a
 * proposta) e nunca foi perguntado: pergunta uma vez, com os botões do cadastro.
 */
async function perguntaDeCategoria(contatoId: string, fornecedorId: string, agora: Date): Promise<Pergunta[]> {
  const [f] = await db.select().from(fornecedor).where(eq(fornecedor.id, fornecedorId));
  if (!f || f.origem !== "real" || f.categorias.length || f.cadastroEtapa || f.parouEm) return [];
  const [respondeu] = await db
    .select({ id: cotacao.id })
    .from(cotacao)
    .where(and(eq(cotacao.fornecedorId, fornecedorId), isNotNull(cotacao.respondeuEm), gte(cotacao.respondeuEm, new Date(agora.getTime() - DIAS_CATEGORIA * 24 * 3600_000))))
    .limit(1);
  if (!respondeu || (await categoriaPerguntadaEm(fornecedorId))) return [];
  return [
    {
      tipo: "categoria",
      itemPedidoId: null,
      texto: TEXTO_CATEGORIA,
      opcoes: { botoes: botoesCategoria() },
      reservar: async () =>
        (
          await db
            .update(fornecedor)
            .set({ cadastroEtapa: ETAPA_CATEGORIA_COTACAO })
            .where(and(eq(fornecedor.id, fornecedorId), isNull(fornecedor.cadastroEtapa)))
            .returning({ id: fornecedor.id })
        ).length > 0,
      marcar: async (r) => {
        if (r.situacao !== "enviada") await db.update(fornecedor).set({ cadastroEtapa: null }).where(eq(fornecedor.id, fornecedorId));
        // Uma vez só: o evento é a marca, mesmo se o envio falhou.
        await registrar(db, {
          agente: "Fornecedor",
          acao: r.situacao === "enviada" ? `Perguntou o que ${f.nome} vende.` : `Não conseguiu perguntar o que ${f.nome} vende.`,
          motivo: "Fornecedor sem categorias, depois da primeira resposta a uma cotação.",
          fornecedorIds: [fornecedorId],
          dados: { perguntaCategoria: fornecedorId, contatoId, enviada: r.situacao === "enviada" },
        });
      },
    },
  ];
}

/** Contatos que podem ter pergunta de categoria pronta (fornecedor real sem categorias que respondeu há pouco). */
async function contatosComCategoriaPronta(agora: Date): Promise<string[]> {
  const linhas = await db
    .selectDistinct({ contatoId: cotacao.contatoId })
    .from(cotacao)
    .innerJoin(fornecedor, eq(fornecedor.id, cotacao.fornecedorId))
    .where(
      and(
        isNotNull(cotacao.contatoId),
        gte(cotacao.respondeuEm, new Date(agora.getTime() - DIAS_CATEGORIA * 24 * 3600_000)),
        eq(fornecedor.origem, "real"),
        sql`${fornecedor.categorias} = '[]'::jsonb`,
        isNull(fornecedor.cadastroEtapa),
        isNull(fornecedor.parouEm),
        sql`not exists (select 1 from ${evento} where ${evento.agente} = 'Fornecedor' and ${evento.dados}->>'perguntaCategoria' = ${fornecedor.id}::text)`,
      ),
    );
  return linhas.map((l) => l.contatoId!).filter(Boolean);
}

type Candidatos = (agora: Date) => Promise<string[]>;
const candidatos: Candidatos[] = [contatosComCategoriaPronta];
/** Quem registra uma fonte de perguntas também diz quais contatos o varredor deve olhar. */
export function aoVarrerFila(fn: Candidatos) {
  candidatos.push(fn);
}

/** Tarefa do varredor: libera a fila de quem tem pergunta pronta e nenhuma pendente (reinício, pendência vencida). */
export async function liberarFila(agora: Date) {
  const contatos = new Set((await Promise.all(candidatos.map((c) => c(agora)))).flat());
  for (const id of contatos) await despacharPerguntas(id, agora);
}
