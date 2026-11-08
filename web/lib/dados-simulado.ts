// Leitura do Telegram simulado do fornecedor. Só leitura, como lib/dados.ts.
//
// O chat de um fornecedor simulado é a conversa que já está no banco: as mensagens
// do contato dele no canal "simulado" (endereço = chave da persona). Ninguém
// precisa abrir a tela para o chat existir.
//
// Quem responde: sem evento, a persona automática. O último evento com
// `dados.tipo = "sim_assumido"` do contato diz se o usuário assumiu o chat
// (`dados.assumido`), gravado pelo simulador quando alguém escreve por aqui.

import { cache } from "react";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../src/nucleo/db/cliente.ts";
import { contato, evento, fornecedor, itemPedido, mensagem } from "../../src/nucleo/db/schema.ts";
import { quantidadeDe } from "../../src/texto.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EstiloBotao = "sucesso" | "perigo" | "primario";
export type BotaoSimulado = { rotulo: string; dado: string; estilo?: EstiloBotao };

/** Uma linha da tabela mensagem, pronta para ir ao navegador (datas em ISO). */
export type MensagemSimulada = {
  id: string;
  /** "saida": o sistema mandou ao fornecedor; "entrada": o fornecedor respondeu. */
  direcao: "entrada" | "saida";
  texto: string;
  botoes: BotaoSimulado[];
  itemPedidoId: number | null;
  pedidoId: number | null;
  situacao: string;
  criadoEm: string;
};

const condicaoAssumido = sql`${evento.dados}->>'tipo' = 'sim_assumido'`;
const contatoDoEvento = sql<string>`${evento.dados}->>'contatoId'`;

/** Por contato: true quando o usuário assumiu o chat. Contato sem evento fica de fora (automático). */
async function assumidos(contatoIds: string[]): Promise<Map<string, boolean>> {
  if (!contatoIds.length) return new Map();
  const linhas = await db
    .selectDistinctOn([contatoDoEvento], {
      contatoId: contatoDoEvento,
      // Comparação em jsonb: um valor que não seja booleano conta como falso, sem erro de conversão.
      assumido: sql<boolean>`coalesce(${evento.dados}->'assumido' = 'true'::jsonb, false)`,
    })
    .from(evento)
    .where(and(condicaoAssumido, inArray(contatoDoEvento, contatoIds)))
    .orderBy(contatoDoEvento, desc(evento.criadoEm));
  return new Map(linhas.map((l) => [l.contatoId, l.assumido]));
}

/** Contato do canal simulado com o fornecedor dele. Null para id inválido, inexistente ou de outro canal. */
async function contatoSimulado(id: string) {
  if (!UUID.test(id)) return null;
  const [linha] = await db
    .select({ id: contato.id, endereco: contato.endereco, fornecedorId: fornecedor.id, nome: fornecedor.nome })
    .from(contato)
    .innerJoin(fornecedor, eq(fornecedor.id, contato.fornecedorId))
    .where(and(eq(contato.id, id), eq(contato.canal, "simulado"), eq(contato.papel, "fornecedor"), eq(fornecedor.origem, "simulado")));
  return linha ?? null;
}

/**
 * O chat inteiro de um fornecedor simulado: as 300 mensagens mais recentes, em ordem, e quem responde.
 * Usa o `cache` do React: o título da aba e a página leem o mesmo chat sem ir ao banco duas vezes.
 */
export const chatSimulado = cache(async (id: string) => {
  const c = await contatoSimulado(id);
  if (!c) return null;
  const [recentes, estado] = await Promise.all([
    db
      .select({
        id: mensagem.id,
        direcao: mensagem.direcao,
        texto: mensagem.texto,
        botoes: mensagem.botoes,
        itemPedidoId: mensagem.itemPedidoId,
        pedidoId: mensagem.pedidoId,
        situacao: mensagem.situacao,
        criadoEm: mensagem.criadoEm,
      })
      .from(mensagem)
      .where(eq(mensagem.contatoId, c.id))
      // Pega do fim para o começo e desvira: numa conversa longa, as mais novas não podem ficar de fora.
      .orderBy(desc(mensagem.criadoEm))
      .limit(300),
    assumidos([c.id]),
  ]);
  const mensagens: MensagemSimulada[] = recentes.reverse().map((m) => ({
    ...m,
    botoes: (m.botoes ?? []) as BotaoSimulado[],
    criadoEm: m.criadoEm.toISOString(),
  }));
  return {
    contatoId: c.id,
    chave: c.endereco,
    fornecedor: { id: c.fornecedorId, nome: c.nome },
    automatico: !estado.get(c.id),
    mensagens,
  };
});

export type ChatSimulado = NonNullable<Awaited<ReturnType<typeof chatSimulado>>>;

/** O item de `?item=`, para o topo do chat dizer de que cotação se trata. Null se o número não serve. */
export async function itemDoChat(texto: string | undefined) {
  if (!texto || !/^\d+$/.test(texto)) return null;
  const id = Number(texto);
  if (!Number.isSafeInteger(id)) return null;
  const [i] = await db
    .select({ id: itemPedido.id, pedidoId: itemPedido.pedidoId, descricao: itemPedido.descricao, quantidade: itemPedido.quantidade, unidade: itemPedido.unidade })
    .from(itemPedido)
    .where(eq(itemPedido.id, id));
  return i ? { id: i.id, pedidoId: i.pedidoId, titulo: quantidadeDe(i.quantidade, i.unidade, i.descricao) } : null;
}

/** Todos os chats simulados, o mais recente primeiro; quem nunca recebeu mensagem vai para o fim. */
export async function listaChatsSimulados() {
  const contatos = await db
    .select({ id: contato.id, chave: contato.endereco, nome: fornecedor.nome })
    .from(contato)
    .innerJoin(fornecedor, eq(fornecedor.id, contato.fornecedorId))
    .where(and(eq(contato.canal, "simulado"), eq(contato.papel, "fornecedor"), eq(fornecedor.origem, "simulado")))
    .orderBy(asc(fornecedor.nome));
  const ids = contatos.map((c) => c.id);
  const [ultimas, estado] = ids.length
    ? await Promise.all([
        db
          .selectDistinctOn([mensagem.contatoId], { contatoId: mensagem.contatoId, direcao: mensagem.direcao, texto: mensagem.texto, criadoEm: mensagem.criadoEm })
          .from(mensagem)
          .where(inArray(mensagem.contatoId, ids))
          .orderBy(mensagem.contatoId, desc(mensagem.criadoEm)),
        assumidos(ids),
      ])
    : [[], new Map<string, boolean>()];
  const porContato = new Map(ultimas.map((u) => [u.contatoId, u]));
  return contatos
    .map((c) => {
      const u = porContato.get(c.id);
      return {
        ...c,
        automatico: !estado.get(c.id),
        ultima: u ? { direcao: u.direcao, texto: u.texto, criadoEm: u.criadoEm } : null,
      };
    })
    .sort((a, b) => (b.ultima?.criadoEm.getTime() ?? 0) - (a.ultima?.criadoEm.getTime() ?? 0));
}

/**
 * T8: contato do canal simulado de cada fornecedor, para o botão "Ser o fornecedor" nas abas do pedido.
 * Só fornecedores simulados entram; o real não tem chat simulado.
 */
export async function contatosSimulados(fornecedorIds: string[]): Promise<Record<string, string>> {
  if (!fornecedorIds.length) return {};
  const linhas = await db
    .select({ fornecedorId: contato.fornecedorId, contatoId: contato.id })
    .from(contato)
    .innerJoin(fornecedor, eq(fornecedor.id, contato.fornecedorId))
    .where(and(eq(contato.canal, "simulado"), eq(contato.papel, "fornecedor"), eq(fornecedor.origem, "simulado"), inArray(contato.fornecedorId, fornecedorIds)));
  return Object.fromEntries(linhas.map((l) => [l.fornecedorId!, l.contatoId]));
}
