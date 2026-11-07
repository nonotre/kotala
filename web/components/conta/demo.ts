"use client";
// Conta de demonstração: empresas, locais de entrega e convites. O kotala ainda não guarda nada disso no servidor;
// o que se muda aqui fica só neste navegador (localStorage). Todos os dados são fictícios.

import { useCallback, useSyncExternalStore } from "react";

export type Usuario = { nome: string; email: string; papel: string };

export type Empresa = {
  id: string;
  nome: string;
  cnpj: string;
  faturamento: { razaoSocial: string; endereco: string; cep: string };
  usuarios: Usuario[];
};

export type LocalEntrega = {
  id: string;
  empresaId: string;
  apelido: string;
  endereco: string;
  cep: string;
  janela: string;
  restricao: string;
  padrao: boolean;
};

export type Convite = { email: string; papel: string; empresaId: string };

export const PAPEIS = ["Comprador", "Aprovador", "Só leitura"];

/** Texto do aviso que toda tela da conta mostra. */
export const AVISO_DEMONSTRACAO = "Demonstração: ainda não salva";

export const EMPRESAS: Empresa[] = [
  {
    id: "e-exemplo",
    nome: "Construtora Exemplo",
    cnpj: "00.000.000/0001-00",
    faturamento: { razaoSocial: "Construtora Exemplo Ltda.", endereco: "Rua de Exemplo, 100, Centro, Cidade Exemplo", cep: "00000-000" },
    usuarios: [
      { nome: "Comprador de exemplo", email: "compras@construtora.exemplo", papel: "Comprador" },
      { nome: "Engenharia de exemplo", email: "engenharia@construtora.exemplo", papel: "Aprovador" },
    ],
  },
  {
    id: "e-reformas",
    nome: "Reformas Exemplo",
    cnpj: "00.000.000/0002-00",
    faturamento: { razaoSocial: "Reformas Exemplo ME", endereco: "Avenida de Exemplo, 900, Bairro Exemplo, Cidade Exemplo", cep: "00000-100" },
    usuarios: [{ nome: "Comprador de exemplo", email: "compras@construtora.exemplo", papel: "Comprador" }],
  },
];

/** Quem está "entrado" na demonstração. */
export const CONTA_EXEMPLO = { nome: "Comprador de exemplo", email: "compras@construtora.exemplo" };

const LOCAIS_INICIAIS: LocalEntrega[] = [
  {
    id: "l-alfa",
    empresaId: "e-exemplo",
    apelido: "Obra Alfa",
    endereco: "Rua de Exemplo, 200, Cidade Exemplo",
    cep: "00000-001",
    janela: "Segunda a sexta, das 7h às 16h",
    restricao: "Sem restrição anotada",
    padrao: true,
  },
  {
    id: "l-beta",
    empresaId: "e-exemplo",
    apelido: "Obra Beta",
    endereco: "Travessa de Exemplo, 35, Cidade Exemplo",
    cep: "00000-002",
    janela: "",
    restricao: "Rua estreita: só caminhão pequeno",
    padrao: false,
  },
  {
    id: "l-gama",
    empresaId: "e-reformas",
    apelido: "Reforma Gama",
    endereco: "Alameda de Exemplo, 12, Cidade Exemplo",
    cep: "00000-003",
    janela: "Sábado, das 8h às 12h",
    restricao: "Sem restrição anotada",
    padrao: true,
  },
];

type Conta = { empresaAtiva: string; locais: LocalEntrega[]; convites: Convite[] };

const INICIAL: Conta = { empresaAtiva: EMPRESAS[0].id, locais: LOCAIS_INICIAIS, convites: [] };
const CHAVE = "kotala-demo-conta";

let atual: Conta | null = null;
const ouvintes = new Set<() => void>();

function ler(): Conta {
  if (atual) return atual;
  try {
    const bruto = localStorage.getItem(CHAVE);
    atual = bruto ? { ...INICIAL, ...(JSON.parse(bruto) as Partial<Conta>) } : INICIAL;
  } catch {
    atual = INICIAL;
  }
  return atual;
}

function gravar(nova: Conta) {
  atual = nova;
  try {
    localStorage.setItem(CHAVE, JSON.stringify(nova));
  } catch {
    // Sem armazenamento, vale até recarregar a página.
  }
  ouvintes.forEach((o) => o());
}

function assinar(o: () => void) {
  ouvintes.add(o);
  return () => {
    ouvintes.delete(o);
  };
}

/** Volta a demonstração ao começo. */
export function recomecarDemonstracao() {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    // nada a limpar
  }
  gravar(INICIAL);
}

/** A conta de demonstração: empresa em uso, os locais dela e os convites. */
export function useConta() {
  const conta = useSyncExternalStore(assinar, ler, () => INICIAL);
  const empresa = EMPRESAS.find((e) => e.id === conta.empresaAtiva) ?? EMPRESAS[0];
  const locais = conta.locais.filter((l) => l.empresaId === empresa.id);
  const trocarEmpresa = useCallback((id: string) => gravar({ ...ler(), empresaAtiva: id }), []);
  const guardarLocais = useCallback((daEmpresa: LocalEntrega[]) => {
    const c = ler();
    gravar({ ...c, locais: [...c.locais.filter((l) => l.empresaId !== c.empresaAtiva), ...daEmpresa] });
  }, []);
  const convidar = useCallback((c: Convite) => gravar({ ...ler(), convites: [...ler().convites, c] }), []);
  return {
    empresa,
    locais,
    convites: conta.convites.filter((c) => c.empresaId === empresa.id),
    todosConvites: conta.convites,
    todosLocais: conta.locais,
    trocarEmpresa,
    guardarLocais,
    convidar,
  };
}

// ---------- Formato ----------

/** 8 números, com o hífen. */
export function formatarCep(texto: string): string {
  const n = texto.replace(/\D/g, "").slice(0, 8);
  return n.length > 5 ? `${n.slice(0, 5)}-${n.slice(5)}` : n;
}

export function cepValido(cep: string): boolean {
  return /^\d{5}-\d{3}$/.test(cep);
}

/** Convite só para e-mail fictício: a demonstração não manda nada, mas também não guarda dado real. */
export function emailDeExemplo(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.exemplo$/i.test(email);
}
