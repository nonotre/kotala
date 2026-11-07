import { conversaWeb } from "@/lib/dados";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const endereco = new URL(req.url).searchParams.get("endereco") ?? "";
  if (!/^[a-z0-9-]{8,64}$/i.test(endereco)) return Response.json([]);
  return Response.json(await conversaWeb(endereco));
}
