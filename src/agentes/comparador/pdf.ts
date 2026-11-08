// Q1: o mapa de cotação em PDF, para anexar ao mapa (Telegram, e-mail) e baixar na
// tela. Sai dos mesmos dados do mapa (mapa_cotacao.dados e a recomendação), sem conta
// nova. Sem dependência: o PDF é montado à mão (como src/simulador/pdf.ts), com várias
// páginas, Helvetica e Helvetica-Bold (WinAnsi, que cobre os acentos do português) e
// quebra de linha pela largura real das letras.
//
// Este módulo é carregado pela tela (rota de download): nada de ler arquivo pelo
// import.meta.url aqui.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, count, desc, eq } from "drizzle-orm";
import { EMPRESA } from "../../config.ts";
import { PASTA_ARQUIVOS } from "../../nucleo/arquivos.ts";
import { db } from "../../nucleo/db/cliente.ts";
import { cotacao, itemPedido, mapaCotacao, pedido, type Anexo } from "../../nucleo/db/schema.ts";
import { dias, quantidade } from "../../texto.ts";
import { formatarBRL, formatarNota, MINIMO_PROPOSTAS_VALIDAS, textoFrete, type Comparacao, type Linha } from "./calculo.ts";

// ---------- Escrita do PDF ----------

/** Larguras da Helvetica (1/1000 do corpo), do espaço (32) ao til (126). */
const LARGURAS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Caracteres fora do Latin-1 que o WinAnsi tem (0x80 a 0x9F). */
const WIN_ANSI: Record<string, number> = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99 };

/** Um caractere em WinAnsi: Latin-1 direto, os especiais pela tabela, o resto pela letra sem acento ou "?". */
function byteWinAnsi(ch: string): number {
  if (ch in WIN_ANSI) return WIN_ANSI[ch]!;
  const c = ch.codePointAt(0)!;
  if (c === 9) return 32;
  if ((c >= 32 && c <= 126) || (c >= 0xa0 && c <= 0xff)) return c;
  const base = ch.normalize("NFD")[0]!.codePointAt(0)!;
  return base >= 32 && base <= 126 ? base : 63;
}

const larguraDoByte = (b: number): number => {
  if (b >= 32 && b <= 126) return LARGURAS[b - 32]!;
  if (b === 0xa0 || b === 0xb7) return 278;
  // Letra acentuada: a largura da letra sem acento.
  const base = String.fromCharCode(b).normalize("NFD").codePointAt(0)!;
  return base >= 32 && base <= 126 ? LARGURAS[base - 32]! : 600;
};

/** Largura do texto em pontos. Negrito é um pouco mais largo: a margem evita estourar. */
export function larguraTexto(texto: string, tamanho: number, negrito = false): number {
  let soma = 0;
  for (const ch of texto) soma += larguraDoByte(byteWinAnsi(ch));
  return (soma * tamanho * (negrito ? 1.08 : 1)) / 1000;
}

/** Quebra em linhas que cabem na largura; palavra maior que a linha (um link) é cortada. */
export function quebrar(texto: string, largura: number, tamanho: number, negrito = false): string[] {
  const linhas: string[] = [];
  for (const paragrafo of texto.split("\n")) {
    let atual = "";
    for (let palavra of paragrafo.split(/ +/)) {
      while (larguraTexto(palavra, tamanho, negrito) > largura) {
        if (atual) {
          linhas.push(atual);
          atual = "";
        }
        let corte = palavra.length;
        while (corte > 1 && larguraTexto(palavra.slice(0, corte), tamanho, negrito) > largura) corte--;
        linhas.push(palavra.slice(0, corte));
        palavra = palavra.slice(corte);
      }
      const junto = atual ? `${atual} ${palavra}` : palavra;
      if (larguraTexto(junto, tamanho, negrito) <= largura) atual = junto;
      else {
        linhas.push(atual);
        atual = palavra;
      }
    }
    linhas.push(atual);
  }
  return linhas;
}

/** Texto como string literal do PDF: bytes WinAnsi, com \ ( ) escapados. */
function literal(texto: string): string {
  let s = "";
  for (const ch of texto) {
    const b = byteWinAnsi(ch);
    s += b === 0x5c || b === 0x28 || b === 0x29 ? `\\${String.fromCharCode(b)}` : String.fromCharCode(b);
  }
  return `(${s})`;
}

export type Bloco =
  | { texto: string; tamanho?: number; negrito?: boolean; recuo?: number; antes?: number; cinza?: boolean }
  | { regua: true; antes?: number };

const A4 = { largura: 595, altura: 842 };
const MARGEM = 50;
const RODAPE = 50;

/**
 * PDF de texto corrido em A4, com quantas páginas forem precisas e um rodapé com
 * "página X de Y". Função pura: os testes leem os mesmos bytes que o comprador recebe.
 */
export function documentoPdf(blocos: readonly Bloco[], a: { titulo: string; rodape: string }): Uint8Array {
  const paginas: string[][] = [[]];
  let y = A4.altura - MARGEM;
  const util = A4.largura - 2 * MARGEM;
  const novaPagina = () => {
    paginas.push([]);
    y = A4.altura - MARGEM;
  };
  for (const b of blocos) {
    const antes = b.antes ?? 0;
    if ("regua" in b) {
      y -= antes + 4;
      if (y < RODAPE + 10) novaPagina();
      paginas.at(-1)!.push(`0.75 G 0.5 w ${MARGEM} ${y.toFixed(1)} m ${A4.largura - MARGEM} ${y.toFixed(1)} l S 0 G`);
      y -= 6;
      continue;
    }
    const tamanho = b.tamanho ?? 10;
    const altura = tamanho * 1.35;
    const recuo = b.recuo ?? 0;
    y -= antes;
    for (const linha of quebrar(b.texto, util - recuo, tamanho, b.negrito)) {
      if (y - altura < RODAPE) novaPagina();
      y -= altura;
      if (!linha) continue;
      paginas.at(-1)!.push(`BT ${b.cinza ? "0.35" : "0"} g /${b.negrito ? "F2" : "F1"} ${tamanho} Tf ${MARGEM + recuo} ${(y + tamanho * 0.25).toFixed(1)} Td ${literal(linha)} Tj ET`);
    }
  }

  const total = paginas.length;
  const objetos: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "", // páginas, preenchido abaixo
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Title ${literal(a.titulo)} /Producer (kotala) >>`,
  ];
  const kids: string[] = [];
  paginas.forEach((ops, i) => {
    const rodape = `BT 0.35 g /F1 8 Tf ${MARGEM} 30 Td ${literal(`${a.rodape} · página ${i + 1} de ${total}`)} Tj ET`;
    const conteudo = [...ops, rodape].join("\n");
    const idPagina = objetos.length + 1;
    kids.push(`${idPagina} 0 R`);
    objetos.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.largura} ${A4.altura}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idPagina + 1} 0 R >>`);
    objetos.push(`<< /Length ${Buffer.byteLength(conteudo, "latin1")} >>\nstream\n${conteudo}\nendstream`);
  });
  objetos[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${total} >>`;

  let corpo = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const posicoes: number[] = [];
  objetos.forEach((o, i) => {
    posicoes.push(Buffer.byteLength(corpo, "latin1"));
    corpo += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(corpo, "latin1");
  corpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${posicoes.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
  corpo += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(corpo, "latin1"));
}

// ---------- O mapa ----------

export type EntradaPdfMapa = {
  empresa: string;
  pedido: { id: number; destino: string | null; cep: string | null; modoEntrega: "entrega" | "retirada" | null; prazoTexto: string | null; urgencia: string; pagamentoPreferido: string | null; setor: string | null };
  item: { id: number; descricao: string; quantidade: string | number; unidade: string; justificativaMenosDeTres: string | null };
  rodada: number;
  comparacao: Comparacao;
  recomendacao: string;
  /** Fornecedores consultados na rodada (cotações enviadas). */
  consultados: number;
  /** Quando o mapa foi montado. */
  mapaEm: Date;
};

const dataHora = (d: Date) =>
  d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

const nomeComSelo = (l: Linha) => `${l.oferta.fornecedorNome}${l.oferta.simulado ? " (simulado)" : l.oferta.online ? " (loja online)" : ""}`;

const URGENCIA: Record<string, string> = { normal: "sem urgência", urgente: "urgente", parada: "operação parada" };

/** O conteúdo do PDF: o que o mapa do chat diz, organizado em seções. */
export function blocosDoMapa(e: EntradaPdfMapa): Bloco[] {
  const c = e.comparacao;
  const recebidas = c.validas.length + c.cortadas.length;
  const b: Bloco[] = [
    { texto: "Mapa de cotação", tamanho: 18, negrito: true },
    { texto: e.empresa, cinza: true },
    { regua: true, antes: 4 },
    { texto: `Pedido ${e.pedido.id}${e.pedido.setor ? ` · setor ${e.pedido.setor}` : ""} · cotação ${e.item.id}${e.rodada > 1 ? ` · rodada ${e.rodada}` : ""}`, negrito: true, tamanho: 12, antes: 4 },
    { texto: `${quantidade(e.item.quantidade, e.item.unidade)} de ${e.item.descricao}`, tamanho: 12 },
    {
      texto: [
        e.pedido.modoEntrega === "retirada" ? "Retirada na loja" : `Entrega: ${e.pedido.destino ?? "a combinar"}${e.pedido.cep ? ` (CEP ${e.pedido.cep})` : ""}`,
        e.pedido.prazoTexto ? `prazo: ${e.pedido.prazoTexto}` : null,
        URGENCIA[e.pedido.urgencia] ?? e.pedido.urgencia,
      ]
        .filter(Boolean)
        .join(" · "),
      antes: 2,
    },
    { texto: `Mapa montado em ${dataHora(e.mapaEm)}.`, cinza: true },
    { regua: true, antes: 6 },
    {
      texto: `Propostas válidas: ${c.validas.length} de ${recebidas} ${recebidas === 1 ? "recebida" : "recebidas"} (${e.consultados} ${e.consultados === 1 ? "fornecedor consultado" : "fornecedores consultados"})`,
      negrito: true,
      tamanho: 12,
      antes: 6,
    },
  ];
  if (e.pedido.pagamentoPreferido) b.push({ texto: `Pagamento preferido: ${e.pedido.pagamentoPreferido}. Cada proposta mostra a forma que o fornecedor aceita.`, cinza: true });
  if (!c.validas.length) b.push({ texto: "Nenhuma proposta passou nas regras do mapa.", antes: 4 });
  c.validas.forEach((l, i) => {
    const o = l.oferta;
    const recomendada = i === 0 && c.vencedora?.oferta.id === o.id;
    const total = l.origemFrete === "a_calcular" ? "Total estimado" : "Total";
    b.push({ texto: `${i + 1}. ${nomeComSelo(l)}${recomendada ? (c.podeDizerMelhor ? " · recomendada" : " · na frente") : ""}`, negrito: true, antes: 8 });
    b.push({ texto: `Unitário ${l.precoUnitarioEfetivo !== null ? formatarBRL(l.precoUnitarioEfetivo) : "não informado"} · ${total} ${formatarBRL(l.custo!)}`, recuo: 14 });
    b.push({ texto: `Produto ${formatarBRL(l.produto!)} + ${textoFrete(l)}${l.impostos ? ` + impostos ${formatarBRL(l.impostos)}` : ""}`, recuo: 14 });
    b.push({
      texto: [
        `Entrega em ${o.prazoDias !== null ? dias(o.prazoDias) : "prazo não informado"}`,
        `pagamento: ${o.pagamento ?? "não informado"}`,
        o.validadeDias !== null ? `validade ${dias(o.validadeDias)}` : "sem validade",
        `nota ${formatarNota(l.nota!)}`,
      ].join(" · "),
      recuo: 14,
    });
    if (l.negociacao) b.push({ texto: l.negociacao, recuo: 14 });
    if (!o.itemExato) b.push({ texto: `Equivalente: ${o.itemOferecido}`, recuo: 14 });
    if (o.online && o.fonte && !/google\.[a-z.]+\/search/.test(o.fonte)) b.push({ texto: `Anúncio: ${o.fonte}`, recuo: 14, cinza: true });
    if (l.alertas.length) b.push({ texto: `Atenção: ${l.alertas.join("; ")}`, recuo: 14, cinza: true });
  });

  const aConfirmar = c.cortadas.filter((l) => l.aConfirmar);
  const fora = c.cortadas.filter((l) => !l.aConfirmar);
  const cortada = (l: Linha): Bloco => ({ texto: `• ${nomeComSelo(l)}${l.custo !== null ? ` (${formatarBRL(l.custo)})` : ""}: ${l.motivos.join("; ")}`, recuo: 8, antes: 3 });
  if (aConfirmar.length) b.push({ texto: "A confirmar com o fornecedor (fora do ranking até responder)", negrito: true, tamanho: 12, antes: 12 }, ...aConfirmar.map(cortada));
  if (fora.length) b.push({ texto: "Fora da comparação, e por quê", negrito: true, tamanho: 12, antes: 12 }, ...fora.map(cortada));

  b.push({ regua: true, antes: 10 }, { texto: "Recomendação", negrito: true, tamanho: 12, antes: 6 });
  if (c.vencedora) b.push({ texto: `${c.podeDizerMelhor ? "Recomendo" : "Na frente"}: ${nomeComSelo(c.vencedora)}, ${formatarBRL(c.vencedora.custo!)}.`, negrito: true, antes: 2 });
  b.push({ texto: e.recomendacao, antes: 2 });
  if (c.aMaisQueAMaisBarata > 0) b.push({ texto: `Custa ${formatarBRL(c.aMaisQueAMaisBarata)} a mais que a mais barata.`, antes: 2 });
  if (e.item.justificativaMenosDeTres) b.push({ texto: e.item.justificativaMenosDeTres, antes: 4 });
  else if (c.validas.length && c.validas.length < MINIMO_PROPOSTAS_VALIDAS) b.push({ texto: c.alertasGerais.join(" "), antes: 4 });
  b.push({
    texto: `Pesos da nota: preço ${c.pesos.preco}, prazo ${c.pesos.prazo}, confiança ${c.pesos.confianca}, aderência ${c.pesos.aderencia}, pagamento ${c.pesos.pagamento}${c.urgente ? " (prazo em dobro: pedido urgente)" : ""}. As contas são do código; o assistente só redige a justificativa.`,
    cinza: true,
    antes: 6,
  });
  return b;
}

export function pdfDoMapa(e: EntradaPdfMapa): Uint8Array {
  return documentoPdf(blocosDoMapa(e), {
    titulo: `Mapa de cotação · pedido ${e.pedido.id} · ${e.item.descricao}`,
    rodape: `${e.empresa} · mapa de cotação do pedido ${e.pedido.id}, cotação ${e.item.id}, gerado em ${dataHora(e.mapaEm)}`,
  });
}

/** "mapa-pedido-12-cotacao-34-rodada-1.pdf" */
export const nomeArquivoMapa = (pedidoId: number, itemPedidoId: number, rodada: number) => `mapa-pedido-${pedidoId}-cotacao-${itemPedidoId}-rodada-${rodada}.pdf`;

// ---------- Do banco ----------

/** Entrada do PDF a partir do último mapa do item (o mesmo que a tela e a decisão leem). Null sem mapa. */
export async function entradaPdfDoItem(itemPedidoId: number): Promise<EntradaPdfMapa | null> {
  const [l] = await db.select({ item: itemPedido, pedido }).from(itemPedido).innerJoin(pedido, eq(pedido.id, itemPedido.pedidoId)).where(eq(itemPedido.id, itemPedidoId));
  if (!l) return null;
  const [m] = await db.select().from(mapaCotacao).where(eq(mapaCotacao.itemPedidoId, itemPedidoId)).orderBy(desc(mapaCotacao.criadoEm)).limit(1);
  if (!m) return null;
  const [n] = await db
    .select({ n: count() })
    .from(cotacao)
    .where(and(eq(cotacao.itemPedidoId, itemPedidoId), eq(cotacao.rodada, m.rodada)));
  const { item, pedido: p } = l;
  return {
    empresa: EMPRESA.nome,
    pedido: { id: p.id, destino: p.destino, cep: p.cep, modoEntrega: p.modoEntrega, prazoTexto: p.prazoTexto, urgencia: p.urgencia, pagamentoPreferido: p.pagamentoPreferido, setor: p.setor },
    item: { id: item.id, descricao: item.descricao, quantidade: item.quantidade, unidade: item.unidade, justificativaMenosDeTres: m.rodada === item.rodada ? item.justificativaMenosDeTres : null },
    rodada: m.rodada,
    comparacao: m.dados as Comparacao,
    recomendacao: m.recomendacao,
    consultados: n?.n ?? 0,
    mapaEm: m.criadoEm,
  };
}

/**
 * Grava o PDF do último mapa do item em dados/arquivos/mapas e devolve o anexo para
 * enviar() (caminho local: o Telegram sobe o arquivo, o e-mail lê do disco). Null sem mapa.
 */
export async function anexoPdfDoMapa(itemPedidoId: number): Promise<Anexo | null> {
  const e = await entradaPdfDoItem(itemPedidoId);
  if (!e) return null;
  const dados = pdfDoMapa(e);
  const pasta = join(PASTA_ARQUIVOS(), "mapas");
  await mkdir(pasta, { recursive: true });
  const nome = nomeArquivoMapa(e.pedido.id, e.item.id, e.rodada);
  // Um arquivo por versão do mapa: o mapa refeito na mesma rodada não sobrescreve o anterior.
  const caminho = join(pasta, `${e.mapaEm.getTime()}-${nome}`);
  await writeFile(caminho, dados);
  return { tipo: "pdf", mediaType: "application/pdf", ref: caminho, nome, tamanho: dados.length };
}
