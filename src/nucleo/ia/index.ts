// N2: adaptador de IA. O resto do sistema chama gerarTexto/gerarObjeto com um
// papel e nunca vê provedor, chave ou modelo. Trocar de provedor é mexer só aqui.

import { createGoogle, type GoogleProvider } from "@ai-sdk/google";
import {
  APICallError,
  generateText,
  LoadAPIKeyError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  RetryError,
  type ModelMessage,
  type UserContent,
} from "ai";
import type { z } from "zod";
import { alvosDoPapel, rotasDoAmbiente, timeoutMs, type Papel, type Rota } from "./config.ts";
import { comReserva, Disjuntor, type Alvo, type TipoFalha } from "./reserva.ts";

export type { Papel } from "./config.ts";
export { SemAlvoDisponivel } from "./reserva.ts";

export type AnexoIa = { dados: Uint8Array | string; mediaType: string };

export type PedidoIa = {
  papel: Papel;
  /** Instruções fixas do agente. */
  sistema?: string;
  /** Texto do usuário; use `mensagens` para conversa com histórico. */
  prompt?: string;
  mensagens?: ModelMessage[];
  /** PDF, foto ou áudio, mandados junto do prompt. */
  anexos?: AnexoIa[];
  /** Para o registro de uso. */
  contexto?: { agente?: string; pedidoId?: number; itemPedidoId?: number };
};

export type RegistroUso = {
  papel: Papel;
  agente?: string;
  rota: string;
  modelo: string;
  ok: boolean;
  tentativa: number;
  tokensEntrada?: number;
  tokensSaida?: number;
  duracaoMs: number;
  erro?: string;
  pedidoId?: number;
  itemPedidoId?: number;
};

let registrarUso: (r: RegistroUso) => void = () => {};
/** Liga o registro de uso (o núcleo grava em uso_ia). */
export function aoRegistrarUso(fn: (r: RegistroUso) => void) {
  registrarUso = fn;
}

const disjuntor = new Disjuntor();
let rotas: Rota[] | null = null;
const provedores = new Map<string, GoogleProvider>();

function provedor(rota: string): GoogleProvider {
  rotas ??= rotasDoAmbiente();
  let p = provedores.get(rota);
  if (!p) {
    const r = rotas.find((x) => x.nome === rota);
    if (!r) throw new Error(`Rota de IA desconhecida: ${rota}`);
    p = createGoogle({ apiKey: r.apiKey });
    provedores.set(rota, p);
  }
  return p;
}

function statusDoErro(erro: unknown): number | undefined {
  if (RetryError.isInstance(erro)) return statusDoErro(erro.lastError);
  if (APICallError.isInstance(erro)) return erro.statusCode;
  return undefined;
}

export function classificarErro(erro: unknown): TipoFalha {
  if (NoObjectGeneratedError.isInstance(erro) || NoOutputGeneratedError.isInstance(erro)) return "saida";
  if (erro instanceof Error && erro.name === "ZodError") return "saida";
  if (LoadAPIKeyError.isInstance(erro)) return "chave";
  const status = statusDoErro(erro);
  if (status === 429) return "limite";
  if (status === 401 || status === 403) return "chave";
  if (status === 404) return "saida"; // modelo inexistente nessa chave: tenta o próximo
  if (status !== undefined && status >= 500) return "indisponivel";
  if (status !== undefined && status >= 400) return "pedido";
  // Sem status: timeout, abort ou rede.
  return "indisponivel";
}

function montarMensagens(p: PedidoIa): ModelMessage[] {
  const mensagens = [...(p.mensagens ?? [])];
  if (p.prompt !== undefined || p.anexos?.length) {
    const conteudo: Exclude<UserContent, string> = [];
    if (p.prompt) conteudo.push({ type: "text", text: p.prompt });
    for (const a of p.anexos ?? []) conteudo.push({ type: "file", data: a.dados, mediaType: a.mediaType });
    mensagens.push({ role: "user", content: conteudo });
  }
  if (!mensagens.length) throw new Error("PedidoIa sem prompt nem mensagens.");
  return mensagens;
}

async function executarComReserva<T>(p: PedidoIa, chamar: (alvo: Alvo) => Promise<{ valor: T; uso?: { inputTokens?: number; outputTokens?: number } }>) {
  rotas ??= rotasDoAmbiente();
  const alvos = alvosDoPapel(p.papel, rotas);
  if (!alvos.length) throw new Error("Nenhuma chave de IA configurada. Defina GEMINI_API_KEY no .env.");
  const { valor, alvo, caiuNaReserva } = await comReserva({
    alvos,
    executar: chamar,
    classificar: classificarErro,
    disjuntor,
    aoTentar: (t) =>
      registrarUso({
        papel: p.papel,
        agente: p.contexto?.agente,
        rota: t.alvo.rota,
        modelo: t.alvo.modelo,
        ok: t.ok,
        tentativa: t.tentativa,
        tokensEntrada: t.ok ? t.valor.uso?.inputTokens : undefined,
        tokensSaida: t.ok ? t.valor.uso?.outputTokens : undefined,
        duracaoMs: t.ms,
        erro: t.ok ? undefined : `${t.tipo}: ${t.erro instanceof Error ? t.erro.message : String(t.erro)}`.slice(0, 500),
        pedidoId: p.contexto?.pedidoId,
        itemPedidoId: p.contexto?.itemPedidoId,
      }),
  });
  return { valor: valor.valor, modelo: alvo.modelo, rota: alvo.rota, caiuNaReserva };
}

const opcoesComuns = () => ({
  // Uma repetição rápida no mesmo modelo; depois a cadeia troca de modelo ou rota.
  maxRetries: 1,
  timeout: { totalMs: timeoutMs() },
});

/** Texto livre: redação de mensagens e explicações. */
export async function gerarTexto(p: PedidoIa) {
  const mensagens = montarMensagens(p);
  return executarComReserva(p, async (alvo) => {
    const r = await generateText({
      model: provedor(alvo.rota)(alvo.modelo),
      system: p.sistema,
      messages: mensagens,
      ...opcoesComuns(),
    });
    return { valor: r.text, uso: r.usage };
  });
}

/**
 * Saída estruturada validada com zod. O Gemini ignora algumas restrições do
 * schema (minLength etc.), por isso a validação final é sempre a do zod.
 */
export async function gerarObjeto<S extends z.ZodType>(p: PedidoIa & { schema: S }) {
  const mensagens = montarMensagens(p);
  return executarComReserva(p, async (alvo) => {
    const r = await generateText({
      model: provedor(alvo.rota)(alvo.modelo),
      system: p.sistema,
      messages: mensagens,
      output: Output.object({ schema: p.schema }),
      ...opcoesComuns(),
    });
    return { valor: p.schema.parse(r.output) as z.infer<S>, uso: r.usage };
  });
}

/** Para testes: esquece chaves lidas e alvos em descanso. */
export function reiniciarIa() {
  rotas = null;
  provedores.clear();
  disjuntor.limpar();
}
