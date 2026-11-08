// Processo dos bots: Telegram por long polling, fluxos e varredor de prazos.
// Rode só um por token: dois processos com o mesmo bot dão erro 409.

import { adaptadorEmail } from "./canais/email.ts";
import { adaptadorTelegram, criarBot, iniciarBots, usuarioDoBot, type Papel } from "./canais/telegram.ts";
import { ligarFluxos } from "./fluxo/index.ts";
import { conexao } from "./nucleo/index.ts";
import { registrarCanal } from "./nucleo/mensagens/index.ts";
import { iniciarVarredor } from "./nucleo/orquestrador/index.ts";
import { adaptadorSimulado, semearSimulados } from "./simulador/index.ts";
import { adaptadorWeb } from "./canais/web.ts";
import { carregarCatalogo } from "./agentes/interpretador/catalogo.ts";
import { iniciarApiInterna } from "./api-interna.ts";
import { ligarAssistente } from "./assistente/roteador.ts";

const tokens: [Papel, string | undefined][] = [
  ["comprador", process.env.TELEGRAM_TOKEN_COMPRADOR],
  ["fornecedor", process.env.TELEGRAM_TOKEN_FORNECEDOR],
];

const bots = Object.fromEntries(tokens.filter(([, t]) => t).map(([papel, t]) => [papel, criarBot(t!, papel)]));
if (!bots.comprador) {
  console.error("Defina TELEGRAM_TOKEN_COMPRADOR no .env (token do @BotFather).");
  process.exit(1);
}

registrarCanal(adaptadorTelegram(bots));
registrarCanal(adaptadorSimulado());
registrarCanal(adaptadorWeb());
// E1: e-mail só para EMAIL_PERMITIDOS e convites manuais (trava em canais/email.ts).
const tokenFornecedor = process.env.TELEGRAM_TOKEN_FORNECEDOR;
registrarCanal(adaptadorEmail({ usuarioBot: tokenFornecedor ? await usuarioDoBot(tokenFornecedor).catch(() => undefined) : undefined }));
await semearSimulados();
await carregarCatalogo();
ligarFluxos();
// Assistente do chat web (Frente 3): troca o roteador depois dos fluxos. ASSISTENTE=desligado volta ao fluxo puro.
if (process.env.ASSISTENTE !== "desligado") ligarAssistente();
const pararVarredor = iniciarVarredor();
const runners = iniciarBots(Object.values(bots));

// Telas: ações e chat web chegam por aqui (só com token).
const apiToken = process.env.API_INTERNA_TOKEN;
const api = apiToken ? iniciarApiInterna(Number(process.env.API_INTERNA_PORTA ?? 3301), apiToken, process.env.API_INTERNA_HOST ?? "127.0.0.1") : null;
if (!apiToken) console.log("Sem API_INTERNA_TOKEN: as telas ficam só de leitura.");

for (const [papel, bot] of Object.entries(bots)) {
  const eu = await bot.api.getMe();
  console.log(`Bot do ${papel}: @${eu.username}${papel === "fornecedor" ? ` · convite (link ou QR): https://t.me/${eu.username}?start=cadastro` : ""}`);
}

let saindo = false;
async function sair() {
  if (saindo) return;
  saindo = true;
  pararVarredor();
  api?.close();
  await Promise.all(runners.map((r) => (r.isRunning() ? r.stop() : undefined)));
  await conexao.end();
  process.exit(0);
}
process.on("SIGINT", sair);
process.on("SIGTERM", sair);
