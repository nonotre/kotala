// Processo dos bots: Telegram por long polling, fluxos e varredor de prazos.
// Rode só um por token: dois processos com o mesmo bot dão erro 409.

import { adaptadorTelegram, criarBot, iniciarBots, type Papel } from "./canais/telegram.ts";
import { ligarFluxos } from "./fluxo/index.ts";
import { conexao } from "./nucleo/index.ts";
import { registrarCanal } from "./nucleo/mensagens/index.ts";
import { iniciarVarredor } from "./nucleo/orquestrador/index.ts";
import { adaptadorSimulado, semearSimulados } from "./simulador/index.ts";

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
await semearSimulados();
ligarFluxos();
const pararVarredor = iniciarVarredor();
const runners = iniciarBots(Object.values(bots));

for (const [papel, bot] of Object.entries(bots)) {
  const eu = await bot.api.getMe();
  console.log(`Bot do ${papel}: @${eu.username}${papel === "fornecedor" ? ` · convite (link ou QR): https://t.me/${eu.username}?start=cadastro` : ""}`);
}

let saindo = false;
async function sair() {
  if (saindo) return;
  saindo = true;
  pararVarredor();
  await Promise.all(runners.map((r) => (r.isRunning() ? r.stop() : undefined)));
  await conexao.end();
  process.exit(0);
}
process.on("SIGINT", sair);
process.on("SIGTERM", sair);
