// Testa a leitura de anexo do comprador (R1b) ao vivo, com o Gemini, sem o bot nem o banco.
// npm run anexo:testar -- caminho/do/audio.ogg
// npm run anexo:testar -- print-mercado-livre.png "legenda opcional"

import { readFile } from "node:fs/promises";
import { extname } from "node:path";

process.env.DATABASE_URL ??= "postgres://x@127.0.0.1:1/x"; // não grava nada: só a chamada de IA
const { lerAnexoDoComprador, textoDoPedidoComAnexo } = await import("../src/agentes/interpretador/anexos.ts");

const TIPOS: Record<string, string> = {
  ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf",
};

const [arquivo, legenda = ""] = process.argv.slice(2);
const mediaType = arquivo ? TIPOS[extname(arquivo).toLowerCase()] : undefined;
if (!arquivo || !mediaType) {
  console.error(`Uso: npm run anexo:testar -- arquivo [legenda]. Formatos: ${Object.keys(TIPOS).join(" ")}`);
  process.exit(1);
}
const t0 = Date.now();
const l = await lerAnexoDoComprador([{ dados: new Uint8Array(await readFile(arquivo)), mediaType }], legenda);
console.log(JSON.stringify(l, null, 2));
console.log(`\nTexto que entra no pedido (${((Date.now() - t0) / 1000).toFixed(1)} s):\n${textoDoPedidoComAnexo(legenda, l)}`);
process.exit(0);
