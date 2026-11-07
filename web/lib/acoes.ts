"use server";
// Ações das telas: vão para a API interna do processo dos bots, que as faz
// passar pela mesma receber() do Telegram. A tela não roda agente nenhum.

import { revalidatePath } from "next/cache";

type Resultado = { ok: boolean; erro?: string };

async function chamar(rota: string, corpo: unknown): Promise<Resultado> {
  const url = process.env.API_INTERNA_URL ?? "http://127.0.0.1:3301";
  const token = process.env.API_INTERNA_TOKEN;
  if (!token) return { ok: false, erro: "As telas estão só de leitura: falta API_INTERNA_TOKEN." };
  try {
    const r = await fetch(`${url}${rota}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kotala-token": token },
      body: JSON.stringify(corpo),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const j = (await r.json().catch(() => ({}))) as { erro?: string };
    return r.ok ? { ok: true } : { ok: false, erro: j.erro ?? `Erro ${r.status}` };
  } catch {
    return { ok: false, erro: "O assistente não respondeu. Ele está ligado?" };
  }
}

/** Mesmo efeito de tocar no botão no Telegram, como o comprador dono do pedido. */
export async function tocarBotao(dado: string): Promise<Resultado> {
  const r = await chamar("/acoes/botao", { dado });
  revalidatePath("/", "layout");
  return r;
}

export async function enviarChat(endereco: string, texto: string, botao?: string): Promise<Resultado> {
  return chamar("/chat", { endereco, texto, botao });
}

/** Lista de bloqueio e homologação do fornecedor. */
export async function alterarFornecedor(fornecedorId: string, acao: "bloquear" | "desbloquear" | "homologar" | "desomologar", motivo = ""): Promise<Resultado> {
  const r = await chamar("/acoes/fornecedor", { fornecedorId, acao, motivo });
  revalidatePath("/fornecedores");
  return r;
}
