"use server";
// Nova conversa no site: um contato web novo, ligado à conta, com endereço próprio. As conversas
// anteriores continuam na lista da pessoa; pedidos e rastro não mudam.

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../src/nucleo/db/cliente.ts";
import { contato, usuario } from "../../src/nucleo/db/schema.ts";

export async function novaConversa(usuarioId: string): Promise<{ ok: true; contatoId: string } | { ok: false; erro: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(usuarioId)) return { ok: false, erro: "Entre de novo para começar uma conversa." };
  const [u] = await db.select({ id: usuario.id, nome: usuario.nome }).from(usuario).where(eq(usuario.id, usuarioId));
  if (!u) return { ok: false, erro: "Entre de novo para começar uma conversa." };
  // O aviso de privacidade é por pessoa: quem já o viu em outra conversa não o recebe de novo.
  const [viu] = await db.select({ id: contato.id }).from(contato).where(and(eq(contato.usuarioId, u.id), isNotNull(contato.avisoPrivacidadeEm))).limit(1);
  const [c] = await db
    .insert(contato)
    .values({ canal: "web", endereco: crypto.randomUUID(), papel: "comprador", nome: u.nome, usuarioId: u.id, avisoPrivacidadeEm: viu ? new Date() : null })
    .returning({ id: contato.id });
  return { ok: true, contatoId: c!.id };
}
