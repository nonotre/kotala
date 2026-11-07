// N2: adaptador de IA. O resto do sistema chama gerarTexto/gerarObjeto com um
// papel e nunca vê provedor, chave ou modelo. Trocar de provedor é mexer só aqui.

import { createHash } from "node:crypto";
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
  /** Instruções e mensagens enviadas, cortadas; anexos viram tipo, tamanho e hash. */
  prompt?: string;
  /** Texto ou objeto devolvido (ou o texto cru, quando o formato falhou), cortado. */
  resposta?: string;
  pedidoId?: number;
  itemPedidoId?: number;
};

const MAX_TEXTO_RASTRO = 8_000;
const cortar = (s: string) => (s.length > MAX_TEXTO_RASTRO ? `${s.slice(0, MAX_TEXTO_RASTRO)}… [+${s.length - MAX_TEXTO_RASTRO} caracteres]` : s);

/** Texto do que foi enviado à IA, sem os bytes dos anexos. */
export function textoDoPrompt(sistema: string | undefined, mensagens: ModelMessage[]): string {
  const partes: string[] = [];
  if (sistema) partes.push(`[sistema]\n${sistema}`);
  for (const m of mensagens) {
    if (typeof m.content === "string") {
      partes.push(`[${m.role}]\n${m.content}`);
      continue;
    }
    const pedacos = (m.content as { type: string; text?: string; data?: unknown; mediaType?: string }[]).map((c) => {
      if (c.type === "text") return c.text ?? "";
      if (c.type === "file" || c.type === "image") {
        const d = c.data;
        const bytes = d instanceof Uint8Array ? d : typeof d === "string" ? Buffer.from(d, "base64") : null;
        const hash = bytes ? createHash("sha256").update(bytes).digest("hex").slice(0, 16) : "?";
        return `[arquivo ${c.mediaType ?? ""}, ${bytes?.length ?? "?"} bytes, sha256 ${hash}]`;
      }
      return `[${c.type}]`;
    });
    partes.push(`[${m.role}]\n${pedacos.join("\n")}`);
  }
  return cortar(partes.join("\n\n"));
}

function textoDoErro(erro: unknown): string | undefined {
  // Quando o modelo respondeu fora do formato, guarda o que ele escreveu.
  if (NoObjectGeneratedError.isInstance(erro) && erro.text) return cortar(erro.text);
  return undefined;
}

const ouvintesDeUso: ((r: RegistroUso) => void)[] = [];
/** Acrescenta quem recebe cada chamada de IA (o núcleo grava em uso_ia; scripts podem só imprimir). */
export function aoRegistrarUso(fn: (r: RegistroUso) => void) {
  ouvintesDeUso.push(fn);
}
const registrarUso = (r: RegistroUso) => {
  for (const f of ouvintesDeUso) {
    try {
      f(r);
    } catch (e) {
      console.error("[uso_ia]", e);
    }
  }
};

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

async function executarComReserva<T>(
  p: PedidoIa,
  prompt: string,
  chamar: (alvo: Alvo) => Promise<{ valor: T; uso?: { inputTokens?: number; outputTokens?: number } }>,
) {
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
        prompt,
        resposta: t.ok ? cortar(typeof t.valor.valor === "string" ? t.valor.valor : JSON.stringify(t.valor.valor)) : textoDoErro(t.erro),
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
  return executarComReserva(p, textoDoPrompt(p.sistema, mensagens), async (alvo) => {
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
  return executarComReserva(p, textoDoPrompt(p.sistema, mensagens), async (alvo) => {
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
