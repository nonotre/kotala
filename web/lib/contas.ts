"use server";
// Frente 2: entrar, criar conta e conferir a sessão. A regra mora em src/contas.ts;
// aqui só a ponte para as telas. Sem cookie: quem guarda a sessão é o navegador.

import * as contas from "../../src/contas.ts";

export type { Resposta, Sessao } from "../../src/contas.ts";

export async function entrar(login: string, senha: string): Promise<contas.Resposta> {
  return contas.entrar({ login: String(login), senha: String(senha) });
}

export async function criarConta(nome: string, login: string, senha: string): Promise<contas.Resposta> {
  return contas.criarConta({ nome: String(nome), login: String(login), senha: String(senha) });
}

export async function conferirSessao(id: string): Promise<contas.Sessao | null> {
  return contas.conferirSessao(String(id));
}

export type ContatoLigado = { canal: string; papel: string; nome: string | null };

export async function contatosLigados(usuarioId: string): Promise<ContatoLigado[]> {
  if (!/^[0-9a-f-]{36}$/.test(String(usuarioId))) return [];
  const lista = await contas.contatosDoUsuario(String(usuarioId));
  return lista.map(({ canal, papel, nome }) => ({ canal, papel, nome }));
}
