import { conversaWeb } from "@/lib/dados";

export const dynamic = "force-dynamic";

/** Conversa do chat web (`endereco`). O espelho do Telegram é a conversa dele em Conversas (/api/conversas). */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const endereco = params.get("endereco") ?? "";
  if (!/^[a-z0-9-]{8,64}$/i.test(endereco)) return Response.json([]);
  return Response.json(await conversaWeb(endereco));
}
