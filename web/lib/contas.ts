"use server";
// Frente 2: entrar, criar conta, sair, a conta de quem entrou e (Bloco 4) empresas e locais de entrega.
// A regra mora em src/contas.ts; aqui só a ponte para as telas. Quem age é sempre o usuário da
// sessão do cookie (lib/sessao-servidor.ts), nunca um id que venha do navegador.

import { revalidatePath } from "next/cache";
import * as contas from "../../src/contas.ts";
import { abrirSessao, exigirUsuario, fecharSessao, usuarioDaSessao } from "./sessao-servidor.ts";

export type { Resposta, Sessao } from "../../src/contas.ts";

export async function entrar(login: string, senha: string): Promise<contas.Resposta> {
  const r = await contas.entrar({ login: String(login), senha: String(senha) });
  if (r.ok) await abrirSessao(r.sessao.id);
  return r;
}

export async function criarConta(nome: string, login: string, senha: string): Promise<contas.Resposta> {
  const r = await contas.criarConta({ nome: String(nome), login: String(login), senha: String(senha) });
  if (r.ok) await abrirSessao(r.sessao.id);
  return r;
}

/** Apaga a sessão no banco e o cookie. */
export async function sair(): Promise<void> {
  await fecharSessao();
}

/** Quem entrou, segundo o cookie. O navegador usa para acertar o espelho (useSessao). */
export async function conferirSessao(): Promise<contas.Sessao | null> {
  return usuarioDaSessao();
}

export type ContatoLigado = { canal: string; papel: string; nome: string | null };

export async function contatosLigados(): Promise<ContatoLigado[]> {
  const u = await usuarioDaSessao();
  if (!u) return [];
  const lista = await contas.contatosDoUsuario(u.id);
  return lista.map(({ canal, papel, nome }) => ({ canal, papel, nome }));
}

/** Código para mandar ao bot: "/vincular CODIGO". Vale 15 minutos e uma vez. */
export async function gerarCodigoTelegram(): Promise<{ ok: true; codigo: string; expiraEm: string } | { ok: false; erro: string }> {
  try {
    const u = await exigirUsuario();
    const c = await contas.gerarCodigoVinculo(u.id);
    return { ok: true, codigo: c.codigo, expiraEm: c.expiraEm.toISOString() };
  } catch {
    return { ok: false, erro: "Não deu para gerar o código agora. Tente de novo." };
  }
}

// ---------- Empresas e locais de entrega (E4 e E8) ----------

export type Empresa = contas.Empresa;
export type Local = contas.Local;
export type DadosEmpresa = contas.DadosEmpresa;
export type DadosLocal = contas.DadosLocal;
export type PessoaDaEmpresa = { id: string; nome: string; login: string; papel: "comprador" | "gestor"; voce: boolean };

/** Tudo o que as telas da conta mostram: as empresas, a ativa de quem entrou, os locais e as pessoas. */
export type ContaCompleta = {
  empresaAtiva: string;
  empresas: Empresa[];
  locais: Local[];
  pessoas: (PessoaDaEmpresa & { empresaId: string | null })[];
};

export async function dadosDaConta(): Promise<ContaCompleta> {
  const u = await exigirUsuario();
  const empresaAtiva = await contas.empresaAtivaDe(u.id);
  const [empresas, locais, pessoas] = await Promise.all([contas.listarEmpresas(), contas.listarLocais(), contas.pessoasComEmpresa()]);
  return { empresaAtiva, empresas, locais, pessoas: pessoas.map((p) => ({ ...p, voce: p.id === u.id })) };
}

type Feito<T = object> = ({ ok: true } & T) | { ok: false; erro: string };

/** Erro de sessão vira mensagem; o resto sobe. */
async function comSessao<T>(fn: (u: contas.Sessao) => Promise<Feito<T>>): Promise<Feito<T>> {
  const u = await usuarioDaSessao();
  if (!u) return { ok: false, erro: "Entre de novo para continuar." };
  return fn(u);
}

function revalidarConta() {
  // O cabeçalho (seletor de empresa) está no layout: todo mundo é revalidado.
  revalidatePath("/", "layout");
}

export async function trocarEmpresaAtiva(empresaId: string): Promise<Feito> {
  return comSessao(async (u) => {
    const r = await contas.trocarEmpresaAtiva(u.id, String(empresaId));
    if (r.ok) revalidarConta();
    return r;
  });
}

export async function salvarEmpresa(dados: DadosEmpresa, id?: string): Promise<Feito<{ empresa: Empresa }>> {
  return comSessao(async () => {
    const r = await contas.salvarEmpresa(dados, id === undefined ? undefined : String(id));
    if (r.ok) revalidarConta();
    return r;
  });
}

/** Locais sempre da empresa ativa de quem entrou: a tela não escolhe a empresa pelo id. */
export async function salvarLocal(dados: DadosLocal, id?: string): Promise<Feito<{ local: Local }>> {
  return comSessao(async (u) => {
    const r = await contas.salvarLocal(await contas.empresaAtivaDe(u.id), dados, id === undefined ? undefined : String(id));
    if (r.ok) revalidarConta();
    return r;
  });
}

export async function tornarLocalPadrao(id: string): Promise<Feito> {
  return comSessao(async (u) => {
    const r = await contas.tornarLocalPadrao(await contas.empresaAtivaDe(u.id), String(id));
    if (r.ok) revalidarConta();
    return r;
  });
}

export async function removerLocal(id: string): Promise<Feito<{ herdeiro: Local | null }>> {
  return comSessao(async (u) => {
    const r = await contas.removerLocal(await contas.empresaAtivaDe(u.id), String(id));
    if (r.ok) revalidarConta();
    return r;
  });
}
