import QRCode from "qrcode";
import { Tile } from "@/components/carbon";
import estilos from "../comum.module.scss";
import qr from "./convite.module.scss";

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
  return (
    <>
      <h1 className={estilos.titulo}>Seja um fornecedor</h1>
      <p className={estilos.sub}>
        Aponte a câmera do celular para o código. Você entra no bot do fornecedor, informa o nome da empresa e passa a receber os pedidos de cotação. Responda do seu jeito: texto, áudio, foto ou PDF.
      </p>
      {svg && link ? (
        <Tile className={qr.cartao}>
          <div className={qr.codigo} role="img" aria-label={`Código QR para ${link}`} dangerouslySetInnerHTML={{ __html: svg }} />
          <p className={qr.link}>{link.replace("https://", "")}</p>
          <p className={estilos.ajuda}>É uma demonstração: a empresa compradora é fictícia e nenhuma compra é feita sem aprovação do comprador.</p>
        </Tile>
      ) : (
        <p className={estilos.sub}>O bot do fornecedor não está configurado (falta TELEGRAM_TOKEN_FORNECEDOR) ou o Telegram não respondeu.</p>
      )}
    </>
  );
}
