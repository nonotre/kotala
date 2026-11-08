"use server";
// Ações da tela Contratos. Como lib/equipe.ts, gravam direto no banco (não roda agente
// nenhum); a regra e o rastro moram em src/agentes/memoria/contrato.ts. Quem age é o id
// da sessão guardada no navegador (sem segurança de verdade, ver docs/perfil-login.md).

import { revalidatePath } from "next/cache";
import { criarContrato, encerrarContrato } from "../../../src/agentes/memoria/contrato.ts";

type Resultado = { ok: boolean; erro?: string };

export type FormContrato = {
  itemChave: string;
  descricao: string;
  fornecedorId: string;
  /** Como digitado: "36,50" ou "36.50". */
  preco: string;
  unidade: string;
  /** "AAAA-MM-DD" (campo de data do navegador). */
  inicio: string;
  fim: string;
  observacao: string;
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Preço em reais como a pessoa digita: "1.234,56", "36,5", "36.50". */
function lerPreco(t: string): number {
  const s = String(t ?? "").trim().replace(/^R\$\s*/i, "");
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return /^\d+(\.\d{1,2})?$/.test(normal) ? Number(normal) : NaN;
}

export async function criarContratoNaTela(f: FormContrato, porId: string | null): Promise<Resultado> {
  if (!DATA.test(String(f.inicio)) || !DATA.test(String(f.fim))) return { ok: false, erro: "Preencha o início e o fim do contrato." };
  const preco = lerPreco(f.preco);
  if (!Number.isFinite(preco)) return { ok: false, erro: "Preço unitário inválido. Use, por exemplo, 36,50." };
  // O dia todo, no horário de Brasília: começa às 0h do início e vale até o fim do último dia.
  const r = await criarContrato({
    itemChave: String(f.itemChave ?? ""),
    descricao: String(f.descricao ?? ""),
    fornecedorId: String(f.fornecedorId ?? ""),
    precoUnitario: preco,
    unidade: String(f.unidade ?? ""),
    inicio: new Date(`${f.inicio}T00:00:00-03:00`),
    fim: new Date(`${f.fim}T23:59:59-03:00`),
    observacao: String(f.observacao ?? "").slice(0, 500),
    criadoPor: porId,
  });
  revalidatePath("/contratos");
  return r.ok ? { ok: true } : { ok: false, erro: r.erro };
}

export async function encerrarContratoNaTela(id: string, porId: string | null, motivo: string): Promise<Resultado> {
  const r = await encerrarContrato(String(id), porId, String(motivo ?? "").slice(0, 300));
  revalidatePath("/contratos");
  return r.ok ? { ok: true } : { ok: false, erro: r.erro };
}
