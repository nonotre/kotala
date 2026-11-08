// Leitura das conversas dos compradores para a tela Conversas. Só leitura, como lib/dados.ts:
// a tela escreve só na conversa do próprio navegador, por enviarChat() (lib/acoes.ts).
//
// O endereço de um contato web é o que dá direito a escrever na conversa dele (é o que enviarChat recebe),
// por isso nunca sai daqui: a lista leva só o final, e "meu" é marcado aqui, comparando com o endereço
// que o próprio navegador mandou.

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../src/nucleo/db/cliente.ts";
import { contato, mensagem, usuario } from "../../src/nucleo/db/schema.ts";

/** Os canais que a tela mostra: o chat web e o espelho do Telegram. */
export const CANAIS_CONVERSA = ["web", "telegram"] as const;
export type CanalConversa = (typeof CANAIS_CONVERSA)[number];

/** Uma conversa na lista. */
export type ItemConversa = {
  contatoId: string;
  canal: CanalConversa;
  /** Nome do contato, ou "Comprador …1234" sem nome. */
  nome: string;
  /** O chat web de quem entrou: a única conversa em que dá para escrever. */
  meu: boolean;
  /** Ligada à conta de quem entrou (o chat web dele ou o Telegram ligado, o espelho da Frente 2). */
  seu: boolean;
  /** Trecho da última mensagem, já pronto para mostrar. Nulo numa conversa sem mensagens. */
  trecho: string | null;
  /** ISO. */
  ultimaEm: string | null;
};

export type ListaConversas = { web: ItemConversa[]; telegram: ItemConversa[] };

/** Uma mensagem, como a tela de leitura mostra. */
export type MensagemConversa = {
  id: string;
  direcao: "entrada" | "saida";
  texto: string;
  /** Rótulos dos botões que o assistente ofereceu. O dado de cada um não sai do servidor. */
  botoes: string[] | null;
  /** ISO. */
  criadoEm: string;
  /** Só nome e tipo. */
  anexos: { tipo: string; nome: string | null }[];
  /** A mensagem do assistente não chegou ao comprador. */
  naoEntregue: boolean;
};

export type ConversaAberta = {
  contato: { id: string; canal: CanalConversa; nome: string };
  mensagens: MensagemConversa[];
};

/** Quantas conversas a lista traz por canal. */
const MAXIMO_NA_LISTA = 100;
/** Quantas mensagens uma conversa traz, das mais recentes, como conversaWeb(). */
const MAXIMO_MENSAGENS = 300;
const TAMANHO_TRECHO = 120;

export const ehUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
/** Mesmo filtro de /api/chat. */
export const ehEnderecoWeb = (v: string) => /^[a-z0-9-]{8,64}$/i.test(v);

/** Nome da conta ligada (Frente 2); senão o do contato; senão "Comprador …1234" (o final do endereço basta). */
function nomeDo(c: { nome: string | null; endereco: string; nomeUsuario?: string | null }): string {
  return c.nomeUsuario?.trim() || c.nome?.trim() || `Comprador …${c.endereco.slice(-4)}`;
}

const NOME_TIPO: Record<string, string> = { foto: "imagem", pdf: "PDF", audio: "áudio" };

/** Trecho da última mensagem: o texto numa linha, ou o anexo, ou o toque num botão. */
function trechoDe(m: { direcao: "entrada" | "saida"; texto: string; anexos: { tipo: string; nome?: string }[] }): string {
  const anexo = m.anexos[0];
  let t = m.texto.replace(/\s+/g, " ").trim();
  if (!t && anexo) t = `Anexo: ${anexo.nome ?? NOME_TIPO[anexo.tipo] ?? "arquivo"}`;
  if (!t) t = m.direcao === "entrada" ? "(tocou num botão)" : "(sem texto)";
  if (t.length > TAMANHO_TRECHO) t = `${t.slice(0, TAMANHO_TRECHO - 1)}…`;
  return m.direcao === "saida" ? `Assistente: ${t}` : t;
}

/**
 * As conversas dos compradores no chat web e no Telegram, da mais recente para a mais antiga.
 * Só entram as que têm mensagem, menos a de quem entrou (`meuEndereco`, o id do usuário), que entra sempre.
 */
export async function listaConversas(meuEndereco?: string): Promise<ListaConversas> {
  // A última mensagem de cada contato comprador (DISTINCT ON usa o índice contato_id, criado_em).
  const ultimas = await db
    .selectDistinctOn([mensagem.contatoId], {
      contatoId: mensagem.contatoId,
      canal: contato.canal,
      endereco: contato.endereco,
      nome: contato.nome,
      usuarioId: contato.usuarioId,
      nomeUsuario: usuario.nome,
      direcao: mensagem.direcao,
      texto: mensagem.texto,
      anexos: mensagem.anexos,
      criadoEm: mensagem.criadoEm,
    })
    .from(mensagem)
    .innerJoin(contato, eq(contato.id, mensagem.contatoId))
    .leftJoin(usuario, eq(usuario.id, contato.usuarioId))
    .where(and(eq(contato.papel, "comprador"), inArray(contato.canal, [...CANAIS_CONVERSA])))
    .orderBy(mensagem.contatoId, desc(mensagem.criadoEm));

  const meu = meuEndereco && ehEnderecoWeb(meuEndereco) ? meuEndereco : null;
  const saida: ListaConversas = { web: [], telegram: [] };
  for (const u of ultimas.sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())) {
    const canal = u.canal as CanalConversa;
    saida[canal].push({
      contatoId: u.contatoId,
      canal,
      nome: nomeDo(u),
      meu: canal === "web" && u.endereco === meu,
      seu: !!meu && (u.usuarioId === meu || (canal === "web" && u.endereco === meu)),
      trecho: trechoDe(u),
      ultimaEm: u.criadoEm.toISOString(),
    });
  }

  // O Telegram ligado à conta (o espelho) aparece mesmo antes da primeira mensagem, e vem primeiro na lista dele.
  if (meu && ehUuid(meu) && !saida.telegram.some((i) => i.seu)) {
    const ligados = await db
      .select({ id: contato.id, nome: contato.nome, endereco: contato.endereco, nomeUsuario: usuario.nome })
      .from(contato)
      .innerJoin(usuario, eq(usuario.id, contato.usuarioId))
      .where(and(eq(contato.canal, "telegram"), eq(contato.papel, "comprador"), eq(contato.usuarioId, meu)));
    for (const t of ligados) saida.telegram.push({ contatoId: t.id, canal: "telegram", nome: nomeDo(t), meu: false, seu: true, trecho: null, ultimaEm: null });
  }
  saida.telegram.sort((a, b) => Number(b.seu) - Number(a.seu));

  // A de quem entrou sem mensagens ainda (o contato pode existir, com nome, ou nem existir).
  if (meu && !saida.web.some((i) => i.meu)) {
    const [c] = await db
      .select({ id: contato.id, nome: contato.nome, endereco: contato.endereco })
      .from(contato)
      .where(and(eq(contato.canal, "web"), eq(contato.endereco, meu), eq(contato.papel, "comprador")));
    if (c) saida.web.unshift({ contatoId: c.id, canal: "web", nome: nomeDo(c), meu: true, seu: true, trecho: null, ultimaEm: null });
  }

  return { web: saida.web.slice(0, MAXIMO_NA_LISTA), telegram: saida.telegram.slice(0, MAXIMO_NA_LISTA) };
}

/** Uma conversa de comprador (web ou Telegram), pelo id do contato: as 300 mensagens mais recentes, em ordem. */
export async function conversaDoContato(contatoId: string): Promise<ConversaAberta | null> {
  if (!ehUuid(contatoId)) return null;
  const [c] = await db
    .select({ id: contato.id, canal: contato.canal, nome: contato.nome, endereco: contato.endereco, nomeUsuario: usuario.nome })
    .from(contato)
    .leftJoin(usuario, eq(usuario.id, contato.usuarioId))
    .where(and(eq(contato.id, contatoId), eq(contato.papel, "comprador"), inArray(contato.canal, [...CANAIS_CONVERSA])));
  if (!c) return null;
  // Pega do fim para o começo e desvira: numa conversa longa, as mais novas não podem ficar de fora.
  const recentes = await db
    .select({
      id: mensagem.id,
      direcao: mensagem.direcao,
      texto: mensagem.texto,
      botoes: mensagem.botoes,
      criadoEm: mensagem.criadoEm,
      anexos: mensagem.anexos,
      situacao: mensagem.situacao,
    })
    .from(mensagem)
    .where(eq(mensagem.contatoId, c.id))
    .orderBy(desc(mensagem.criadoEm))
    .limit(MAXIMO_MENSAGENS);
  return {
    contato: { id: c.id, canal: c.canal as CanalConversa, nome: nomeDo(c) },
    mensagens: recentes.reverse().map((m) => ({
      id: m.id,
      direcao: m.direcao,
      texto: m.texto,
      botoes: m.botoes?.length ? m.botoes.map((b) => b.rotulo) : null,
      criadoEm: m.criadoEm.toISOString(),
      anexos: (m.anexos ?? []).map((a) => ({ tipo: a.tipo, nome: a.nome ?? null })),
      naoEntregue: m.direcao === "saida" && (m.situacao === "falhou" || m.situacao === "bloqueada_parar"),
    })),
  };
}
