// Canal Telegram (R1). Converte updates em MensagemEntrada e implementa o
// envio. Suporta um bot por papel: o endereço do contato é "<papel>:<chat_id>",
// então a mesma pessoa pode falar com o bot do comprador e com o do fornecedor.

import { autoRetry } from "@grammyjs/auto-retry";
import { run, sequentialize, type RunnerHandle } from "@grammyjs/runner";
import { Api, Bot, GrammyError, InlineKeyboard, InputFile, type Context } from "grammy";
import { existsSync } from "node:fs";
import { lerComandoVincular, vincularTelegram } from "../contas.ts";
import { conferirDado, tecladoAposClique } from "../fluxo/componentes/botoes.ts";
import { htmlParaTexto } from "../texto.ts";
import { receber, type AdaptadorCanal, type Anexo, type Botao, type MensagemEntrada } from "../nucleo/mensagens/index.ts";

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

export const LIMITE_TEXTO = 4096;

/** Divide por parágrafo (depois por linha, depois por palavra) sem passar do limite nem perder texto. */
export function dividirTexto(texto: string, limite = LIMITE_TEXTO): string[] {
  if (texto.length <= limite) return [texto];
  const partes: string[] = [];
  let atual = "";
  const juntar = (trecho: string, sep: string) => {
    if (atual && atual.length + sep.length + trecho.length <= limite) atual += sep + trecho;
    else {
      if (atual) partes.push(atual);
      atual = trecho;
    }
  };
  const cortar = (trecho: string) => {
    // Linha ou parágrafo único maior que o limite: corta na última palavra que cabe.
    while (trecho.length > limite) {
      let corte = trecho.lastIndexOf(" ", limite);
      if (corte < limite / 2) corte = limite;
      juntar(trecho.slice(0, corte), "");
      partes.push(atual);
      atual = "";
      trecho = trecho.slice(corte).trimStart();
    }
    if (trecho) juntar(trecho, "");
  };
  for (const par of texto.split("\n\n")) {
    if (par.length <= limite) {
      juntar(par, "\n\n");
      continue;
    }
    if (atual) partes.push(atual);
    atual = "";
    for (const linha of par.split("\n")) {
      if (linha.length <= limite) juntar(linha, "\n");
      else {
        if (atual) partes.push(atual);
        atual = "";
        cortar(linha);
      }
    }
  }
  if (atual) partes.push(atual);
  return partes;
}

const TAGS = ["b", "i", "code", "blockquote"];
const tagsBalanceadas = (h: string) => TAGS.every((t) => (h.match(new RegExp(`<${t}[ >]`, "g"))?.length ?? 0) === (h.match(new RegExp(`</${t}>`, "g"))?.length ?? 0));

/** Teclado inline; confere os 64 bytes do dado e aplica a cor (style, Bot API 9.4). */
export function montarTeclado(botoes: Botao[]): InlineKeyboard {
  const teclado = new InlineKeyboard();
  // Até 3 botões curtos numa linha; senão, um por linha.
  const umPorLinha = botoes.length > 3 || botoes.some((b) => b.rotulo.length > 18);
  const estilos = { sucesso: "success", perigo: "danger", primario: "primary" } as const;
  for (const b of botoes) {
    try {
      conferirDado(b.dado);
    } catch (e) {
      console.error("[telegram]", e);
      throw e;
    }
    const botao: { text: string; callback_data: string; style?: "success" | "danger" | "primary" } = { text: b.rotulo.slice(0, 64), callback_data: b.dado };
    if (b.estilo) botao.style = estilos[b.estilo];
    teclado.add(botao);
    if (umPorLinha) teclado.row();
  }
  return teclado;
}

/** O comando /vincular: só o bot do comprador liga o chat à conta (o dono dos pedidos sai dele). */
async function respostaDoVincular(papel: Papel, ctx: Context, codigo: string): Promise<string> {
  if (papel !== "comprador") return "Para ligar o seu Telegram à conta, mande o código ao bot do comprador.";
  if (!codigo || !ctx.chat) return "Mande o código junto, assim: /vincular CODIGO. O código está nas telas do Kotala, em Configurações.";
  const nome = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || undefined;
  try {
    const r = await vincularTelegram({ endereco: enderecoDe(papel, ctx.chat.id), nome, codigo });
    return r.ok
      ? `Pronto: este Telegram está ligado à conta de ${r.nome}. Os pedidos que fizer aqui aparecem com o seu nome nas telas.`
      : "Código inválido ou vencido. Gere outro nas telas do Kotala, em Configurações, e mande de novo.";
  } catch (erro) {
    console.error(`[telegram:${papel}] vincular`, erro);
    return "Não consegui ligar agora. Tente de novo em instantes.";
  }
}

const ehErroDeHtml = (e: unknown) => e instanceof GrammyError && e.error_code === 400 && /parse entities|can't parse/i.test(e.description);
const naoMudou = (e: unknown) => e instanceof GrammyError && /message is not modified/i.test(e.description);

export function criarBot(token: string, papel: Papel) {
  const bot = new Bot(token);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 10 }));
  // Uma mensagem por vez em cada conversa: evita interpretar duas vezes o mesmo pedido.
  bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));

  const entregar = async (ctx: Context, e: Omit<MensagemEntrada, "canal" | "endereco" | "papel" | "nome">) => {
    if (!ctx.chat) return;
    const nome = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || undefined;
    // "Digitando..." dura 5 s no Telegram: repete enquanto o fluxo (e a IA) trabalha.
    const digitando = () => ctx.api.sendChatAction(ctx.chat!.id, "typing").catch(() => {});
    void digitando();
    const timer = setInterval(digitando, 4000);
    try {
      await receber({ canal: "telegram", endereco: enderecoDe(papel, ctx.chat.id), papel, nome, ...e });
    } catch (erro) {
      console.error(`[telegram:${papel}]`, erro);
      await ctx.reply("Tive um problema para processar sua mensagem. Pode tentar de novo?").catch(() => {});
    } finally {
      clearInterval(timer);
    }
  };

  bot.on("callback_query:data", async (ctx) => {
    const dado = ctx.callbackQuery.data;
    const msg = ctx.callbackQuery.message;
    // Mensagem inacessível (antiga demais) ou sem esse botão (já usado ou trocado): avisa e não processa.
    const botoesDaMensagem = msg && msg.date !== 0 && "reply_markup" in msg ? (msg.reply_markup?.inline_keyboard ?? []).flat() : null;
    if (!msg || msg.date === 0 || (botoesDaMensagem && !botoesDaMensagem.some((b) => "callback_data" in b && b.callback_data === dado))) {
      await ctx.answerCallbackQuery({ text: "Esses botões já foram usados ou estão desatualizados. Peça de novo se precisar.", show_alert: true }).catch(() => {});
      return;
    }
    await ctx.answerCallbackQuery().catch(() => {});
    // Ação final: troca o teclado pelo que foi escolhido (não dá para aprovar duas vezes).
    // Ação que só abre outra pergunta: o teclado continua valendo.
    if (tecladoAposClique(dado) === "tirar") {
      const escolhido = botoesDaMensagem?.find((b) => "callback_data" in b && b.callback_data === dado)?.text;
      const marca = escolhido ? `\n\n✔ ${escolhido}` : "";
      const aviso = { link_preview_options: { is_disabled: true } };
      let editou = false;
      if (marca && "text" in msg && msg.text) {
        editou = await ctx.editMessageText(msg.text + marca, { ...aviso, entities: msg.entities }).then(() => true, () => false);
      } else if (marca && "caption" in msg && msg.caption) {
        editou = await ctx.editMessageCaption({ caption: msg.caption + marca, caption_entities: msg.caption_entities }).then(() => true, () => false);
      }
      if (!editou) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    }
    await entregar(ctx, { idExterno: `cb:${ctx.callbackQuery.id}`, texto: "", botao: dado, mensagemRef: String(msg.message_id) });
  });

  bot.on("message", async (ctx) => {
    const texto = ctx.message.text ?? ctx.message.caption ?? "";
    // /vincular CODIGO: liga este chat à conta das telas. Responde aqui mesmo e não entra em receber():
    // o código não vai para o histórico nem para a IA.
    const codigo = lerComandoVincular(texto);
    if (codigo !== null) {
      await ctx.reply(await respostaDoVincular(papel, ctx, codigo)).catch((e) => console.error(`[telegram:${papel}] vincular`, e));
      return;
    }
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
    suportaHtml: true,
    async enviar(endereco, texto, opcoes) {
      const { papel, chatId } = lerEndereco(endereco);
      const bot = bots[papel] ?? bots.comprador;
      if (!bot) throw new Error(`Nenhum bot do Telegram para ${papel}.`);
      const teclado = opcoes.botoes?.length ? montarTeclado(opcoes.botoes) : undefined;
      let html = opcoes.formato === "html";
      let partes = dividirTexto(texto);
      // Cortar no meio de uma marcação quebraria o HTML: nesse caso vai tudo como texto simples.
      if (html && !partes.every(tagsBalanceadas)) {
        html = false;
        partes = dividirTexto(htmlParaTexto(texto));
      }
      // Sem prévia de link: a imagem do primeiro anúncio citado parecia uma proposta escolhida.
      const base = { link_preview_options: { is_disabled: true } };
      const mandar = async (parte: string, reply_markup: InlineKeyboard | undefined, modoHtml: boolean) => {
        try {
          return await bot.api.sendMessage(chatId, parte, { ...base, reply_markup, ...(modoHtml ? { parse_mode: "HTML" as const } : {}) });
        } catch (e) {
          // O Telegram recusou o HTML: reenvia como texto simples em vez de perder a mensagem.
          if (modoHtml && ehErroDeHtml(e)) return bot.api.sendMessage(chatId, htmlParaTexto(parte), { ...base, reply_markup });
          throw e;
        }
      };

      // Edição no lugar (uma mensagem só); se o Telegram não deixar, manda uma nova.
      if (opcoes.substitui && partes.length === 1) {
        const id = Number(opcoes.substitui);
        try {
          await bot.api.editMessageText(chatId, id, partes[0]!, { ...base, reply_markup: teclado, ...(html ? { parse_mode: "HTML" as const } : {}) });
          return { idExterno: opcoes.substitui };
        } catch (e) {
          if (naoMudou(e)) return { idExterno: opcoes.substitui };
          if (html && ehErroDeHtml(e)) {
            const ok = await bot.api.editMessageText(chatId, id, htmlParaTexto(partes[0]!), { ...base, reply_markup: teclado }).then(() => true, () => false);
            if (ok) return { idExterno: opcoes.substitui };
          }
        }
      }

      let ultimo: { message_id: number } | undefined;
      for (const [i, parte] of partes.entries()) ultimo = await mandar(parte, i === partes.length - 1 ? teclado : undefined, html);
      for (const a of opcoes.anexos ?? []) await bot.api.sendDocument(chatId, anexoParaEnvio(a));
      return { idExterno: String(ultimo!.message_id) };
    },
    async baixar(ref) {
      // file_id vale para o bot que recebeu; tenta os dois.
      for (const bot of Object.values(bots)) {
        if (!bot) continue;
        try {
          const f = await bot.api.getFile(ref);
          if (!f.file_path) continue;
          const r = await fetch(`https://api.telegram.org/file/bot${bot.token}/${f.file_path}`);
          if (!r.ok) continue;
          return { dados: new Uint8Array(await r.arrayBuffer()), mediaType: r.headers.get("content-type") ?? undefined };
        } catch {
          // tenta o próximo bot
        }
      }
      throw new Error("Não consegui baixar o anexo do Telegram.");
    },
  };
}

/** Anexo de saída: caminho local vira upload; qualquer outra coisa é tratada como file_id do Telegram. */
function anexoParaEnvio(a: Anexo): string | InputFile {
  return a.ref.startsWith("/") && existsSync(a.ref) ? new InputFile(a.ref, a.nome) : a.ref;
}

/** Comandos do menu do Telegram. O tratamento de /start e /ajuda está no fluxo do comprador. */
export async function registrarComandos(bot: Bot) {
  await bot.api.setMyCommands([
    { command: "start", description: "Começar" },
    { command: "ajuda", description: "Como usar" },
  ]);
}

const usuarios = new Map<string, Promise<string>>();
/** @usuario do bot (sem @), pelo getMe; guardado por token. Usado no link pessoal do fornecedor (E1). */
export function usuarioDoBot(token: string): Promise<string> {
  let u = usuarios.get(token);
  if (!u) {
    u = new Api(token).getMe().then((eu) => eu.username);
    u.catch(() => usuarios.delete(token));
    usuarios.set(token, u);
  }
  return u;
}

export function iniciarBots(bots: Bot[]): RunnerHandle[] {
  for (const b of bots) registrarComandos(b).catch((e) => console.error("[telegram] setMyCommands", e));
  return bots.map((b) => run(b));
}
