// Liga a entrada única (N4) aos fluxos de cada papel.

import { aoReceber } from "../nucleo/mensagens/index.ts";
import { registrar } from "../nucleo/registro.ts";
import { db } from "../nucleo/db/cliente.ts";
import { aoMensagemDoComprador } from "./comprador.ts";

export function ligarFluxos() {
  aoReceber(async (m) => {
    if (m.contato.papel === "comprador") return aoMensagemDoComprador(m);
    // Fornecedor: cadastro (R5) e extração das respostas (R6) entram aqui.
    await registrar(db, {
      agente: "Fornecedor",
      acao: "Mandou uma mensagem.",
      motivo: "O tratamento das respostas de fornecedor ainda não está ligado.",
      fornecedorIds: m.contato.fornecedorId ? [m.contato.fornecedorId] : undefined,
    });
  });
}
