// N4: entrada única de mensagens. Todo canal converte o que recebe em
// MensagemEntrada e chama receber(); toda saída passa por enviar(), que é o
// único lugar que fala com os canais e o único que confere o PARAR.

import { mascararDadosPessoais } from "../../agentes/guardrail/index.ts";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/cliente.ts";
import { contato, fornecedor, itemPedido, mensagem, type Anexo, type Canal } from "../db/schema.ts";
import { randomBytes } from "node:crypto";
import { registrar } from "../registro.ts";
import { arquivoGuardado, salvarArquivo } from "../arquivos.ts";
import { htmlParaTexto } from "../../texto.ts";
import { ehEncerrarContato, ehPedidoDeParar } from "./parar.ts";

export { ehEncerrarContato, ehPedidoDeParar } from "./parar.ts";

/**
 * PARAR de fornecedor com cotação aberta: quem o fluxo registrar aqui tira ele só dessas
 * cotações e devolve true; false (nada aberto) deixa o PARAR valer para tudo, como antes.
 * "Encerrar contato" nunca passa por aqui.
 */
type SaidaDaCotacao = (c: Contato, mensagemId: string) => Promise<boolean>;
let saidaDaCotacao: SaidaDaCotacao | null = null;
export function aoPararNaCotacao(fn: SaidaDaCotacao) {
  saidaDaCotacao = fn;
}
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
  /** Id, no canal, da mensagem em que o botão foi clicado (para editá-la em vez de mandar outra). */
  mensagemRef?: string;
};

/** Cor sugerida do botão; canais que não entendem ignoram. */
export type EstiloBotao = "sucesso" | "perigo" | "primario";
export type Botao = { rotulo: string; dado: string; estilo?: EstiloBotao };
/** Para que serve a mensagem de saída; o simulador de fornecedor reage por aqui. */
export type TipoEnvio = "cotacao" | "lembrete" | "resposta" | "pedido_compra" | "nao_venceu" | "encerrada" | "aviso" | "convite" | "negociacao" | "confirmar_preco" | "proposta_recebida" | "completar_proposta";
export type OpcoesEnvio = {
  botoes?: Botao[];
  anexos?: Anexo[];
  pedidoId?: number;
  itemPedidoId?: number;
  tipo?: TipoEnvio;
  /** "html": o texto foi montado com os helpers de src/texto.ts. Canais sem HTML recebem texto simples. */
  formato?: "html";
  /** idExterno de uma mensagem anterior a editar no lugar de mandar outra (se o canal souber). */
  substitui?: string;
  /** Teste pelo Telegram (EMAIL_FORNECEDOR_TESTE): e-mail só com o link pessoal do bot para responder como este fornecedor. */
  linkTeste?: { fornecedor: string; codigo: string; cotacao: string };
};

/** Cada canal implementa isto (Telegram, WhatsApp simulado, e-mail, web...). */
export interface AdaptadorCanal {
  canal: Canal;
  /** Entende `formato: "html"`; sem isto o texto chega simples. */
  suportaHtml?: boolean;
  enviar(endereco: string, texto: string, opcoes: OpcoesEnvio): Promise<{ idExterno?: string }>;
  /** Baixa um anexo recebido (PDF, foto, áudio) pelo id do canal. */
  baixar?(ref: string): Promise<{ dados: Uint8Array; mediaType?: string }>;
}

const adaptadores = new Map<Canal, AdaptadorCanal>();
export function registrarCanal(a: AdaptadorCanal) {
  adaptadores.set(a.canal, a);
}

/**
 * Baixa o anexo (até 20 MB, o limite do Telegram para bots) e guarda o original
 * em disco com hash. Se já foi guardado, lê do disco sem baixar de novo.
 */
export async function baixarAnexo(canal: Canal, anexo: Anexo, mensagemId?: string) {
  const guardado = await arquivoGuardado(canal, anexo.ref);
  if (guardado) return guardado;
  const a = adaptadores.get(canal);
  if (!a?.baixar) throw new Error(`O canal ${canal} não baixa anexos.`);
  if (anexo.tamanho && anexo.tamanho > 20 * 1024 * 1024) throw new Error("Anexo maior que 20 MB.");
  const r = await a.baixar(anexo.ref);
  const mediaType = anexo.mediaType || r.mediaType || "application/octet-stream";
  await salvarArquivo({ dados: r.dados, mediaType, canal, ref: anexo.ref, nome: anexo.nome, mensagemId }).catch((e) => console.error("[arquivos]", e));
  return { dados: r.dados, mediaType };
}

/** Liga uma mensagem recebida ao pedido e ao item, depois que o fluxo descobriu a qual pertence. */
export async function vincularMensagem(mensagemId: string, alvo: { pedidoId?: number; itemPedidoId?: number }) {
  await db.update(mensagem).set(alvo).where(eq(mensagem.id, mensagemId));
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
      // S: CPF, cartão e senha do comprador não ficam guardados; o roteador ainda recebe o texto
      // original em memória, para a triagem avisar que o dado não é necessário.
      texto: c.papel === "comprador" ? mascararDadosPessoais(e.texto).texto : e.texto,
      anexos: e.anexos ?? [],
      idExterno: e.idExterno,
      situacao: "recebida",
    })
    .onConflictDoNothing()
    .returning({ id: mensagem.id });
  if (!gravada) return { tipo: "repetida" };

  if (ehPedidoDeParar(e.texto)) {
    if (c.papel === "fornecedor" && !ehEncerrarContato(e.texto) && saidaDaCotacao && (await saidaDaCotacao(c, gravada.id))) {
      return { tipo: "recebida", contato: c, mensagemId: gravada.id };
    }
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

/** PARAR detectado por outro caminho (ex.: o Extrator classificou a resposta como "parar"). */
export async function marcarParouContato(contatoId: string) {
  const [c] = await db.select().from(contato).where(eq(contato.id, contatoId));
  if (c && !c.parouEm) await marcarParou(c);
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

/** Canal ativo do fornecedor: Telegram primeiro, depois qualquer outro que não parou. */
export async function contatoAtivoDoFornecedor(fornecedorId: string) {
  const lista = await db
    .select()
    .from(contato)
    .where(and(eq(contato.fornecedorId, fornecedorId), isNull(contato.parouEm)));
  return lista.find((c) => c.canal === "telegram") ?? lista[0] ?? null;
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

  // O registro guarda sempre texto simples (a tela web e o rastro não leem HTML).
  const simples = opcoes.formato === "html" ? htmlParaTexto(texto) : texto;
  const base = {
    canal: c.canal,
    direcao: "saida" as const,
    contatoId,
    texto: simples,
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
    const html = opcoes.formato === "html" && adaptador.suportaHtml;
    const { idExterno } = await adaptador.enviar(c.endereco, html ? texto : simples, html ? opcoes : { ...opcoes, formato: undefined });
    const [m] = await db
      .insert(mensagem)
      .values({ ...base, situacao: "enviada", idExterno })
      .returning({ id: mensagem.id });
    if (c.papel === "fornecedor" && opcoes.tipo === "cotacao" && c.canal !== "telegram" && c.canal !== "email") void linkDeTestePorEmail(c, opcoes);
    return { situacao: "enviada", mensagemId: m!.id };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    const [m] = await db.insert(mensagem).values({ ...base, situacao: "falhou", erro }).returning({ id: mensagem.id });
    return { situacao: "falhou", mensagemId: m!.id, erro };
  }
}

/** Fornecedor e item que já ganharam o e-mail com o link (uma vez por cotação). */
const linksEnviados = new Set<string>();

/**
 * Teste pelo Telegram (pedido do dono, 08/11/2026): com EMAIL_FORNECEDOR_TESTE (endereços separados por
 * vírgula), quando uma cotação sai para um fornecedor que não está no Telegram (simulado, por exemplo),
 * quem testa recebe um e-mail só com o link pessoal do bot desse fornecedor. Abrindo o link, a conversa
 * do Telegram passa a ser a do fornecedor e tudo segue por lá (o e-mail não leva cotação nem conversa).
 * Nunca vai ao e-mail do fornecedor. Falha aqui não atrapalha o envio principal.
 */
async function linkDeTestePorEmail(c: Contato, opcoes: OpcoesEnvio) {
  const destinos = (process.env.EMAIL_FORNECEDOR_TESTE ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  const email = adaptadores.get("email");
  if (!destinos.length || !email || !c.fornecedorId) return;
  const chave = `${c.fornecedorId}:${opcoes.itemPedidoId ?? ""}`;
  if (linksEnviados.has(chave)) return;
  linksEnviados.add(chave);
  try {
    let [f] = await db.select().from(fornecedor).where(eq(fornecedor.id, c.fornecedorId));
    if (!f) return;
    if (!f.codigoConvite) {
      // Código só com [A-Za-z0-9_-], como o /start do Telegram exige.
      const codigo = `f${randomBytes(9).toString("base64url")}`;
      [f] = await db.update(fornecedor).set({ codigoConvite: codigo }).where(eq(fornecedor.id, f.id)).returning();
    }
    const [it] = opcoes.itemPedidoId ? await db.select({ descricao: itemPedido.descricao, quantidade: itemPedido.quantidade, unidade: itemPedido.unidade }).from(itemPedido).where(eq(itemPedido.id, opcoes.itemPedidoId)) : [];
    const cotacao = `${opcoes.itemPedidoId ? `Cotação ${opcoes.itemPedidoId}` : "Cotação"}${it ? `: ${Number(it.quantidade).toLocaleString("pt-BR")} ${it.unidade} de ${it.descricao}` : ""}`;
    const linkTeste = { fornecedor: `${f!.nome}${f!.origem === "simulado" ? " (simulado)" : ""}`, codigo: f!.codigoConvite!, cotacao };
    for (const destino of destinos) {
      await email.enviar(destino, "", { tipo: "convite", itemPedidoId: opcoes.itemPedidoId, pedidoId: opcoes.pedidoId, linkTeste }).catch((erro) => console.error("[e-mail de teste]", destino, erro instanceof Error ? erro.message : erro));
    }
  } catch (erro) {
    console.error("[e-mail de teste]", erro instanceof Error ? erro.message : erro);
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
