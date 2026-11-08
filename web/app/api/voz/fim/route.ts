// X5: fim da ligação (desligou, silêncio, tempo, queda): a transcrição vai para o rastro no processo dos bots.
import { cortarTranscricao } from "../../../../../src/agentes/voz/sessao.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => ({}))) as { cotacaoId?: string; motivo?: string; transcricao?: string; duracaoSeg?: number };
  const url = process.env.API_INTERNA_URL ?? "http://127.0.0.1:3301";
  const token = process.env.API_INTERNA_TOKEN;
  if (!token) return Response.json({ ok: false });
  try {
    const r = await fetch(`${url}/voz/fim`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kotala-token": token },
      body: JSON.stringify({ cotacaoId: corpo.cotacaoId, motivo: corpo.motivo, duracaoSeg: corpo.duracaoSeg, transcricao: cortarTranscricao(String(corpo.transcricao ?? "")) }),
      signal: AbortSignal.timeout(15_000),
    });
    return Response.json({ ok: r.ok });
  } catch {
    return Response.json({ ok: false });
  }
}
