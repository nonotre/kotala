// Frente 2: liga, à mão, os contatos do Telegram da Ester e da Liria às contas delas.
// Cria as contas "ester" e "liria" sem senha (a primeira entrada na tela define a senha) e põe
// usuario_id nos contatos. Idempotente: rodar de novo não duplica nada.
// Como cada contato foi identificado: docs/perfil-login.md.
//
//   node --env-file=.env scripts/ligar-telegram.ts

import { conexao } from "../src/nucleo/db/cliente.ts";
import { ligarContatos } from "../src/contas.ts";

const PESSOAS = [
  {
    login: "ester",
    nome: "Ester",
    contatoIds: [
      "736236bf-ddd9-4f27-a8ed-2af684d569b3", // bot do comprador, nome no Telegram "Leoni"
      "d91e350a-c4b7-40dd-8721-80dfa1b48253", // bot do fornecedor, cadastrada como "Cleiton Extintores"
    ],
  },
  {
    login: "liria",
    nome: "Liria",
    contatoIds: [
      "055f2067-19fb-4ee7-9917-4ff02adee2e6", // bot do comprador, nome no Telegram "Liria"
      "ddca1a92-14fa-497a-8d58-44e8d160a0f4", // bot do fornecedor, cadastrada como "vizzano"
    ],
  },
];

for (const p of PESSOAS) {
  const r = await ligarContatos(p);
  console.log(`${p.login}: usuário ${r.usuarioId}, ${r.ligados} de ${p.contatoIds.length} contatos ligados`);
}
await conexao.end();
