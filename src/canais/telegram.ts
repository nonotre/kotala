// Canal Telegram (R1). Converte updates em MensagemEntrada e implementa o
// envio. Suporta um bot por papel: o endereço do contato é "<papel>:<chat_id>",
// então a mesma pessoa pode falar com o bot do comprador e com o do fornecedor.

import { autoRetry } from "@grammyjs/auto-retry";
import { run, sequentialize, type RunnerHandle } from "@grammyjs/runner";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { receber, type AdaptadorCanal, type Anexo, type MensagemEntrada } from "../nucleo/mensagens/index.ts";

export type Papel = "comprador" | "fornecedor";

const enderecoDe = (papel: Papel, chatId: number | string) => `${papel}:${chatId}`;

function lerEndereco(endereco: string): { papel: Papel; chatId: string } {
  const [papel, chatId] = endereco.split(":");
  if ((papel !== "comprador" && papel !== "fornecedor") || !chatId) throw new Error(`Endereço de Telegram inválido: ${endereco}`);
  return { papel, chatId };
}

function anexosDe(ctx: Context): Anexo[] {
  const msg = ctx.message;
  if (!msg) return [];
  if (msg.document) {
    const d = msg.document;
    const tipo = d.mime_type === "application/pdf" ? "pdf" : d.mime_type?.startsWith("image/") ? "foto" : "outro";
    return [{ tipo, mediaType: d.mime_type ?? "application/octet-stream", ref: d.file_id, nome: d.file_name, tamanho: d.file_size }];
  }
  if (msg.photo?.length) {
    const maior = msg.photo[msg.photo.length - 1]!;
    return [{ tipo: "foto", mediaType: "image/jpeg", ref: maior.file_id, tamanho: maior.file_size }];
  }
  const audio = msg.voice ?? msg.audio;
  if (audio) return [{ tipo: "audio", mediaType: audio.mime_type ?? "audio/ogg", ref: audio.file_id, tamanho: audio.file_size }];
  return [];
}

export function criarBot(token: string, papel: Papel) {
  const bot = new Bot(token);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 10 }));
  // Uma mensagem por vez em cada conversa: evita interpretar duas vezes o mesmo pedido.
  bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));

  const entregar = async (ctx: Context, e: Omit<MensagemEntrada, "canal" | "endereco" | "papel" | "nome">) => {
    if (!ctx.chat) return;
    const nome = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || undefined;
    try {
      await receber({ canal: "telegram", endereco: enderecoDe(papel, ctx.chat.id), papel, nome, ...e });
    } catch (erro) {
      console.error(`[telegram:${papel}]`, erro);
      await ctx.reply("Tive um problema para processar sua mensagem. Pode tentar de novo?").catch(() => {});
    }
  };

  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    // Tira os botões da mensagem clicada para não aprovar duas vezes.
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await entregar(ctx, { idExterno: `cb:${ctx.callbackQuery.id}`, texto: "", botao: ctx.callbackQuery.data });
  });

  bot.on("message", async (ctx) => {
    const texto = ctx.message.text ?? ctx.message.caption ?? "";
    const convite = texto.startsWith("/start ") ? texto.slice(7).trim() : undefined;
    await entregar(ctx, { idExterno: String(ctx.message.message_id), texto, anexos: anexosDe(ctx), convite });
  });

  bot.catch((e) => console.error(`[telegram:${papel}]`, e.error));
  return bot;
}

/** Adaptador único do canal "telegram": escolhe o bot pelo papel no endereço. */
export function adaptadorTelegram(bots: Partial<Record<Papel, Bot>>): AdaptadorCanal {
  return {
    canal: "telegram",
    async enviar(endereco, texto, opcoes) {
      const { papel, chatId } = lerEndereco(endereco);
      const bot = bots[papel] ?? bots.comprador;
      if (!bot) throw new Error(`Nenhum bot do Telegram para ${papel}.`);
      let teclado: InlineKeyboard | undefined;
      if (opcoes.botoes?.length) {
        teclado = new InlineKeyboard();
        for (const b of opcoes.botoes) teclado.text(b.rotulo, b.dado);
      }
      const m = await bot.api.sendMessage(chatId, texto, { reply_markup: teclado });
      return { idExterno: String(m.message_id) };
    },
  };
}

export function iniciarBots(bots: Bot[]): RunnerHandle[] {
  return bots.map((b) => run(b));
}
