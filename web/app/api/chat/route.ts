import { conversaTelegram, conversaWeb } from "@/lib/dados";

export const dynamic = "force-dynamic";

/** Conversa do chat web (`endereco`) ou, com `canal=telegram`, o espelho do Telegram do usuário (`endereco` = id dele). */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const endereco = params.get("endereco") ?? "";
  if (!/^[a-z0-9-]{8,64}$/i.test(endereco)) return Response.json([]);
  if (params.get("canal") === "telegram") return Response.json(await conversaTelegram(endereco));
  return Response.json(await conversaWeb(endereco));
}
