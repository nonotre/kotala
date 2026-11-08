// X2: contrato anual. O preço é negociado no início do período, o vencedor mantém o
// valor até o fim, e aquele material passa a ser comprado com ele (informacao.md da
// Ester). Item confirmado com contrato vigente e ativo não vai à cotação: o comprador
// escolhe, em dois toques, pedir direto ao fornecedor do contrato ou cotar mesmo assim.
//
// Sem estado novo (o enum do banco não muda sem migração): o item espera em
// "aguardando_recompra", e o evento que o levou até lá diz que é contrato
// (`dados.tipo = "contrato"`, com o id). A tela Contratos cria, lista e encerra.
//
// A tela carrega este módulo: nada de ler arquivo pelo import.meta.url aqui.

import { and, asc, desc, eq, gte, lte, ne } from "drizzle-orm";
import { normalizarUnidade } from "../../dominio/unidades.ts";
import { db } from "../../nucleo/db/cliente.ts";
import { contrato, evento, fornecedor, usuario } from "../../nucleo/db/schema.ts";
import { contatoAtivoDoFornecedor } from "../../nucleo/mensagens/index.ts";
import { registrar } from "../../nucleo/registro.ts";
import { quantidade } from "../../texto.ts";
import { formatarBRL } from "../comparador/calculo.ts";
import { mesmoItem } from "./index.ts";

export type ContratoVigente = {
  id: string;
  itemChave: string;
  descricao: string;
  fornecedorId: string;
  fornecedorNome: string;
  simulado: boolean;
  precoUnitario: number;
  unidade: string;
  inicio: Date;
  fim: Date;
  observacao: string | null;
};

export type AchadoContrato =
  /** Vale: o item pode ir direto ao fornecedor do contrato. */
  | { tipo: "pedir_direto"; contrato: ContratoVigente }
  /** Há contrato do item, mas não dá para usar (fornecedor parado ou bloqueado, unidade diferente): cota normal. */
  | { tipo: "indisponivel"; contrato: ContratoVigente; motivo: string };

type ItemDoPedido = { itemChave: string | null; descricao: string; unidade: string };

const ehCodigoDaBase = (c: string | null | undefined) => !!c && /^ITM-\d+$/i.test(c);

/**
 * O contrato cobre o item? Dois códigos da base (ITM-...) só batem se forem iguais: são itens
 * diferentes do cadastro. Sem código dos dois lados, vale o mesmo critério da recompra
 * (termos decisivos iguais, quase todas as palavras em comum), pela chave ou pela descrição.
 */
export function contratoCobreItem(c: { itemChave: string; descricao: string }, item: { itemChave: string | null; descricao: string }): boolean {
  if (item.itemChave && c.itemChave.toUpperCase() === item.itemChave.toUpperCase()) return true;
  if (ehCodigoDaBase(c.itemChave) && ehCodigoDaBase(item.itemChave)) return false;
  return mesmoItem(c.itemChave, item.itemChave ?? item.descricao) || mesmoItem(c.descricao, item.descricao);
}

/** Mesma unidade de compra (pelo nome normalizado: "sacos" = "saco"); sem reconhecer, compara o texto. */
export function mesmaUnidade(a: string, b: string): boolean {
  const ua = normalizarUnidade(a);
  const ub = normalizarUnidade(b);
  if (ua && ub) return ua.id === ub.id;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

const linhaParaContrato = (c: typeof contrato.$inferSelect, f: typeof fornecedor.$inferSelect): ContratoVigente => ({
  id: c.id,
  itemChave: c.itemChave,
  descricao: c.descricao,
  fornecedorId: f.id,
  fornecedorNome: f.nome,
  simulado: f.origem === "simulado",
  precoUnitario: Number(c.precoUnitario),
  unidade: c.unidade,
  inicio: c.inicio,
  fim: c.fim,
  observacao: c.observacao,
});

/** Por que o contrato não serve para este item agora; null quando serve. */
async function motivoIndisponivel(c: ContratoVigente, f: typeof fornecedor.$inferSelect, item: ItemDoPedido): Promise<string | null> {
  if (f.bloqueadoEm) return `${f.nome} está bloqueado pela empresa${f.motivoBloqueio ? ` (${f.motivoBloqueio})` : ""}`;
  if (f.parouEm) return `${f.nome} pediu para não receber mensagens`;
  if (!mesmaUnidade(c.unidade, item.unidade)) return `o contrato é por ${c.unidade} e o pedido, por ${item.unidade}`;
  if (!(await contatoAtivoDoFornecedor(f.id))) return `${f.nome} não tem canal ativo para receber o pedido`;
  return null;
}

/**
 * Contrato vigente (ativo, com o período cobrindo `agora`) que cobre o item. Entre os que
 * servem, o de menor preço. Sem nenhum que sirva, devolve o primeiro indisponível com o
 * motivo, para o rastro e o aviso ao comprador. Null quando o item não tem contrato.
 */
export async function acharContrato(item: ItemDoPedido, agora = new Date()): Promise<AchadoContrato | null> {
  const linhas = await db
    .select({ c: contrato, f: fornecedor })
    .from(contrato)
    .innerJoin(fornecedor, eq(fornecedor.id, contrato.fornecedorId))
    .where(and(eq(contrato.ativo, true), lte(contrato.inicio, agora), gte(contrato.fim, agora)))
    .orderBy(asc(contrato.precoUnitario), asc(contrato.fim));
  let indisponivel: AchadoContrato | null = null;
  for (const { c, f } of linhas) {
    if (!contratoCobreItem(c, item)) continue;
    const vigente = linhaParaContrato(c, f);
    const motivo = await motivoIndisponivel(vigente, f, item);
    if (!motivo) return { tipo: "pedir_direto", contrato: vigente };
    indisponivel ??= { tipo: "indisponivel", contrato: vigente, motivo };
  }
  return indisponivel;
}

/** O contrato pelo id, se ainda vale para o item (para o segundo toque, que pode vir bem depois do primeiro). */
export async function conferirContrato(id: string, item: ItemDoPedido, agora = new Date()): Promise<AchadoContrato | { tipo: "nao_vale"; motivo: string }> {
  const [l] = await db.select({ c: contrato, f: fornecedor }).from(contrato).innerJoin(fornecedor, eq(fornecedor.id, contrato.fornecedorId)).where(eq(contrato.id, id));
  if (!l) return { tipo: "nao_vale", motivo: "o contrato não existe mais" };
  if (!l.c.ativo) return { tipo: "nao_vale", motivo: "o contrato foi encerrado" };
  if (l.c.inicio > agora || l.c.fim < agora) return { tipo: "nao_vale", motivo: "o contrato não está vigente" };
  if (!contratoCobreItem(l.c, item)) return { tipo: "nao_vale", motivo: "o contrato é de outro item" };
  const vigente = linhaParaContrato(l.c, l.f);
  const motivo = await motivoIndisponivel(vigente, l.f, item);
  return motivo ? { tipo: "indisponivel", contrato: vigente, motivo } : { tipo: "pedir_direto", contrato: vigente };
}

/**
 * Id do contrato que levou o item a "aguardando_recompra" (o evento da transição, com
 * `dados.tipo = "contrato"`); null quando a espera é de recompra comum.
 */
export async function contratoPropostoAoItem(itemPedidoId: number): Promise<string | null> {
  const [e] = await db
    .select({ dados: evento.dados })
    .from(evento)
    .where(and(eq(evento.itemPedidoId, itemPedidoId), eq(evento.paraEstado, "aguardando_recompra")))
    .orderBy(desc(evento.criadoEm))
    .limit(1);
  const d = e?.dados as { tipo?: unknown; contratoId?: unknown } | null | undefined;
  return d?.tipo === "contrato" && typeof d.contratoId === "string" ? d.contratoId : null;
}

/** Para a tela do pedido: o contrato proposto ao item que espera a escolha, como está agora. */
export async function contratoDoItemEmEspera(item: { id: number } & ItemDoPedido): Promise<(ContratoVigente & { motivoIndisponivel: string | null }) | null> {
  const id = await contratoPropostoAoItem(item.id);
  if (!id) return null;
  const r = await conferirContrato(id, item);
  if (r.tipo === "nao_vale") return null;
  return { ...r.contrato, motivoIndisponivel: r.tipo === "indisponivel" ? r.motivo : null };
}

export const dataCurta = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** "Este item tem contrato com X até DATA, a R$ Y por unidade: pedir direto?" */
export function textoContrato(pedidoId: number, item: { descricao: string; quantidade: string | number; unidade: string }, c: ContratoVigente): string {
  const total = c.precoUnitario * Number(item.quantidade);
  return [
    `Pedido ${pedidoId}: ${item.descricao}.`,
    `Este item tem contrato com ${c.fornecedorNome}${c.simulado ? " (simulado)" : ""} até ${dataCurta(c.fim)}, a ${formatarBRL(c.precoUnitario)} por ${item.unidade}: pedir direto?`,
    "",
    `${quantidade(item.quantidade, item.unidade)} pelo preço do contrato: ${formatarBRL(total)} de produto.${c.observacao ? ` Condições do contrato: ${c.observacao}` : ""}`,
    "Pedindo direto, o pedido de compra vai ao fornecedor do contrato, sem cotação. Se preferir, dá para cotar mesmo assim.",
  ].join("\n");
}

// ---------- Tela Contratos: listar, criar, encerrar ----------

export type SituacaoContrato = "vigente" | "agendado" | "vencido" | "encerrado";

export type LinhaContrato = ContratoVigente & { ativo: boolean; situacao: SituacaoContrato; criadoPor: string | null; criadoEm: Date };

export function situacaoDoContrato(c: { ativo: boolean; inicio: Date; fim: Date }, agora = new Date()): SituacaoContrato {
  if (!c.ativo) return "encerrado";
  if (c.inicio > agora) return "agendado";
  if (c.fim < agora) return "vencido";
  return "vigente";
}

export async function listarContratos(agora = new Date()): Promise<LinhaContrato[]> {
  const linhas = await db
    .select({ c: contrato, f: fornecedor, por: usuario.nome })
    .from(contrato)
    .innerJoin(fornecedor, eq(fornecedor.id, contrato.fornecedorId))
    .leftJoin(usuario, eq(usuario.id, contrato.criadoPor))
    .orderBy(desc(contrato.ativo), asc(contrato.fim));
  const ordem: Record<SituacaoContrato, number> = { vigente: 0, agendado: 1, vencido: 2, encerrado: 3 };
  return linhas
    .map(({ c, f, por }) => ({ ...linhaParaContrato(c, f), ativo: c.ativo, situacao: situacaoDoContrato(c, agora), criadoPor: por, criadoEm: c.criadoEm }))
    .sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || a.fim.getTime() - b.fim.getTime());
}

export type NovoContrato = {
  itemChave: string;
  descricao: string;
  fornecedorId: string;
  precoUnitario: number;
  unidade: string;
  inicio: Date;
  fim: Date;
  observacao?: string | null;
  /** Id do usuário que criou, quando é um usuário de verdade. */
  criadoPor?: string | null;
};

type Resultado = { ok: true; id: string } | { ok: false; erro: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIA = 24 * 3600_000;
/** Teto de sanidade: contrato "anual" de até 3 anos. */
const MAX_DIAS_CONTRATO = 3 * 366;

async function nomeDoUsuario(id: string | null | undefined): Promise<{ id: string; nome: string } | null> {
  if (!id || !UUID.test(id)) return null;
  const [u] = await db.select({ id: usuario.id, nome: usuario.nome }).from(usuario).where(eq(usuario.id, id));
  return u ?? null;
}

/**
 * Cria o contrato, conferido em código: item, fornecedor que existe e não está bloqueado,
 * preço positivo, período com fim depois do início (no máximo 3 anos) e nenhum outro
 * contrato ativo do mesmo item com período que se sobreponha. Fica no rastro.
 */
export async function criarContrato(n: NovoContrato): Promise<Resultado> {
  const itemChave = n.itemChave?.trim();
  const descricao = n.descricao?.trim();
  const unidade = n.unidade?.trim();
  if (!itemChave || !descricao) return { ok: false, erro: "Escolha o item do contrato." };
  if (!unidade) return { ok: false, erro: "Diga a unidade do preço." };
  if (!UUID.test(String(n.fornecedorId))) return { ok: false, erro: "Escolha o fornecedor." };
  const preco = Number(n.precoUnitario);
  if (!Number.isFinite(preco) || preco <= 0 || preco > 1e9) return { ok: false, erro: "O preço unitário precisa ser maior que zero." };
  const inicio = new Date(n.inicio);
  const fim = new Date(n.fim);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) return { ok: false, erro: "Datas inválidas." };
  if (fim <= inicio) return { ok: false, erro: "O fim do contrato precisa ser depois do início." };
  if ((fim.getTime() - inicio.getTime()) / DIA > MAX_DIAS_CONTRATO) return { ok: false, erro: "O período passa de 3 anos. Confira as datas." };
  if (fim < new Date()) return { ok: false, erro: "O contrato já terminou. Confira a data de fim." };

  const [f] = await db.select().from(fornecedor).where(eq(fornecedor.id, n.fornecedorId));
  if (!f) return { ok: false, erro: "Fornecedor não encontrado." };
  if (f.bloqueadoEm) return { ok: false, erro: `${f.nome} está bloqueado. Desbloqueie antes de fazer contrato.` };

  const sobrepostos = await db
    .select({ c: contrato, nome: fornecedor.nome })
    .from(contrato)
    .innerJoin(fornecedor, eq(fornecedor.id, contrato.fornecedorId))
    .where(and(eq(contrato.ativo, true), lte(contrato.inicio, fim), gte(contrato.fim, inicio)));
  const conflito = sobrepostos.find((s) => contratoCobreItem(s.c, { itemChave, descricao }));
  if (conflito) {
    return { ok: false, erro: `Já há contrato ativo de ${conflito.c.descricao} com ${conflito.nome} até ${dataCurta(conflito.c.fim)}. Encerre-o antes ou ajuste o período.` };
  }

  const autor = await nomeDoUsuario(n.criadoPor);
  const observacao = n.observacao?.trim() || null;
  const id = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(contrato)
      .values({ itemChave, descricao, fornecedorId: f.id, precoUnitario: preco.toFixed(2), unidade, inicio, fim, observacao, criadoPor: autor?.id ?? null })
      .returning({ id: contrato.id });
    await registrar(tx, {
      agente: "Comprador",
      acao: `Criou contrato de ${descricao} com ${f.nome}: ${formatarBRL(preco)} por ${unidade}, de ${dataCurta(inicio)} até ${dataCurta(fim)}.`,
      motivo: autor ? `Contrato cadastrado na tela por ${autor.nome}.` : "Contrato cadastrado na tela.",
      fornecedorIds: [f.id],
      dados: { tipo: "contrato_criado", contratoId: c!.id, itemChave, precoUnitario: preco, unidade, inicio: inicio.toISOString(), fim: fim.toISOString() },
    });
    return c!.id;
  });
  return { ok: true, id };
}

/** Encerra o contrato (ativo = false); o histórico fica. Itens já pedidos pelo contrato não mudam. */
export async function encerrarContrato(id: string, porId?: string | null, motivo?: string | null): Promise<Resultado> {
  if (!UUID.test(String(id))) return { ok: false, erro: "Contrato inválido." };
  const [l] = await db.select({ c: contrato, nome: fornecedor.nome }).from(contrato).innerJoin(fornecedor, eq(fornecedor.id, contrato.fornecedorId)).where(eq(contrato.id, id));
  if (!l) return { ok: false, erro: "Contrato não encontrado." };
  if (!l.c.ativo) return { ok: true, id };
  const autor = await nomeDoUsuario(porId);
  const porque = motivo?.trim();
  await db.transaction(async (tx) => {
    await tx.update(contrato).set({ ativo: false }).where(and(eq(contrato.id, id), ne(contrato.ativo, false)));
    await registrar(tx, {
      agente: "Comprador",
      acao: `Encerrou o contrato de ${l.c.descricao} com ${l.nome}.`,
      motivo: [autor ? `Encerrado na tela por ${autor.nome}.` : "Encerrado na tela.", porque ? `Motivo: ${porque}.` : ""].filter(Boolean).join(" "),
      fornecedorIds: [l.c.fornecedorId],
      dados: { tipo: "contrato_encerrado", contratoId: id, motivo: porque ?? null },
    });
  });
  return { ok: true, id };
}
