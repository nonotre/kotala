// API interna do processo dos bots, usada pelas telas. As telas leem o banco
// direto; as ações (aprovar, escolher outra, mensagem do chat web) vêm para cá
// e entram pela mesma receber() que o Telegram usa: os agentes rodam num
// processo só e tudo fica no rastro. Protegida por token; não é exposta fora.

import { createServer, type IncomingMessage } from "node:http";
import { eq } from "drizzle-orm";
import { db } from "./nucleo/db/cliente.ts";
import { contato, itemPedido, pedido } from "./nucleo/db/schema.ts";
import { receber } from "./nucleo/mensagens/index.ts";
import { registrarCotacaoPorVoz, type ArgsRegistrar } from "./agentes/voz/index.ts";

async function corpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  let bruto = "";
  for await (const pedaco of req) {
    bruto += pedaco;
    if (bruto.length > 20_000) throw new Error("Corpo grande demais");
  }
  return bruto ? (JSON.parse(bruto) as Record<string, unknown>) : {};
}

/** Contato do comprador dono do pedido a que o botão se refere ("pedido:12:..." ou "item:34:..."). */
async function compradorDoBotao(dado: string) {
  const m = /^(pedido|item):(\d+):/.exec(dado);
  if (!m) return null;
  let pedidoId = Number(m[2]);
  if (m[1] === "item") {
    const [i] = await db.select({ pedidoId: itemPedido.pedidoId }).from(itemPedido).where(eq(itemPedido.id, pedidoId));
    if (!i) return null;
    pedidoId = i.pedidoId;
  }
  const [l] = await db
    .select({ contato })
    .from(pedido)
    .innerJoin(contato, eq(contato.id, pedido.compradorId))
    .where(eq(pedido.id, pedidoId));
  return l?.contato ?? null;
}

export function iniciarApiInterna(porta: number, token: string, host = "127.0.0.1") {
  const servidor = createServer(async (req, res) => {
    const responder = (status: number, dados: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(dados));
    };
    try {
      if (req.headers["x-kotala-token"] !== token) return responder(401, { erro: "token inválido" });
      if (req.method !== "POST") return responder(405, { erro: "use POST" });
      const b = await corpo(req);

      // Botão tocado numa tela (quadro, mapa): age como o comprador dono do pedido.
      if (req.url === "/acoes/botao") {
        const dado = String(b.dado ?? "");
        const c = await compradorDoBotao(dado);
        if (!c) return responder(404, { erro: "pedido não encontrado" });
        const r = await receber({ canal: c.canal, endereco: c.endereco, idExterno: `tela-${crypto.randomUUID()}`, texto: "", botao: dado });
        return responder(200, { ok: true, tipo: r.tipo });
      }

      // Chat web (E3): mensagem ou botão de um comprador no navegador.
      if (req.url === "/chat") {
        const endereco = String(b.endereco ?? "");
        if (!/^[a-z0-9-]{8,64}$/i.test(endereco)) return responder(400, { erro: "endereço inválido" });
        const r = await receber({
          canal: "web",
          endereco,
          papel: "comprador",
          idExterno: `web-${crypto.randomUUID()}`,
          texto: String(b.texto ?? "").slice(0, 4_000),
          botao: b.botao ? String(b.botao) : undefined,
        });
        return responder(200, { ok: true, tipo: r.tipo });
      }
      // X5: proposta dita numa ligação por voz (ferramenta registrar_cotacao do agente).
      if (req.url === "/voz/cotacao") {
        const cotacaoId = String(b.cotacaoId ?? "");
        if (!/^[0-9a-f-]{36}$/.test(cotacaoId)) return responder(400, { erro: "cotação inválida" });
        const r = await registrarCotacaoPorVoz(cotacaoId, (b.args ?? {}) as ArgsRegistrar, String(b.transcricao ?? ""));
        return responder(200, r);
      }
      return responder(404, { erro: "rota desconhecida" });
    } catch (erro) {
      console.error("[api interna]", erro);
      return responder(500, { erro: erro instanceof Error ? erro.message : String(erro) });
    }
  });
  servidor.listen(porta, host, () => console.log(`API interna das telas em http://${host}:${porta}`));
  return servidor;
}
