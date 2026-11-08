// Quem entrou, do lado do servidor: o id da sessão vem do cookie httpOnly e é conferido no banco
// (src/contas.ts). É a autoridade para as ações e as rotas /api; o useSessao() do navegador é só
// um espelho para mostrar o nome. Não é "use server": só funções de servidor importam daqui.

import { cookies, headers } from "next/headers";
import { cache } from "react";
import * as contas from "../../src/contas.ts";
import { COOKIE_SESSAO } from "./sessao-cookie.ts";

export type { Sessao } from "../../src/contas.ts";

/** O usuário da sessão do cookie, ou null. Uma consulta por requisição. */
export const usuarioDaSessao = cache(async (): Promise<contas.Sessao | null> => {
  const id = (await cookies()).get(COOKIE_SESSAO)?.value;
  return contas.usuarioDaSessao(id).catch(() => null);
});

export class SemSessao extends Error {
  constructor() {
    super("Entre de novo para continuar.");
  }
}

/** Para as ações: sem sessão válida, para aqui. */
export async function exigirUsuario(): Promise<contas.Sessao> {
  const u = await usuarioDaSessao();
  if (!u) throw new SemSessao();
  return u;
}

/** HTTPS de verdade (ou atrás de um proxy que diz que é): só então o cookie vai com Secure. */
async function ehHttps(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  return h.get("origin")?.startsWith("https:") ?? false;
}

/** Cria a sessão no banco e grava o id no cookie. Só dentro de uma ação de servidor ou rota. */
export async function abrirSessao(usuarioId: string): Promise<void> {
  const s = await contas.criarSessao(usuarioId);
  (await cookies()).set(COOKIE_SESSAO, s.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: await ehHttps(),
    path: "/",
    expires: s.expiraEm,
  });
}

/** Apaga a sessão no banco e o cookie. */
export async function fecharSessao(): Promise<void> {
  const jar = await cookies();
  await contas.apagarSessao(jar.get(COOKIE_SESSAO)?.value).catch(() => {});
  jar.delete(COOKIE_SESSAO);
}
