// Nome do cookie da sessão e as rotas que não pedem sessão. Sem next/headers: o proxy.ts também usa.

/** Guarda só o id da linha em `sessao` (httpOnly): o navegador não lê, e o servidor confere no banco. */
export const COOKIE_SESSAO = "kotala_sessao";

/** A única tela aberta a quem não entrou. Os estáticos já ficam fora pelo matcher do proxy. */
export const ROTA_LOGIN = "/login";

/** O que fazer com uma requisição sem sessão válida: tela vai para a entrada; API e ação recebem 401. */
export function semSessao(caminho: string, metodo: string): "seguir" | "entrar" | "recusar" {
  if (caminho === ROTA_LOGIN) return "seguir";
  if (caminho.startsWith("/api/")) return "recusar";
  return metodo === "GET" || metodo === "HEAD" ? "entrar" : "recusar";
}
