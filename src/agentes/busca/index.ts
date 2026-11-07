// R3: busca de fornecedores. Por enquanto só na base: fornecedores reais que
// entraram pelo bot e fornecedores simulados que vendem o item. A busca na
// internet (preço de referência com fonte) entra aqui depois, sem mudar o resto.

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { MAX_FORNECEDORES, PRAZO_RESPOSTAS_SEG, FRACAO_LEMBRETE } from "../../config.ts";
import { db } from "../../nucleo/db/cliente.ts";
import { contato, cotacao, fornecedor, itemPedido, pedido } from "../../nucleo/db/schema.ts";
import { aoEntrarItem, avancarItem, type MudancaItem } from "../../nucleo/orquestrador/index.ts";
import { registrar } from "../../nucleo/registro.ts";
import { PERSONAS, vendeItem } from "../../simulador/personas.ts";
import { buscarNaInternet } from "./internet.ts";
import { acharRecompra, textoRecompra } from "../memoria/index.ts";
import { enviar } from "../../nucleo/mensagens/index.ts";

export { buscarNaInternet, referenciasDoItem } from "./internet.ts";

const personaPorChave = new Map(PERSONAS.map((p) => [p.chave, p]));

export type Candidato = { fornecedorId: string; nome: string; origem: "real" | "simulado"; motivoCorte?: string };

/** Fornecedores com canal ativo, com o motivo de cada corte. */
export async function candidatos(descricao: string): Promise<Candidato[]> {
  const linhas = await db
    .select({
      fornecedorId: fornecedor.id,
      nome: fornecedor.nome,
      origem: fornecedor.origem,
      chave: fornecedor.chave,
      parouEm: fornecedor.parouEm,
    })
    .from(fornecedor)
    .innerJoin(contato, and(eq(contato.fornecedorId, fornecedor.id), isNull(contato.parouEm)))
    .where(isNotNull(contato.id));

  const vistos = new Set<string>();
  const lista: Candidato[] = [];
  for (const l of linhas) {
    if (vistos.has(l.fornecedorId)) continue;
    vistos.add(l.fornecedorId);
    let motivoCorte: string | undefined;
    if (l.parouEm) motivoCorte = "Pediu para não receber mensagens";
    else if (l.origem === "simulado" && l.chave && personaPorChave.has(l.chave) && !vendeItem(descricao)) {
      motivoCorte = "Não vende este item";
    }
    lista.push({ fornecedorId: l.fornecedorId, nome: l.nome, origem: l.origem, motivoCorte });
  }
  // Reais primeiro: são quem pode responder de verdade.
  return lista.sort((a, b) => (a.origem === b.origem ? a.nome.localeCompare(b.nome) : a.origem === "real" ? -1 : 1));
}

async function buscar(m: MudancaItem) {
  // N6: voltar à busca abre uma rodada nova, com todos os fornecedores de novo.
  if (m.evento === "voltar_busca") {
    await db.update(itemPedido).set({ rodada: sql`${itemPedido.rodada} + 1` }).where(eq(itemPedido.id, m.itemPedidoId));
  }
  const [item] = await db.select().from(itemPedido).where(eq(itemPedido.id, m.itemPedidoId));
  if (!item) return;

  // X2: compra repetida em menos de 3 meses? Propõe repetir antes de buscar e cotar.
  if (m.evento === "iniciar_busca") {
    const r = await acharRecompra(item);
    if (r) {
      const [p] = await db.select({ compradorId: pedido.compradorId }).from(pedido).where(eq(pedido.id, item.pedidoId));
      await avancarItem(m.itemPedidoId, "propor_recompra", {
        agente: "Busca",
        acao: `Achou compra recente do mesmo item com ${r.fornecedorNome}.`,
        motivo: "Compra repetida em menos de 3 meses: propõe repetir antes de cotar de novo.",
        fornecedorIds: [r.fornecedorId],
        dados: r,
      });
      if (p) {
        await enviar(p.compradorId, textoRecompra(item.pedidoId, item, r), {
          pedidoId: item.pedidoId,
          itemPedidoId: item.id,
          tipo: "aviso",
          botoes: [
            { rotulo: `Repetir com ${r.fornecedorNome}`, dado: `item:${item.id}:repetir` },
            { rotulo: "Cotar de novo", dado: `item:${item.id}:cotar_novo` },
          ],
        });
      }
      return;
    }
  }

  // Busca real na internet: preço de referência com fonte. Falha aqui não trava o pedido.
  try {
    await buscarNaInternet(item.id);
  } catch (erro) {
    await registrar(db, {
      agente: "Busca",
      acao: "A busca na internet falhou.",
      motivo: erro instanceof Error ? erro.message : String(erro),
      pedidoId: m.pedidoId,
      itemPedidoId: item.id,
    });
  }

  const todos = await candidatos(item.descricao);
  const aptos = todos.filter((c) => !c.motivoCorte).slice(0, MAX_FORNECEDORES());
  const cortados = todos.filter((c) => c.motivoCorte);

  if (!aptos.length) {
    await avancarItem(m.itemPedidoId, "busca_sem_resultado", {
      agente: "Busca",
      acao: "Não achou fornecedor para este item.",
      motivo: cortados.length ? `Cortados: ${cortados.map((c) => `${c.nome} (${c.motivoCorte})`).join("; ")}.` : "Nenhum fornecedor cadastrado.",
    });
    return;
  }

  await db
    .insert(cotacao)
    .values(aptos.map((c) => ({ itemPedidoId: item.id, fornecedorId: c.fornecedorId, rodada: item.rodada })))
    .onConflictDoNothing();

  await registrar(db, {
    agente: "Busca",
    acao: `Achou ${aptos.length} ${aptos.length === 1 ? "fornecedor" : "fornecedores"} na base.`,
    motivo: cortados.length
      ? `Cortou ${cortados.length}: ${cortados.map((c) => `${c.nome} (${c.motivoCorte})`).join("; ")}.`
      : "Todos com canal ativo vendem o item.",
    pedidoId: m.pedidoId,
    itemPedidoId: m.itemPedidoId,
    fornecedorIds: aptos.map((c) => c.fornecedorId),
  });

  const agora = Date.now();
  const prazoMs = PRAZO_RESPOSTAS_SEG() * 1000;
  await avancarItem(
    m.itemPedidoId,
    "busca_concluida",
    { agente: "Busca", motivo: "A busca terminou." },
    { prazoRespostasEm: new Date(agora + prazoMs), lembreteEm: new Date(agora + prazoMs * FRACAO_LEMBRETE) },
  );
}

export function ligarBusca() {
  aoEntrarItem("buscando", buscar);
}
