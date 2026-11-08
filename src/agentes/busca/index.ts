// R3: busca de fornecedores. Por enquanto só na base: fornecedores reais que
// entraram pelo bot e fornecedores simulados que vendem o item. A busca na
// internet (preço de referência com fonte) entra aqui depois, sem mudar o resto.

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { MAX_FORNECEDORES, FRACAO_LEMBRETE, prazoRespostasMs } from "../../config.ts";
import { db } from "../../nucleo/db/cliente.ts";
import { contato, cotacao, fornecedor, itemPedido, pedido } from "../../nucleo/db/schema.ts";
import { aoEntrarItem, avancarItem, type MudancaItem } from "../../nucleo/orquestrador/index.ts";
import { registrar } from "../../nucleo/registro.ts";
import { TODAS_PERSONAS, personaVende } from "../../simulador/personas.ts";
import { casarComBase, itemDaBase } from "../interpretador/base-itens.ts";
import { buscarNaInternet, ofertasDaInternet } from "./internet.ts";
import { acharRecompra, textoRecompra } from "../memoria/index.ts";
import { enviar } from "../../nucleo/mensagens/index.ts";
import { barrarItemNaBusca } from "../guardrail/rastro.ts";

export { buscarNaInternet, referenciasDoItem } from "./internet.ts";

const personaPorChave = new Map(TODAS_PERSONAS.map((p) => [p.chave, p]));
const ordemPersona = new Map(TODAS_PERSONAS.map((p, i) => [p.chave, i]));

/** Categoria do item na base (E6), pelo código ou pelo nome. */
export function categoriaDoItem(item: { itemChave: string | null; descricao: string }): string | null {
  if (item.itemChave?.startsWith("ITM-")) return itemDaBase(item.itemChave)?.categoria ?? null;
  const c = casarComBase(item.descricao);
  if (c.tipo === "unico") return c.item.categoria;
  if (c.tipo === "varios") return c.opcoes[0]!.categoria;
  return null;
}

const semAcento = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const mesmaCategoria = (a: string, b: string) => semAcento(a) === semAcento(b);

export type Candidato = { fornecedorId: string; nome: string; origem: "real" | "simulado"; chave?: string | null; motivoCorte?: string };

/** Fornecedores com canal ativo, com o motivo de cada corte. */
export async function candidatos(item: { descricao: string; itemChave: string | null }): Promise<Candidato[]> {
  const { descricao } = item;
  const categoria = categoriaDoItem(item);
  const linhas = await db
    .select({
      fornecedorId: fornecedor.id,
      nome: fornecedor.nome,
      origem: fornecedor.origem,
      chave: fornecedor.chave,
      parouEm: fornecedor.parouEm,
      bloqueadoEm: fornecedor.bloqueadoEm,
      motivoBloqueio: fornecedor.motivoBloqueio,
      categorias: fornecedor.categorias,
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
    else if (l.bloqueadoEm) motivoCorte = `Bloqueado pela empresa${l.motivoBloqueio ? `: ${l.motivoBloqueio}` : ""}`;
    else if (l.origem === "simulado" && l.chave && personaPorChave.has(l.chave) && !personaVende(personaPorChave.get(l.chave)!, descricao, categoria)) {
      motivoCorte = "Não vende este item";
    } else if (l.origem === "real" && categoria && l.categorias.length && !l.categorias.some((c) => mesmaCategoria(c, categoria))) {
      // Fornecedor real que disse o que vende só recebe cotação da categoria dele.
      motivoCorte = `Não vende ${categoria} (vende ${l.categorias.join(", ")})`;
    }
    lista.push({ fornecedorId: l.fornecedorId, nome: l.nome, origem: l.origem, chave: l.chave, motivoCorte });
  }
  // Reais primeiro (são quem pode responder de verdade); entre os simulados, as personas de comportamento especial antes.
  const ordem = (c: Candidato) => (c.origem === "real" ? -1 : (ordemPersona.get(c.chave ?? "") ?? 999));
  return lista.sort((a, b) => ordem(a) - ordem(b) || a.nome.localeCompare(b.nome));
}

async function buscar(m: MudancaItem) {
  // N6: voltar à busca abre uma rodada nova, com todos os fornecedores de novo.
  if (m.evento === "voltar_busca") {
    await db.update(itemPedido).set({ rodada: sql`${itemPedido.rodada} + 1` }).where(eq(itemPedido.id, m.itemPedidoId));
  }
  const [item] = await db.select().from(itemPedido).where(eq(itemPedido.id, m.itemPedidoId));
  if (!item) return;
  // S: item proibido ou controlado não vai à internet, às lojas nem a fornecedor.
  if (await barrarItemNaBusca(item)) return;

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

  // Busca real na internet: preço de referência com fonte, e as lojas online viram proposta.
  // Falha aqui não trava o pedido.
  let valorEstimado: number | null = null;
  let online = 0;
  try {
    const r = await buscarNaInternet(item.id);
    if (r.medianaUnitaria !== null) valorEstimado = r.medianaUnitaria * Number(item.quantidade);
    online = await ofertasDaInternet(item.id);
  } catch (erro) {
    await registrar(db, {
      agente: "Busca",
      acao: "A busca na internet falhou.",
      motivo: erro instanceof Error ? erro.message : String(erro),
      pedidoId: m.pedidoId,
      itemPedidoId: item.id,
    });
  }

  const todos = await candidatos(item);
  const aptos = todos.filter((c) => !c.motivoCorte).slice(0, MAX_FORNECEDORES());
  const cortados = todos.filter((c) => c.motivoCorte);

  if (!aptos.length && !online) {
    const [p] = await db.select({ compradorId: pedido.compradorId }).from(pedido).where(eq(pedido.id, item.pedidoId));
    // Avisa antes da transição: com o item final, o pedido pode ser concluído logo em seguida.
    if (p) {
      await enviar(
        p.compradorId,
        `Pedido ${item.pedidoId}: não achei fornecedor nem preço na internet para ${item.descricao}. ` +
          "Para tentar de novo, mande o pedido com outra descrição (marca, medida ou nome comercial), ou convide um fornecedor pelo link de cadastro.",
        { pedidoId: item.pedidoId, itemPedidoId: item.id, tipo: "aviso" },
      );
    }
    await avancarItem(m.itemPedidoId, "busca_sem_resultado", {
      agente: "Busca",
      acao: "Não achou fornecedor para este item.",
      motivo: cortados.length ? `Cortados: ${cortados.map((c) => `${c.nome} (${c.motivoCorte})`).join("; ")}.` : "Nenhum fornecedor cadastrado.",
    });
    return;
  }

  if (aptos.length) await db
    .insert(cotacao)
    .values(aptos.map((c) => ({ itemPedidoId: item.id, fornecedorId: c.fornecedorId, rodada: item.rodada })))
    .onConflictDoNothing();

  await registrar(db, {
    agente: "Busca",
    acao: `Achou ${aptos.length} ${aptos.length === 1 ? "fornecedor" : "fornecedores"} na base${online ? ` e ${online} ${online === 1 ? "loja online" : "lojas online"}` : ""}.`,
    motivo: cortados.length
      ? `Cortou ${cortados.length}: ${cortados.map((c) => `${c.nome} (${c.motivoCorte})`).join("; ")}.`
      : "Todos com canal ativo vendem o item.",
    pedidoId: m.pedidoId,
    itemPedidoId: m.itemPedidoId,
    fornecedorIds: aptos.map((c) => c.fornecedorId),
  });

  const agora = Date.now();
  const prazoMs = prazoRespostasMs(valorEstimado);
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
