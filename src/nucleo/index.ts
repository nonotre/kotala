// Ponto de entrada do núcleo: N1 (db), N2 (ia), N3 (orquestrador), N4 (mensagens), N5 (registro).

import { db } from "./db/cliente.ts";
import { usoIa } from "./db/schema.ts";
import { aoRegistrarUso } from "./ia/index.ts";

export * as ia from "./ia/index.ts";
export * as orquestrador from "./orquestrador/index.ts";
export * as mensagens from "./mensagens/index.ts";
export { registrar, AGENTES, type Agente } from "./registro.ts";
export { db, conexao, schema } from "./db/cliente.ts";

// Todo uso de IA fica em uso_ia: tokens, modelo, rota e falhas.
aoRegistrarUso((r) => {
  db.insert(usoIa)
    .values({
      papel: r.agente ? `${r.papel}:${r.agente}` : r.papel,
      rota: r.rota,
      modelo: r.modelo,
      ok: r.ok,
      tentativa: r.tentativa,
      tokensEntrada: r.tokensEntrada,
      tokensSaida: r.tokensSaida,
      duracaoMs: r.duracaoMs,
      erro: r.erro,
      prompt: r.prompt,
      resposta: r.resposta,
      pedidoId: r.pedidoId,
      itemPedidoId: r.itemPedidoId,
    })
    .catch((e) => console.error("[uso_ia]", e));
});
