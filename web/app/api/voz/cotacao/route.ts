// X5: a ferramenta registrar_cotacao do agente de voz chega aqui e vai para o processo dos bots.
import { cortarTranscricao, respostaDaFerramenta } from "../../../../../src/agentes/voz/sessao.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => ({}))) as { cotacaoId?: string; args?: unknown; transcricao?: string };
  const url = process.env.API_INTERNA_URL ?? "http://127.0.0.1:3301";
  const token = process.env.API_INTERNA_TOKEN;
  if (!token) return Response.json({ ok: false, resposta: "Sistema só de leitura agora. Agradeça e encerre." });
  try {
    const r = await fetch(`${url}/voz/cotacao`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kotala-token": token },
      // A API interna aceita até 20 kB: a transcrição vai cortada (começo e fim).
      body: JSON.stringify({ cotacaoId: corpo.cotacaoId, args: corpo.args ?? {}, transcricao: cortarTranscricao(String(corpo.transcricao ?? "")) }),
      signal: AbortSignal.timeout(30_000),
    });
    // Erro do servidor também volta numa resposta que o agente entende (ok + resposta).
    return Response.json(respostaDaFerramenta(r.ok ? await r.json() : null));
  } catch {
    return Response.json(respostaDaFerramenta(null));
  }
}
