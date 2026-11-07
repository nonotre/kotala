// Canal "web" (E3, chat no navegador). Não há para onde empurrar a mensagem:
// enviar() já grava a saída na tabela mensagem, e a tela lê de lá.

import type { AdaptadorCanal } from "../nucleo/mensagens/index.ts";

let seq = 0;

export function adaptadorWeb(): AdaptadorCanal {
  return {
    canal: "web",
    async enviar() {
      return { idExterno: `web-out-${Date.now()}-${++seq}` };
    },
  };
}
