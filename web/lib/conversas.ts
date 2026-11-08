"use server";
// Nova conversa no site: um contato web novo, ligado à conta, com endereço próprio. As conversas
// anteriores continuam na lista da pessoa; pedidos e rastro não mudam. A regra mora em src/contas.ts.

import { novaConversaWeb } from "../../src/contas.ts";
import { usuarioDaSessao } from "./sessao-servidor.ts";

/** A conversa nova é sempre de quem entrou (sessão do cookie). */
export async function novaConversa(): Promise<{ ok: true; contatoId: string } | { ok: false; erro: string }> {
  const u = await usuarioDaSessao();
  if (!u) return { ok: false, erro: "Entre de novo para começar uma conversa." };
  return { ok: true, contatoId: await novaConversaWeb(u) };
}
