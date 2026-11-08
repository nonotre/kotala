import { contatoDoUsuario } from "../../../../../src/contas.ts";
import { conversaDoContato, ehUuid } from "@/lib/dados-conversas";
import { usuarioDaSessao } from "@/lib/sessao-servidor";

export const dynamic = "force-dynamic";

/** Uma conversa de comprador, só para ler, e só se o contato for da conta da sessão. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ehUuid(id)) return Response.json({ erro: "Id inválido." }, { status: 400 });
  const u = await usuarioDaSessao();
  if (!u) return Response.json({ erro: "Entre de novo para continuar." }, { status: 401 });
  // Conversa de outra pessoa responde como inexistente: não confirma que o id existe.
  const conversa = (await contatoDoUsuario(id, u.id)) ? await conversaDoContato(id) : null;
  return conversa ? Response.json(conversa) : Response.json({ erro: "Conversa não encontrada." }, { status: 404 });
}
