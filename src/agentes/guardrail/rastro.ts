// S: o lado do guardrail que mexe no banco e manda mensagem. Rastro dos casos
// (agente "Guardrail", sem pedido quando não há), contador de insistência em
// evento.dados (sem migração) e aviso ao gestor. Ainda não existe papel de
// gestor: o aviso vai a GESTOR_CONTATO_ID, se houver; GUARDRAIL_MODO_DEMO=1
// desliga o aviso. O evento é registrado sempre.

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "../../nucleo/db/cliente.ts";
import { contato, evento, pedido, usuario } from "../../nucleo/db/schema.ts";
import { enviar } from "../../nucleo/mensagens/index.ts";
import { avancarItem, TransicaoConcorrente, TransicaoInvalida } from "../../nucleo/orquestrador/index.ts";
import { registrar } from "../../nucleo/registro.ts";
import { conferirItem, conferirSaida, contarInsistencia, mascararDadosPessoais, type Insistencia } from "./index.ts";

const DIA_MS = 24 * 3600_000;

/** Trecho para o rastro: curto e sem dado pessoal. */
export const trecho = (texto: string) => mascararDadosPessoais(texto).texto.slice(0, 200);

export type CasoGuardrail = {
  contatoId: string;
  /** Classe do guardrail, ou outro marcador que conta para a insistência ("condicao_irregular"). */
  classe: string;
  subtipo?: string | null;
  acao: string;
  motivo: string;
  texto?: string;
  pedidoId?: number;
  itemPedidoId?: number;
  dados?: Record<string, unknown>;
};

/** Registra o caso. O contatoId, a classe e o subtipo vão em dados, para a insistência e a tela. */
export function registrarCaso(c: CasoGuardrail) {
  return registrar(db, {
    agente: "Guardrail",
    acao: c.acao,
    motivo: c.motivo,
    pedidoId: c.pedidoId,
    itemPedidoId: c.itemPedidoId,
    dados: { contatoId: c.contatoId, classe: c.classe, subtipo: c.subtipo ?? null, trecho: c.texto ? trecho(c.texto) : undefined, ...c.dados },
  });
}

/** Contagem de insistência do contato nas últimas 24 h. */
export async function insistenciaDo(contatoId: string, agora = new Date()): Promise<Insistencia> {
  const desde = new Date(agora.getTime() - DIA_MS);
  const linhas = await db
    .select({ dados: evento.dados, criadoEm: evento.criadoEm })
    .from(evento)
    .where(and(eq(evento.agente, "Guardrail"), gte(evento.criadoEm, desde), sql`${evento.dados}->>'contatoId' = ${contatoId}`));
  const [ultimo] = await db.select({ criadoEm: pedido.criadoEm }).from(pedido).where(eq(pedido.compradorId, contatoId)).orderBy(desc(pedido.id)).limit(1);
  const eventos = linhas.map((l) => ({ classe: String((l.dados as { classe?: unknown } | null)?.classe ?? ""), criadoEm: l.criadoEm }));
  return contarInsistencia(eventos, agora, ultimo?.criadoEm ?? null);
}

export const modoDemo = () => process.env.GUARDRAIL_MODO_DEMO === "1";
export const gestorContatoId = () => process.env.GESTOR_CONTATO_ID?.trim() || null;

/**
 * Para onde vai o aviso: um contato por usuário com papel de gestor (Telegram antes do chat web,
 * que só é visto com a tela aberta); sem gestor marcado, o GESTOR_CONTATO_ID de antes.
 */
export async function contatosDosGestores(): Promise<string[]> {
  const linhas = await db
    .select({ usuarioId: usuario.id, contatoId: contato.id, canal: contato.canal })
    .from(usuario)
    .innerJoin(contato, and(eq(contato.usuarioId, usuario.id), isNull(contato.parouEm)))
    .where(eq(usuario.papel, "gestor"));
  const porUsuario = new Map<string, { contatoId: string; canal: string }>();
  for (const l of linhas) {
    const atual = porUsuario.get(l.usuarioId);
    if (!atual || (atual.canal === "web" && l.canal !== "web")) porUsuario.set(l.usuarioId, l);
  }
  const ids = [...porUsuario.values()].map((l) => l.contatoId);
  const doEnv = gestorContatoId();
  return ids.length ? ids : doEnv ? [doEnv] : [];
}

/**
 * Aviso ao gestor, um por chave em 24 h. Registra sempre; só manda a mensagem
 * quando há gestor (usuário com papel gestor, ou GESTOR_CONTATO_ID) e não está no modo demo.
 * Devolve se avisou alguém.
 */
export async function avisarGestor(p: { chave: string; texto: string; contatoId: string; pedidoId?: number; itemPedidoId?: number }): Promise<boolean> {
  const desde = new Date(Date.now() - DIA_MS);
  const [ja] = await db
    .select({ id: evento.id })
    .from(evento)
    .where(and(eq(evento.agente, "Guardrail"), gte(evento.criadoEm, desde), sql`${evento.dados}->>'avisoGestor' = ${p.chave}`))
    .limit(1);
  if (ja) return true;
  // O próprio comprador nunca recebe o aviso sobre ele, mesmo que seja gestor.
  const gestores = (await contatosDosGestores()).filter((id) => id !== p.contatoId);
  const demo = modoDemo();
  let enviado = false;
  let falha: string | undefined;
  if (gestores.length && !demo) {
    for (const gestor of gestores) {
      try {
        const r = await enviar(gestor, `Aviso de conduta: ${p.texto}`, { pedidoId: p.pedidoId, itemPedidoId: p.itemPedidoId, tipo: "aviso" });
        if (r.situacao === "enviada") enviado = true;
        else falha = r.situacao;
      } catch (erro) {
        falha = erro instanceof Error ? erro.message : String(erro);
      }
    }
  }
  await registrar(db, {
    agente: "Guardrail",
    acao: enviado ? "Avisou o gestor de compras." : "Aviso ao gestor de compras registrado, sem envio.",
    motivo: enviado ? p.texto : demo ? "Modo demo (GUARDRAIL_MODO_DEMO=1)." : !gestores.length ? "Sem gestor: marque um usuário como gestor em Configurações (ou use GESTOR_CONTATO_ID)." : `Falha no envio: ${falha}.`,
    pedidoId: p.pedidoId,
    itemPedidoId: p.itemPedidoId,
    dados: { contatoId: p.contatoId, classe: "aviso_gestor", avisoGestor: p.chave, texto: p.texto, enviado },
  });
  return enviado;
}

function ignorarCorrida(erro: unknown) {
  if (erro instanceof TransicaoInvalida || erro instanceof TransicaoConcorrente) return;
  throw erro;
}

/**
 * Barreira 4, no começo da busca: item proibido ou controlado não consulta a
 * internet, não cria oferta nem cotação; o item é cancelado com o motivo.
 * Devolve true quando barrou.
 */
export async function barrarItemNaBusca(item: { id: number; pedidoId: number; descricao: string; especificacao: Record<string, string> }): Promise<boolean> {
  const c = conferirItem(item);
  if (c.ok) return false;
  const [p] = await db.select({ compradorId: pedido.compradorId }).from(pedido).where(eq(pedido.id, item.pedidoId));
  const ctx = { pedidoId: item.pedidoId, itemPedidoId: item.id };
  let avisado = false;
  if (p && c.risco === "controlado") {
    avisado = await avisarGestor({ chave: `controlado:${p.compradorId}:${item.descricao.toLowerCase()}`, texto: `Item controlado no pedido ${item.pedidoId}: ${item.descricao}. ${c.motivo}`, contatoId: p.compradorId, ...ctx });
  }
  if (p) {
    const texto =
      c.risco === "controlado"
        ? `Pedido ${item.pedidoId}: "${item.descricao}" é produto controlado e não foi cotado. A compra exige autorização e um responsável; ${avisado ? "avisei o gestor de compras" : "deixei registrado para o gestor de compras"}.`
        : `Pedido ${item.pedidoId}: não posso cotar "${item.descricao}". O item foi cancelado.`;
    await enviar(p.compradorId, texto, { ...ctx, tipo: "aviso" });
  }
  await avancarItem(item.id, "cancelar", { agente: "Guardrail", acao: "Barrou o item antes da busca.", motivo: c.motivo, dados: { classe: c.risco, contatoId: p?.compradorId } }).catch(ignorarCorrida);
  return true;
}

/**
 * Barreira 5: confere o texto antes de ir ao fornecedor. Se falhar, não envia,
 * registra e avisa o comprador (e o gestor, em "sem nota", "por fora" ou lista dura).
 * Devolve true quando o texto pode seguir.
 */
export async function liberarSaida(
  texto: string,
  p: { compradorId: string; pedidoId?: number; itemPedidoId?: number; oQue: string; avisoComprador?: (motivos: string) => string },
): Promise<boolean> {
  const s = conferirSaida(texto);
  if (s.ok) return true;
  const motivos = s.motivos.join("; ");
  await registrarCaso({
    contatoId: p.compradorId,
    classe: "saida_barrada",
    acao: `Não mandou ${p.oQue} ao fornecedor.`,
    motivo: `Conferência de saída: ${motivos}.`,
    texto,
    pedidoId: p.pedidoId,
    itemPedidoId: p.itemPedidoId,
  });
  if (s.avisarGestor) {
    await avisarGestor({ chave: `saida:${p.compradorId}:${p.pedidoId ?? ""}`, texto: `O sistema barrou ${p.oQue} com ${motivos} (pedido ${p.pedidoId ?? "?"}).`, contatoId: p.compradorId, pedidoId: p.pedidoId, itemPedidoId: p.itemPedidoId });
  }
  const aviso = p.avisoComprador?.(motivos) ?? `Não mandei ${p.oQue} ao fornecedor: o texto tinha ${motivos}. Só cotamos com nota fiscal, sem dado pessoal e sem pagamento por fora.`;
  await enviar(p.compradorId, aviso, { pedidoId: p.pedidoId, itemPedidoId: p.itemPedidoId, tipo: "aviso" });
  return false;
}
