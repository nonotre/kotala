// Conversa de comprador sem Telegram, com a IA real e o banco local.
// npm run simular -- "40 cp2 e 2 carrada de areia" "obra alfa, rua x 100" "botao:confirmar"
// Cada argumento é uma mensagem; "botao:<acao>" clica no botão do último pedido.

import { ligarFluxos } from "../src/fluxo/index.ts";
import { conexao } from "../src/nucleo/index.ts";
import { canalEmMemoria, receber, registrarCanal } from "../src/nucleo/mensagens/index.ts";

const { adaptador, enviadas } = canalEmMemoria("simulado");
registrarCanal(adaptador);
ligarFluxos();

const endereco = `simulado-${Date.now()}`;
let n = 0;
let ultimoPedido: number | null = null;

for (const arg of process.argv.slice(2)) {
  const antes = enviadas.length;
  const botao = arg.startsWith("botao:") && ultimoPedido ? `pedido:${ultimoPedido}:${arg.slice(6)}` : undefined;
  console.log(`\n> comprador: ${botao ? `[${arg.slice(6)}]` : arg}`);
  await receber({ canal: "simulado", endereco, idExterno: String(++n), texto: botao ? "" : arg, botao });
  for (const m of enviadas.slice(antes)) {
    console.log(`\n< assistente:\n${m.texto}`);
    if (m.opcoes.botoes) console.log(`  [${m.opcoes.botoes.map((b) => b.rotulo).join("] [")}]`);
    if (m.opcoes.pedidoId) ultimoPedido = m.opcoes.pedidoId;
  }
}
await conexao.end();
