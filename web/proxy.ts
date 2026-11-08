// Proteção das rotas no servidor: sem sessão válida (cookie conferido no banco), tela vai para /login
// e API ou ação recebem 401. Confere no banco aqui, e não só a presença do cookie, porque a navegação
// entre telas não passa de novo pelo layout raiz. Quem já entrou e abre /login vai ao Início.

import { NextResponse, type NextRequest } from "next/server";
import { usuarioDaSessao } from "../src/contas.ts";
import { COOKIE_SESSAO, ROTA_LOGIN, semSessao } from "./lib/sessao-cookie.ts";

export async function proxy(req: NextRequest) {
  const caminho = req.nextUrl.pathname;
  const id = req.cookies.get(COOKIE_SESSAO)?.value;
  let valida = false;
  let bancoFora = false;
  if (id) {
    try {
      valida = Boolean(await usuarioDaSessao(id));
    } catch {
      // Banco fora: não deixa passar, mas também não apaga o cookie, que pode ainda valer.
      bancoFora = true;
    }
  }

  if (valida) {
    if (caminho === ROTA_LOGIN && req.method === "GET") return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  const destino = semSessao(caminho, req.method);
  const resposta =
    destino === "seguir"
      ? NextResponse.next()
      : destino === "entrar"
        ? NextResponse.redirect(new URL(ROTA_LOGIN, req.url))
        : NextResponse.json({ erro: "Entre de novo para continuar." }, { status: 401 });
  // Cookie de sessão vencida ou apagada: sai junto.
  if (id && !bancoFora) resposta.cookies.delete(COOKIE_SESSAO);
  return resposta;
}

export const config = {
  // Fora: arquivos do Next, fontes, logos e ícone (a tela de entrada precisa deles).
  matcher: ["/((?!_next/static|_next/image|__nextjs|fontes/|logo|icon\\.svg|favicon\\.ico).*)"],
};
