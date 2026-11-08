import { conversasDoUsuario } from "@/lib/dados-conversas";

export const dynamic = "force-dynamic";

/** Lista da tela Conversar: só as conversas ligadas à conta de quem entrou (`usuario` = id dele). */
export async function GET(req: Request) {
  const usuario = new URL(req.url).searchParams.get("usuario") ?? "";
  return Response.json(await conversasDoUsuario(usuario));
}
