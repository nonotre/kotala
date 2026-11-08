"use server";
// Pessoas da empresa nas telas: quem é responsável por um pedido e quem é gestor.
// Como lib/contas.ts, grava direto no banco (não roda agente nenhum) e deixa o
// rastro em `evento`, como ação do comprador. Quem age é o usuário da sessão do
// cookie (lib/sessao-servidor.ts); qualquer um que entrou pode trocar, de propósito.

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db } from "../../src/nucleo/db/cliente.ts";
import { pedido, usuario } from "../../src/nucleo/db/schema.ts";
import { registrar } from "../../src/nucleo/registro.ts";
import { usuarioDaSessao } from "./sessao-servidor.ts";

export type Pessoa = { id: string; nome: string; login: string; papel: "comprador" | "gestor" };
type Resultado = { ok: boolean; erro?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function nomeDe(id: string | null | undefined): Promise<string | null> {
  if (!id || !UUID.test(id)) return null;
  const [u] = await db.select({ nome: usuario.nome }).from(usuario).where(eq(usuario.id, id));
  return u?.nome ?? null;
}

const SEM_SESSAO: Resultado = { ok: false, erro: "Entre de novo para continuar." };

/** Todos os usuários, para escolher o responsável e marcar o gestor. */
export async function listarPessoas(): Promise<Pessoa[]> {
  if (!(await usuarioDaSessao())) return [];
  return db.select({ id: usuario.id, nome: usuario.nome, login: usuario.login, papel: usuario.papel }).from(usuario).orderBy(asc(usuario.nome));
}

/**
 * Troca o responsável pelo pedido (`pedido.responsavel_id`). `null` volta ao padrão:
 * o usuário ligado ao contato que pediu.
 */
export async function trocarResponsavel(pedidoId: number, usuarioId: string | null): Promise<Resultado> {
  const quem = await usuarioDaSessao();
  if (!quem) return SEM_SESSAO;
  const porId = quem.id;
  if (!Number.isSafeInteger(pedidoId) || pedidoId <= 0) return { ok: false, erro: "Pedido inválido." };
  const [p] = await db.select({ id: pedido.id, responsavelId: pedido.responsavelId }).from(pedido).where(eq(pedido.id, pedidoId));
  if (!p) return { ok: false, erro: "Pedido não encontrado." };
  const novo = usuarioId ? await nomeDe(usuarioId) : null;
  if (usuarioId && !novo) return { ok: false, erro: "Usuário não encontrado." };
  if ((p.responsavelId ?? null) === (usuarioId ?? null)) return { ok: true };
  const por = await nomeDe(porId);
  await db.transaction(async (tx) => {
    await tx.update(pedido).set({ responsavelId: usuarioId }).where(eq(pedido.id, pedidoId));
    await registrar(tx, {
      agente: "Comprador",
      acao: novo ? `Passou o pedido para ${novo}.` : "Voltou o responsável para quem fez o pedido.",
      motivo: por ? `Troca feita na tela por ${por}.` : "Troca feita na tela.",
      pedidoId,
      dados: { tipo: "responsavel", de: p.responsavelId, para: usuarioId, porId: porId && UUID.test(porId) ? porId : null },
    });
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Marca ou desmarca um usuário como gestor (`usuario.papel`). O gestor recebe os avisos de conduta. */
export async function marcarGestor(usuarioId: string, gestor: boolean): Promise<Resultado> {
  const quem = await usuarioDaSessao();
  if (!quem) return SEM_SESSAO;
  const porId = quem.id;
  if (!UUID.test(String(usuarioId))) return { ok: false, erro: "Usuário inválido." };
  const [u] = await db.select({ nome: usuario.nome, papel: usuario.papel }).from(usuario).where(eq(usuario.id, usuarioId));
  if (!u) return { ok: false, erro: "Usuário não encontrado." };
  const papel = gestor ? "gestor" : "comprador";
  if (u.papel === papel) return { ok: true };
  const por = await nomeDe(porId);
  // `usuario` fica fora da auditoria (não copia hash de senha); o evento é o registro da troca.
  await db.transaction(async (tx) => {
    await tx.update(usuario).set({ papel }).where(eq(usuario.id, usuarioId));
    await registrar(tx, {
      agente: "Comprador",
      acao: gestor ? `Marcou ${u.nome} como gestor de compras.` : `Tirou ${u.nome} do papel de gestor de compras.`,
      motivo: por ? `Troca feita na tela por ${por}.` : "Troca feita na tela.",
      dados: { tipo: "papel", usuarioId, papel, porId: porId && UUID.test(porId) ? porId : null },
    });
  });
  revalidatePath("/configuracoes");
  return { ok: true };
}
