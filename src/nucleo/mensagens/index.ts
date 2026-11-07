// N4: entrada única de mensagens. Todo canal converte o que recebe em
// MensagemEntrada e chama receber(); toda saída passa por enviar(), que é o
// único lugar que fala com os canais e o único que confere o PARAR.

import { and, eq } from "drizzle-orm";
import { db } from "../db/cliente.ts";
import { contato, fornecedor, mensagem, type Anexo, type Canal } from "../db/schema.ts";
import { registrar } from "../registro.ts";
import { ehPedidoDeParar } from "./parar.ts";

export { ehPedidoDeParar } from "./parar.ts";
export type { Anexo, Canal } from "../db/schema.ts";

export type MensagemEntrada = {
  canal: Canal;
  /** Id da conversa no canal (chat_id, número, e-mail). */
  endereco: string;
  /** Id da mensagem no canal; repetida é ignorada. */
  idExterno?: string;
  texto: string;
  anexos?: Anexo[];
  /** Clique em botão: o dado do botão. */
  botao?: string;
  /** Nome que o canal mostra; não é obrigatório nem confiável. */
  nome?: string;
  /** Papel definido pelo canal (ex.: bot do comprador ou do fornecedor). Sem ele, contato novo é comprador. */
  papel?: "comprador" | "fornecedor";
  /** Deep link de cadastro do fornecedor (R5): token do /start. */
  convite?: string;
};

export type Botao = { rotulo: string; dado: string };
export type OpcoesEnvio = { botoes?: Botao[]; anexos?: Anexo[]; pedidoId?: number; itemPedidoId?: number };

/** Cada canal implementa isto (Telegram, WhatsApp simulado, e-mail, web...). */
export interface AdaptadorCanal {
  canal: Canal;
  enviar(endereco: string, texto: string, opcoes: OpcoesEnvio): Promise<{ idExterno?: string }>;
}

const adaptadores = new Map<Canal, AdaptadorCanal>();
export function registrarCanal(a: AdaptadorCanal) {
  adaptadores.set(a.canal, a);
}

export type Contato = typeof contato.$inferSelect;
export type MensagemRecebida = {
  contato: Contato;
  mensagemId: string;
  entrada: MensagemEntrada;
};

type Roteador = (m: MensagemRecebida) => Promise<void> | void;
let roteador: Roteador | null = null;
/** Quem decide o que fazer com a mensagem (comprador → Interpretador, fornecedor → Extrator...). */
export function aoReceber(fn: Roteador) {
  roteador = fn;
}

async function contatoDe(e: MensagemEntrada): Promise<Contato> {
  const [existente] = await db
    .select()
    .from(contato)
    .where(and(eq(contato.canal, e.canal), eq(contato.endereco, e.endereco)));
  if (existente) return existente;
  // Sem papel definido pelo canal, quem chega é comprador; o cadastro de fornecedor (R5) troca o papel.
  const [novo] = await db
    .insert(contato)
    .values({ canal: e.canal, endereco: e.endereco, papel: e.papel ?? "comprador", nome: e.nome })
    .onConflictDoUpdate({ target: [contato.canal, contato.endereco], set: { endereco: e.endereco } })
    .returning();
  return novo!;
}

export type ResultadoRecebimento =
  | { tipo: "repetida" }
  | { tipo: "parou"; contato: Contato }
  | { tipo: "recebida"; contato: Contato; mensagemId: string };

export async function receber(e: MensagemEntrada): Promise<ResultadoRecebimento> {
  const c = await contatoDe(e);
  const [gravada] = await db
    .insert(mensagem)
    .values({
      canal: e.canal,
      direcao: "entrada",
      contatoId: c.id,
      texto: e.texto,
      anexos: e.anexos ?? [],
      idExterno: e.idExterno,
      situacao: "recebida",
    })
    .onConflictDoNothing()
    .returning({ id: mensagem.id });
  if (!gravada) return { tipo: "repetida" };

  if (ehPedidoDeParar(e.texto)) {
    await marcarParou(c);
    return { tipo: "parou", contato: { ...c, parouEm: new Date() } };
  }

  // Quem tinha parado e volta a escrever reativa o próprio canal.
  if (c.parouEm) {
    await db.update(contato).set({ parouEm: null }).where(eq(contato.id, c.id));
    c.parouEm = null;
  }

  if (roteador) await roteador({ contato: c, mensagemId: gravada.id, entrada: e });
  return { tipo: "recebida", contato: c, mensagemId: gravada.id };
}

async function marcarParou(c: Contato) {
  const agora = new Date();
  await db.update(contato).set({ parouEm: agora }).where(eq(contato.id, c.id));
  if (c.fornecedorId) {
    await db.update(fornecedor).set({ parouEm: agora }).where(eq(fornecedor.id, c.fornecedorId));
  }
  await registrar(db, {
    agente: c.papel === "fornecedor" ? "Fornecedor" : "Comprador",
    acao: "Pediu para parar de receber mensagens.",
    motivo: "Respondeu PARAR. Nada mais é enviado a este contato, em nenhum canal.",
    fornecedorIds: c.fornecedorId ? [c.fornecedorId] : undefined,
  });
}

/** Bloqueado se o contato parou, ou se é fornecedor que parou em qualquer canal. */
export async function podeEnviar(contatoId: string): Promise<boolean> {
  const [linha] = await db
    .select({ parouContato: contato.parouEm, parouFornecedor: fornecedor.parouEm })
    .from(contato)
    .leftJoin(fornecedor, eq(fornecedor.id, contato.fornecedorId))
    .where(eq(contato.id, contatoId));
  if (!linha) return false;
  return !linha.parouContato && !linha.parouFornecedor;
}

export type ResultadoEnvio = { situacao: "enviada" | "bloqueada_parar" | "falhou"; mensagemId: string; erro?: string };

/** Único ponto de saída para qualquer canal. */
export async function enviar(contatoId: string, texto: string, opcoes: OpcoesEnvio = {}): Promise<ResultadoEnvio> {
  const [c] = await db.select().from(contato).where(eq(contato.id, contatoId));
  if (!c) throw new Error(`Contato ${contatoId} não existe.`);

  const base = {
    canal: c.canal,
    direcao: "saida" as const,
    contatoId,
    texto,
    anexos: opcoes.anexos ?? [],
    botoes: opcoes.botoes,
    pedidoId: opcoes.pedidoId,
    itemPedidoId: opcoes.itemPedidoId,
  };

  if (!(await podeEnviar(contatoId))) {
    const [m] = await db.insert(mensagem).values({ ...base, situacao: "bloqueada_parar" }).returning({ id: mensagem.id });
    return { situacao: "bloqueada_parar", mensagemId: m!.id };
  }

  const adaptador = adaptadores.get(c.canal);
  if (!adaptador) {
    const erro = `Nenhum adaptador registrado para o canal ${c.canal}.`;
    const [m] = await db.insert(mensagem).values({ ...base, situacao: "falhou", erro }).returning({ id: mensagem.id });
    return { situacao: "falhou", mensagemId: m!.id, erro };
  }

  try {
    const { idExterno } = await adaptador.enviar(c.endereco, texto, opcoes);
    const [m] = await db
      .insert(mensagem)
      .values({ ...base, situacao: "enviada", idExterno })
      .returning({ id: mensagem.id });
    return { situacao: "enviada", mensagemId: m!.id };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    const [m] = await db.insert(mensagem).values({ ...base, situacao: "falhou", erro }).returning({ id: mensagem.id });
    return { situacao: "falhou", mensagemId: m!.id, erro };
  }
}

/** Canal em memória para testes e para o fornecedor simulado (Q3). */
export function canalEmMemoria(canal: Canal = "simulado") {
  const enviadas: { endereco: string; texto: string; opcoes: OpcoesEnvio }[] = [];
  const adaptador: AdaptadorCanal = {
    canal,
    async enviar(endereco, texto, opcoes) {
      enviadas.push({ endereco, texto, opcoes });
      return { idExterno: `mem-${enviadas.length}` };
    },
  };
  return { adaptador, enviadas };
}
