import { entradaPdfDoItem, nomeArquivoMapa, pdfDoMapa } from "../../../../../src/agentes/comparador/pdf.ts";

export const dynamic = "force-dynamic";

/** Q1: o PDF do último mapa da cotação (item), o mesmo anexado ao mapa no Telegram e no e-mail. */
export async function GET(_req: Request, { params }: { params: Promise<{ item: string }> }) {
  const { item } = await params;
  const id = Number(item);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ erro: "Cotação inválida." }, { status: 400 });
  const e = await entradaPdfDoItem(id);
  if (!e) return Response.json({ erro: "Esta cotação ainda não tem mapa." }, { status: 404 });
  return new Response(new Uint8Array(pdfDoMapa(e)), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${nomeArquivoMapa(e.pedido.id, e.item.id, e.rodada)}"`,
      "cache-control": "no-store",
    },
  });
}
