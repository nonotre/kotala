import { conversaDoContato, ehUuid } from "@/lib/dados-conversas";

export const dynamic = "force-dynamic";

/** Uma conversa de comprador, só para ler. O id é validado antes de ir ao banco. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ehUuid(id)) return Response.json({ erro: "Id inválido." }, { status: 400 });
  const conversa = await conversaDoContato(id);
  return conversa ? Response.json(conversa) : Response.json({ erro: "Conversa não encontrada." }, { status: 404 });
}
