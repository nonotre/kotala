// Canal de e-mail (E1). Só envia: responder pelo próprio e-mail fica para o E2.
// Trava de segurança: nenhum fornecedor de verdade recebe e-mail por acaso.
// Só sai e-mail para (a) endereços em EMAIL_PERMITIDOS ou (b) endereços que
// alguém digitou no convite manual (fornecedor com fonte FONTE_CONVITE_MANUAL).
// Qualquer outro endereço falha no envio, e enviar() grava a falha com o motivo.

import { and, eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import nodemailer from "nodemailer";
import { EMPRESA } from "../config.ts";
import { arquivoGuardado } from "../nucleo/arquivos.ts";
import { db } from "../nucleo/db/cliente.ts";
import { contato, fornecedor } from "../nucleo/db/schema.ts";
import type { AdaptadorCanal, Anexo } from "../nucleo/mensagens/index.ts";

/** Fonte gravada no fornecedor criado pelo convite manual (a banca, o time). */
export const FONTE_CONVITE_MANUAL = "Convite manual por e-mail";

export type Transporte = {
  sendMail(m: { from: string; to: string; subject: string; text: string; attachments?: { filename: string; content: Buffer; contentType?: string }[] }): Promise<{ messageId?: string }>;
};

export const normalizarEmail = (e: string) => e.trim().toLowerCase();
export const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

const permitidosDoAmbiente = () =>
  new Set(
    // EMAIL_FORNECEDOR_TESTE: o endereço que recebe a cópia de teste das mensagens a fornecedor.
    [process.env.EMAIL_PERMITIDOS ?? "", process.env.EMAIL_FORNECEDOR_TESTE ?? ""]
      .join(",")
      .split(",")
      .map(normalizarEmail)
      .filter(Boolean),
  );

/** Pode receber e-mail: está na lista do .env ou foi digitado num convite manual. */
export async function emailLiberado(endereco: string): Promise<boolean> {
  const e = normalizarEmail(endereco);
  if (permitidosDoAmbiente().has(e)) return true;
  const [f] = await db
    .select({ id: fornecedor.id })
    .from(fornecedor)
    .where(and(eq(fornecedor.email, e), eq(fornecedor.fonte, FONTE_CONVITE_MANUAL)))
    .limit(1);
  return !!f;
}

/** Link pessoal do bot do fornecedor. O usuário do bot vem do getMe (ver usuarioDoBot em canais/telegram.ts). */
export const linkConvite = (usuarioBot: string, codigo: string) => `https://t.me/${usuarioBot}?start=${codigo}`;

let transportePadrao: Transporte | null = null;
function transporteGmail(): Transporte {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new Error("E-mail não configurado: defina SMTP_USER e SMTP_PASS no .env.");
  transportePadrao ??= nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  return transportePadrao;
}

const remetente = () => `"${process.env.EMAIL_REMETENTE_NOME ?? `Cotações ${EMPRESA.nome}`}" <${process.env.SMTP_USER ?? ""}>`;

/** Rodapé de toda mensagem a fornecedor: como responder (pelo bot) e por que recebeu. */
async function rodapeFornecedor(endereco: string, usuarioBot: string | undefined): Promise<string> {
  const [l] = await db
    .select({ codigo: fornecedor.codigoConvite })
    .from(contato)
    .innerJoin(fornecedor, eq(fornecedor.id, contato.fornecedorId))
    .where(and(eq(contato.canal, "email"), eq(contato.endereco, normalizarEmail(endereco))))
    .limit(1);
  const linhas = ["", "—"];
  if (l?.codigo && usuarioBot) {
    linhas.push(`Para responder, abra a conversa no Telegram: ${linkConvite(usuarioBot, l.codigo)}`);
  }
  linhas.push(
    "Respostas a este e-mail ainda não são lidas.",
    `Mensagem automática do assistente de compras da ${EMPRESA.nome}. Se não quiser receber mais nada, escreva ENCERRAR CONTATO no Telegram ou ignore este e-mail.`,
  );
  return linhas.join("\n");
}

/** E-mail de teste: só o fornecedor, a cotação e o link do bot. Toda a conversa segue no Telegram. */
export function textoLinkTeste(l: { fornecedor: string; codigo: string; cotacao: string }, usuarioBot: string | undefined): string {
  return [
    `FORNECEDOR: ${l.fornecedor}`,
    l.cotacao,
    "",
    usuarioBot
      ? `Para responder como ${l.fornecedor}, abra este link no Telegram e toque em Iniciar:\n${linkConvite(usuarioBot, l.codigo)}`
      : `Bot do fornecedor sem usuário configurado; código do convite: ${l.codigo}`,
    "",
    "A conversa toda (cotação, desconto, pedido de compra) acontece no Telegram. Este e-mail só traz o link.",
    "Abrir o link de outro fornecedor troca a conversa para ele; o anterior volta a responder sozinho.",
    `E-mail de teste do assistente de compras da ${EMPRESA.nome}.`,
  ].join("\n");
}

export type OpcoesEmail = {
  /** Para os testes; sem ele, usa o Gmail com senha de app. */
  transporte?: Transporte;
  /** Usuário do bot do fornecedor, para o link no rodapé. */
  usuarioBot?: string;
};

/** Anexo de saída: caminho local ou arquivo já guardado (recebido pelo Telegram). Sem conteúdo, fica de fora. */
async function anexosDoEmail(anexos: Anexo[]) {
  const lista: NonNullable<Parameters<Transporte["sendMail"]>[0]["attachments"]> = [];
  const faltaram: string[] = [];
  for (const a of anexos) {
    const nome = a.nome ?? a.ref.split("/").pop() ?? "anexo";
    let dados: Uint8Array | null = null;
    if (a.ref.startsWith("/")) dados = await readFile(a.ref).catch(() => null);
    else dados = (await arquivoGuardado("telegram", a.ref))?.dados ?? null;
    if (dados) lista.push({ filename: nome, content: Buffer.from(dados), contentType: a.mediaType });
    else faltaram.push(nome);
  }
  return { lista, faltaram };
}

/** Q1: o mapa de cotação vai com o PDF anexado (nome gerado por nomeArquivoMapa, em agentes/comparador/pdf.ts). */
const ehMapa = (anexos: Anexo[] | undefined) => !!anexos?.some((a) => a.mediaType === "application/pdf" && a.nome?.startsWith("mapa-pedido-"));

/** E-mail não tem botão: as opções viram lista de texto, e a resposta é pelo Telegram. */
const opcoesEmTexto = (botoes: { rotulo: string }[]) => ["", "Opções:", ...botoes.map((b) => `- ${b.rotulo}`), "Para escolher, responda pela conversa no Telegram."].join("\n");

export function adaptadorEmail(op: OpcoesEmail = {}): AdaptadorCanal {
  return {
    canal: "email",
    async enviar(endereco, texto, opcoes) {
      if (!(await emailLiberado(endereco))) {
        throw new Error(`E-mail bloqueado: ${endereco} não está em EMAIL_PERMITIDOS nem veio de um convite manual.`);
      }
      const t = op.transporte ?? transporteGmail();
      const assunto =
        opcoes.tipo === "convite"
          ? `Convite para cotações · ${EMPRESA.nome}`
          : opcoes.tipo === "cotacao"
          ? `Pedido de cotação${opcoes.itemPedidoId ? ` ${opcoes.itemPedidoId}` : ""} · ${EMPRESA.nome}`
          : opcoes.tipo === "lembrete"
            ? `Lembrete de cotação · ${EMPRESA.nome}`
            : opcoes.tipo === "pedido_compra"
              ? `Pedido de compra${opcoes.itemPedidoId ? ` · cotação ${opcoes.itemPedidoId}` : ""} · ${EMPRESA.nome}`
              : ehMapa(opcoes.anexos)
                ? `Mapa de cotação${opcoes.pedidoId ? ` · pedido ${opcoes.pedidoId}` : ""} · ${EMPRESA.nome}`
                : `Mensagem de ${EMPRESA.nome}`;
      const assuntoFinal = opcoes.linkTeste ? `[${opcoes.linkTeste.fornecedor}] Responda como este fornecedor pelo Telegram (teste)` : assunto;
      // O convite já traz o link e o aviso no corpo.
      const { lista, faltaram } = await anexosDoEmail(opcoes.anexos ?? []);
      const completo =
        texto +
        (opcoes.botoes?.length ? opcoesEmTexto(opcoes.botoes) : "") +
        (faltaram.length ? `\n\nNão consegui anexar: ${faltaram.join(", ")}.` : "");
      // A cópia de teste não leva o rodapé do fornecedor (o link pessoal é dele, não de quem testa).
      const corpo = opcoes.linkTeste
        ? textoLinkTeste(opcoes.linkTeste, op.usuarioBot)
        : opcoes.tipo === "convite"
          ? completo
          : completo + (await rodapeFornecedor(endereco, op.usuarioBot));
      const r = await t.sendMail({ from: remetente(), to: normalizarEmail(endereco), subject: assuntoFinal, text: corpo, ...(lista.length ? { attachments: lista } : {}) });
      return { idExterno: r.messageId };
    },
  };
}
