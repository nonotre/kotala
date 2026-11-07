// X5: a ferramenta registrar_cotacao do agente de voz chega aqui e vai para o processo dos bots.
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
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(30_000),
    });
    return Response.json(await r.json());
  } catch {
    return Response.json({ ok: false, resposta: "Não consegui registrar agora. Diga que o comprador retorna e encerre." });
  }
}
