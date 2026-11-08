import { ChatWeb } from "@/components/chat/ChatWeb";

/** Usuário do bot do comprador, perguntado ao Telegram com o token do .env (só no servidor, guardado por 1 h). */
async function linkDoBotComprador(): Promise<string | null> {
  const token = process.env.TELEGRAM_TOKEN_COMPRADOR;
  if (!token) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { ok: boolean; result?: { username?: string } };
    return j.ok && j.result?.username ? `https://t.me/${j.result.username}` : null;
  } catch {
    return null;
  }
}

export default async function Conversar() {
  return <ChatWeb linkTelegram={await linkDoBotComprador()} />;
}
