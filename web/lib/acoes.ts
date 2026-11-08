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
      signal: AbortSignal.timeout(90_000),
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

export type AnexoChat = { nome: string; mediaType: string; base64: string };

export async function enviarChat(endereco: string, texto: string, botao?: string, anexos?: AnexoChat[]): Promise<Resultado> {
  return chamar("/chat", { endereco, texto, botao, anexos });
}

/** Lista de bloqueio e homologação do fornecedor. */
export async function alterarFornecedor(fornecedorId: string, acao: "bloquear" | "desbloquear" | "homologar" | "desomologar", motivo = ""): Promise<Resultado> {
  const r = await chamar("/acoes/fornecedor", { fornecedorId, acao, motivo });
  revalidatePath("/fornecedores");
  revalidatePath("/conduta");
  return r;
}

// ---------- Telegram simulado do fornecedor ----------

/** A API interna antiga não conhece as rotas do simulado: o erro cru ("rota desconhecida", "Erro 404") não diz nada a quem está na tela. */
function erroDoSimulado(r: Resultado): Resultado {
  if (r.ok || !r.erro || !/^(Erro \d+|rota desconhecida)$/i.test(r.erro)) return r;
  return { ok: false, erro: "O processo dos bots ainda não conhece o Telegram simulado. Reinicie-o com a versão nova e tente de novo." };
}

function revalidarChat(contatoId: string) {
  revalidatePath(`/telegram-simulado/${contatoId}`);
  revalidatePath("/telegram-simulado");
}

/** Escreve ou toca num botão como o fornecedor simulado. O simulador para de responder sozinho neste chat. */
export async function enviarComoFornecedor(contatoId: string, texto: string, botao?: string): Promise<Resultado> {
  const r = erroDoSimulado(await chamar("/simulado/mensagem", { contatoId, texto: texto || undefined, botao }));
  revalidarChat(contatoId);
  return r;
}

/** `ligado` true devolve o chat à persona automática; false, o usuário assume. */
export async function alterarAutomatico(contatoId: string, ligado: boolean): Promise<Resultado> {
  const r = erroDoSimulado(await chamar("/simulado/automatico", { contatoId, ligado }));
  revalidarChat(contatoId);
  return r;
}
