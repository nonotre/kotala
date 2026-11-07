// Teste rápido do N2 com a chave real: npm run ia:testar
import { z } from "zod";
import { aoRegistrarUso, gerarObjeto } from "../src/nucleo/ia/index.ts";

aoRegistrarUso((r) => console.log(`  ${r.ok ? "ok " : "erro"} ${r.rota}/${r.modelo} ${r.duracaoMs} ms${r.erro ? ` — ${r.erro}` : ""}`));

const Itens = z.object({
  itens: z.array(z.object({ descricao: z.string(), quantidade: z.number(), unidade: z.string() })),
  faltando: z.array(z.string()),
});

const r = await gerarObjeto({
  papel: "rapido",
  schema: Itens,
  sistema: "Extraia os itens de um pedido de material de obra. Responda só com os dados pedidos.",
  prompt: "preciso de 40 cp2 e 2 carrada de areia pra obra alfa até sexta",
});
console.log(`\n${r.rota}/${r.modelo}${r.caiuNaReserva ? " (reserva)" : ""}:`, JSON.stringify(r.valor, null, 2));
