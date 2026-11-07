import QRCode from "qrcode";
import { PaginaConvite } from "@/components/consulta/PaginaConvite";

export const dynamic = "force-dynamic";

/** Usuário do bot do fornecedor, perguntado ao Telegram com o token do .env (só no servidor). */
async function usuarioDoBotFornecedor(): Promise<string | null> {
  const token = process.env.TELEGRAM_TOKEN_FORNECEDOR;
  if (!token) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { next: { revalidate: 3600 } });
    const j = (await r.json()) as { ok: boolean; result?: { username?: string } };
    return j.ok ? (j.result?.username ?? null) : null;
  } catch {
    return null;
  }
}

/** Q5: QR para a banca virar fornecedor ao vivo, pelo celular. */
export default async function Convite() {
  const usuario = await usuarioDoBotFornecedor();
  const link = usuario ? `https://t.me/${usuario}?start=cadastro` : null;
  const svg = link ? await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null;
  return <PaginaConvite link={link} svg={svg} />;
}
