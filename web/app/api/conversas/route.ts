import { conversasDoUsuario } from "@/lib/dados-conversas";
import { usuarioDaSessao } from "@/lib/sessao-servidor";

export const dynamic = "force-dynamic";

/** Lista da tela Conversar: só as conversas ligadas à conta da sessão (cookie). */
export async function GET() {
  const u = await usuarioDaSessao();
  if (!u) return Response.json({ erro: "Entre de novo para continuar." }, { status: 401 });
  return Response.json(await conversasDoUsuario(u.id));
}
