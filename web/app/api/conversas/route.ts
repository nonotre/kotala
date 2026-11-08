import { ehEnderecoWeb, listaConversas } from "@/lib/dados-conversas";

export const dynamic = "force-dynamic";

/** Lista da tela Conversas. `endereco` é o do chat deste navegador: só serve para marcar a conversa dele. */
export async function GET(req: Request) {
  const endereco = new URL(req.url).searchParams.get("endereco") ?? "";
  return Response.json(await listaConversas(ehEnderecoWeb(endereco) ? endereco : undefined));
}
