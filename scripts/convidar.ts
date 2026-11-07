// E1: convite manual por e-mail. A pessoa recebe o link pessoal do bot do fornecedor
// e, ao abrir, a conversa já fica ligada ao fornecedor, sem perguntar o nome.
// Usa o banco principal (DATABASE_URL), o mesmo dos bots, e manda e-mail de verdade.
// npm run convidar -- pessoa@exemplo.com "Nome da empresa"

import { adaptadorEmail } from "../src/canais/email.ts";
import { usuarioDoBot } from "../src/canais/telegram.ts";
import { convidarPorEmail } from "../src/fluxo/fornecedor.ts";
import { conexao } from "../src/nucleo/index.ts";
import { registrarCanal } from "../src/nucleo/mensagens/index.ts";

const [email, nome] = process.argv.slice(2);
const token = process.env.TELEGRAM_TOKEN_FORNECEDOR;
if (!email) {
  console.error('Uso: npm run convidar -- pessoa@exemplo.com "Nome da empresa"');
  process.exit(1);
}
if (!token) {
  console.error("Defina TELEGRAM_TOKEN_FORNECEDOR no .env: o link do convite aponta para o bot do fornecedor.");
  process.exit(1);
}

try {
  const usuarioBot = await usuarioDoBot(token);
  registrarCanal(adaptadorEmail({ usuarioBot }));
  const c = await convidarPorEmail({ email, nome, usuarioBot });
  console.log(c.envio.situacao === "enviada" ? `Convite enviado para ${email}.` : `Não enviou (${c.envio.situacao}): ${c.envio.erro ?? ""}`);
  console.log(`Link pessoal: ${c.link}`);
  process.exitCode = c.envio.situacao === "enviada" ? 0 : 1;
} catch (erro) {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
} finally {
  await conexao.end();
}
