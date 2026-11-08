"use client";
// Base de Dados: a casca comum às abas Fornecedores e Itens.
// A busca e a categoria valem para as duas abas e vão junto no endereço quando se troca de aba.

import { Search, Select, SelectItem } from "@carbon/react";
import type { ReactNode } from "react";
import { Abas } from "@/components/Abas";
import { CabecalhoPagina } from "@/components/Pagina";
import s from "./consulta.module.scss";

export type AbaBase = "fornecedores" | "itens";

export type FiltrosBase = { busca: string; categoria: string };

const CONTEXTO: Record<AbaBase, string> = {
  fornecedores:
    "A confiança de cada fornecedor real é conferida na Receita (CNPJ), nas listas de empresas punidas do Portal da Transparência (CEIS e CNEP), no TJSP, no site e no histórico de compras. Lojas achadas na internet entram como referência de preço e não são contatadas.",
  itens: "Os materiais que já foram pedidos, com o que foi pago e o preço de referência da internet. Itens que não estavam na base são cadastrados pelo assistente.",
};

const BUSCA: Record<AbaBase, { rotulo: string; dica: string }> = {
  fornecedores: { rotulo: "Buscar fornecedor", dica: "Buscar por nome, ID, CNPJ, região ou canal" },
  itens: { rotulo: "Buscar item", dica: "Buscar por nome, código ou especificação" },
};

export const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** A mesma categoria, sem diferença de acento ou maiúscula. */
export function mesmaCategoria(a: string | null | undefined, b: string): boolean {
  return !!a && normalizar(a) === normalizar(b);
}

/** Endereço da aba com a busca, a categoria e o que for só da aba (filtro, item marcado). */
export function enderecoDaBase(aba: AbaBase, f: FiltrosBase, extra: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams();
  if (f.busca.trim()) q.set("busca", f.busca.trim());
  if (f.categoria) q.set("categoria", f.categoria);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const texto = q.toString();
  return `/${aba}${texto ? `?${texto}` : ""}`;
}

/** Título fixo "Base de Dados"; só a aba e a frase mudam. */
export function CabecalhoBaseDados({ ativa, filtros, lado }: { ativa: AbaBase; filtros: FiltrosBase; lado?: ReactNode }) {
  return (
    <CabecalhoPagina
      titulo="Base de Dados"
      contexto={CONTEXTO[ativa]}
      lado={lado}
      abas={
        <Abas
          ativa={ativa}
          rotulo="Abas da Base de Dados"
          itens={[
            { id: "fornecedores", rotulo: "Fornecedores", href: enderecoDaBase("fornecedores", filtros) },
            { id: "itens", rotulo: "Itens", href: enderecoDaBase("itens", filtros) },
          ]}
        />
      }
    />
  );
}

/** Busca e filtro de categoria, comuns às duas abas. */
export function ControlesBaseDados({ aba, filtros, categorias, aoMudar }: { aba: AbaBase; filtros: FiltrosBase; categorias: string[]; aoMudar: (f: FiltrosBase) => void }) {
  // A categoria do endereço pode não existir mais no banco: continua na lista para poder ser desfeita.
  const opcoes = filtros.categoria && !categorias.some((c) => mesmaCategoria(c, filtros.categoria)) ? [...categorias, filtros.categoria] : categorias;
  return (
    <div className={s.controlesBase}>
      <Search
        size="lg"
        labelText={BUSCA[aba].rotulo}
        placeholder={BUSCA[aba].dica}
        closeButtonLabelText="Limpar busca"
        value={filtros.busca}
        onChange={(e) => aoMudar({ ...filtros, busca: e.target.value })}
        onClear={() => aoMudar({ ...filtros, busca: "" })}
      />
      <Select id={`${aba}-categoria`} labelText="Categoria" hideLabel size="lg" className={s.seletorCategoria} value={filtros.categoria} onChange={(e) => aoMudar({ ...filtros, categoria: e.target.value })}>
        <SelectItem value="" text="Todas as categorias" />
        {opcoes.map((c) => (
          <SelectItem key={c} value={c} text={c} />
        ))}
      </Select>
    </div>
  );
}
