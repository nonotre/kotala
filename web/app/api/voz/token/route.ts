// X5: chave temporária do Gemini Live para o navegador (a chave de verdade nunca sai do servidor).
import { GoogleGenAI } from "@google/genai";

export const dynamic = "force-dynamic";

export async function POST() {
  const chave = process.env.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY_RESERVA;
  if (!chave) return Response.json({ erro: "Falta GEMINI_API_KEY." }, { status: 500 });
  try {
    const ai = new GoogleGenAI({ apiKey: chave, httpOptions: { apiVersion: "v1alpha" } });
    const agora = Date.now();
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(agora + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(agora + 60_000).toISOString(),
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    return Response.json({ token: token.name, apiVersion: "v1alpha" });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
