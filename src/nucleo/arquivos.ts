// Guarda os arquivos recebidos (PDF, foto, áudio) em disco, pelo hash do
// conteúdo, e registra na tabela arquivo. O id do Telegram pode expirar; o
// original guardado não. Arquivos ficam fora do git (pasta dados/).

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db/cliente.ts";
import { arquivo, type Canal } from "./db/schema.ts";

export const PASTA_ARQUIVOS = () => resolve(process.env.ARQUIVOS_DIR ?? "dados/arquivos");

const EXTENSAO: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
};

export const sha256 = (dados: Uint8Array) => createHash("sha256").update(dados).digest("hex");

export async function salvarArquivo(a: {
  dados: Uint8Array;
  mediaType: string;
  canal: Canal;
  ref: string;
  nome?: string;
  mensagemId?: string;
}) {
  const hash = sha256(a.dados);
  const pasta = PASTA_ARQUIVOS();
  await mkdir(pasta, { recursive: true });
  const caminho = join(pasta, `${hash}.${EXTENSAO[a.mediaType] ?? "bin"}`);
  try {
    await access(caminho);
  } catch {
    await writeFile(caminho, a.dados);
  }
  const [linha] = await db
    .insert(arquivo)
    .values({ sha256: hash, mediaType: a.mediaType, tamanho: a.dados.length, caminho, nome: a.nome, canal: a.canal, ref: a.ref, mensagemId: a.mensagemId })
    .returning();
  return linha!;
}

/** Arquivo já guardado para este id do canal, lido do disco; null se não houver ou se sumiu. */
export async function arquivoGuardado(canal: Canal, ref: string) {
  const [a] = await db
    .select()
    .from(arquivo)
    .where(and(eq(arquivo.canal, canal), eq(arquivo.ref, ref)))
    .orderBy(desc(arquivo.criadoEm))
    .limit(1);
  if (!a) return null;
  try {
    const dados = new Uint8Array(await readFile(a.caminho));
    return sha256(dados) === a.sha256 ? { dados, mediaType: a.mediaType } : null;
  } catch {
    return null;
  }
}
