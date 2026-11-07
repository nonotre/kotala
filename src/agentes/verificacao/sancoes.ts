// Q8: empresas punidas pelo poder público, nos dados abertos do Portal da
// Transparência (sem chave): CEIS (inidôneas e suspensas) e CNEP (Lei
// Anticorrupção). Baixa o arquivo do dia, guarda só pessoas jurídicas e
// atualiza uma vez por dia. CPF de pessoa física nunca é guardado.

import { inflateRawSync } from "node:zlib";
import { eq, or, sql } from "drizzle-orm";
import { db } from "../../nucleo/db/cliente.ts";
import { sancao } from "../../nucleo/db/schema.ts";
import { buscarHttp } from "../busca/rede.ts";
import { limparCnpj } from "./cnpj.ts";

const CADASTROS = ["ceis", "cnep"] as const;
const VALIDADE_MS = 24 * 3600_000;

/** Lê o primeiro arquivo de um zip (deflate ou sem compressão), pelo diretório central. */
export function primeiroArquivoDoZip(zip: Uint8Array): Uint8Array {
  const b = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  let fim = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66_000); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new Error("Zip sem diretório central.");
  const cd = b.readUInt32LE(fim + 16);
  if (b.readUInt32LE(cd) !== 0x02014b50) throw new Error("Diretório central inválido.");
  const metodo = b.readUInt16LE(cd + 10);
  const tamanho = b.readUInt32LE(cd + 20);
  const local = b.readUInt32LE(cd + 42);
  if (b.readUInt32LE(local) !== 0x04034b50) throw new Error("Cabeçalho local inválido.");
  const inicio = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
  const dados = b.subarray(inicio, inicio + tamanho);
  if (metodo === 0) return dados;
  if (metodo === 8) return inflateRawSync(dados);
  throw new Error(`Compressão ${metodo} não suportada.`);
}

/** CSV com ";" e aspas, como o Portal publica. */
export function lerCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!;
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ";") {
      linha.push(campo);
      campo = "";
    } else if (ch === "\n") {
      linha.push(campo.replace(/\r$/, ""));
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += ch;
  }
  if (campo || linha.length) linhas.push([...linha, campo]);
  return linhas;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

async function baixarCadastro(cadastro: (typeof CADASTROS)[number]): Promise<{ base: string; linhas: string[][] } | null> {
  // O arquivo do dia sai no fim da tarde: tenta hoje e volta até 5 dias.
  for (let i = 0; i < 6; i++) {
    const data = ymd(new Date(Date.now() - i * 24 * 3600_000));
    try {
      const res = await buscarHttp(`https://portaldatransparencia.gov.br/download-de-dados/${cadastro}/${data}`, { timeoutMs: 60_000 });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("zip")) continue;
      const csv = new TextDecoder("latin1").decode(primeiroArquivoDoZip(new Uint8Array(await res.arrayBuffer())));
      return { base: `${data.slice(6)}/${data.slice(4, 6)}/${data.slice(0, 4)}`, linhas: lerCsv(csv) };
    } catch {
      // tenta o dia anterior
    }
  }
  return null;
}

let carregando: Promise<void> | null = null;

/** Atualiza as sanções se a base tiver mais de 1 dia. Falha não trava nada. */
export async function atualizarSancoes(forcar = false): Promise<void> {
  if (carregando) return carregando;
  carregando = (async () => {
    const [ultima] = await db.select({ em: sql<string | null>`max(${sancao.carregadoEm})` }).from(sancao);
    if (!forcar && ultima?.em && Date.now() - new Date(ultima.em).getTime() < VALIDADE_MS) return;
    for (const cadastro of CADASTROS) {
      const r = await baixarCadastro(cadastro);
      if (!r) continue;
      const [cab, ...dados] = r.linhas;
      if (!cab) continue;
      // Nome exato primeiro: "NOME INFORMADO PELO ÓRGÃO SANCIONADOR" também contém "ÓRGÃO SANCIONADOR".
      const col = (nome: string) => {
        const exata = cab.findIndex((c) => c.trim().toUpperCase() === nome);
        return exata >= 0 ? exata : cab.findIndex((c) => c.toUpperCase().includes(nome));
      };
      const iTipo = col("TIPO DE PESSOA");
      const iDoc = col("CPF OU CNPJ");
      const iNome = col("NOME DO SANCIONADO");
      const iCat = col("CATEGORIA DA SAN");
      const iIni = col("DATA INÍCIO SAN") >= 0 ? col("DATA INÍCIO SAN") : col("DATA IN");
      const iFim = col("DATA FINAL SAN");
      const iOrg = col("ÓRGÃO SANCIONADOR");
      const iUf = col("UF ÓRGÃO SANCIONADOR");
      const iEsf = col("ESFERA ÓRGÃO SANCIONADOR");
      const iAbr = col("ABRAG") >= 0 ? col("ABRAG") : col("ABRANG");
      const pj = dados.filter((l) => l[iTipo] === "J" && limparCnpj(l[iDoc] ?? "").length === 14);
      const valores = pj.map((l) => {
        const cnpj = limparCnpj(l[iDoc]!);
        const v = (i: number) => (i >= 0 ? l[i]?.trim() || null : null);
        return { cadastro: cadastro.toUpperCase(), cnpj, raiz: cnpj.slice(0, 8), nome: l[iNome] ?? "", categoria: v(iCat), orgao: v(iOrg), uf: v(iUf), esfera: v(iEsf), abrangencia: v(iAbr), inicio: v(iIni), fim: v(iFim), base: r.base };
      });
      await db.transaction(async (tx) => {
        await tx.delete(sancao).where(eq(sancao.cadastro, cadastro.toUpperCase()));
        for (let i = 0; i < valores.length; i += 1000) await tx.insert(sancao).values(valores.slice(i, i + 1000));
      });
      console.log(`[sanções] ${cadastro.toUpperCase()} de ${r.base}: ${valores.length} empresas.`);
    }
  })().finally(() => {
    carregando = null;
  });
  return carregando;
}

export type Sancao = typeof sancao.$inferSelect & { vigente: boolean; mesmaUnidade: boolean };

function vigente(fim: string | null, hoje = new Date()): boolean {
  if (!fim || /sem informa/i.test(fim)) return true;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fim);
  if (!m) return true;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T23:59:59`) >= hoje;
}

/** Sanções do CNPJ e de outras unidades da mesma empresa (mesma raiz). */
export async function sancoesDo(cnpj: string): Promise<{ base: string | null; sancoes: Sancao[] }> {
  const c = limparCnpj(cnpj);
  const linhas = await db
    .select()
    .from(sancao)
    .where(or(eq(sancao.cnpj, c), eq(sancao.raiz, c.slice(0, 8))));
  const [b] = await db.select({ base: sql<string | null>`max(${sancao.base})` }).from(sancao);
  return { base: b?.base ?? null, sancoes: linhas.map((l) => ({ ...l, vigente: vigente(l.fim), mesmaUnidade: l.cnpj === c })) };
}
