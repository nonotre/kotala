import { enderecoWebDoUsuario } from "../../../../src/contas.ts";
import { conversaWeb } from "@/lib/dados";
import { usuarioDaSessao } from "@/lib/sessao-servidor";

export const dynamic = "force-dynamic";

/** Conversa do chat web (`endereco`), só se for da conta da sessão. O espelho do Telegram é a conversa dele em Conversas (/api/conversas). */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const endereco = params.get("endereco") ?? "";
  if (!/^[a-z0-9-]{8,64}$/i.test(endereco)) return Response.json([]);
  const u = await usuarioDaSessao();
  if (!u) return Response.json({ erro: "Entre de novo para continuar." }, { status: 401 });
  if (!(await enderecoWebDoUsuario(endereco, u.id))) return Response.json([]);
  return Response.json(await conversaWeb(endereco));
}
