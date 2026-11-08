// Frente 2: contas de quem entra nas telas. Login simples, sem pretensão de segurança:
// a senha vai com hash scrypt, e a sessão fica só no navegador (ver web/components/conta/sessao.ts).
// Cada usuário tem um contato "web" (endereço = id do usuário), que é o chat dele no navegador,
// e pode ter contatos de outros canais ligados à mão (o Telegram da Ester e da Liria).

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "./nucleo/db/cliente.ts";
import { contato, usuario } from "./nucleo/db/schema.ts";

export type Sessao = { id: string; login: string; nome: string };
export type Resposta = { ok: true; sessao: Sessao } | { ok: false; erro: string };

const LOGIN_VALIDO = /^[a-z0-9._-]{3,32}$/;
const SENHA_MINIMA = 4;

export function normalizarLogin(login: string): string {
  return login.trim().toLowerCase();
}

export function hashSenha(senha: string): string {
  const sal = randomBytes(16);
  return `${sal.toString("hex")}:${scryptSync(senha, sal, 32).toString("hex")}`;
}

export function conferirSenha(senha: string, guardado: string): boolean {
  const [sal, hash] = guardado.split(":");
  if (!sal || !hash) return false;
  const esperado = Buffer.from(hash, "hex");
  const calculado = scryptSync(senha, Buffer.from(sal, "hex"), esperado.length);
  return timingSafeEqual(esperado, calculado);
}

/** O chat web do usuário: um contato "web" com o id dele como endereço. Cria se faltar. */
export async function garantirContatoWeb(u: { id: string; nome: string }): Promise<void> {
  await db
    .insert(contato)
    .values({ canal: "web", endereco: u.id, papel: "comprador", nome: u.nome, usuarioId: u.id })
    .onConflictDoUpdate({ target: [contato.canal, contato.endereco], set: { usuarioId: u.id } });
}

const sessaoDe = (u: typeof usuario.$inferSelect): Sessao => ({ id: u.id, login: u.login, nome: u.nome });

export async function criarConta(dados: { login: string; nome: string; senha: string }): Promise<Resposta> {
  const login = normalizarLogin(dados.login);
  const nome = dados.nome.trim() || login;
  if (!LOGIN_VALIDO.test(login)) return { ok: false, erro: "Use de 3 a 32 letras minúsculas, números, ponto, hífen ou sublinhado." };
  if (dados.senha.length < SENHA_MINIMA) return { ok: false, erro: `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.` };
  const [novo] = await db
    .insert(usuario)
    .values({ login, nome, senhaHash: hashSenha(dados.senha) })
    .onConflictDoNothing({ target: usuario.login })
    .returning();
  if (!novo) return { ok: false, erro: "Esse usuário já existe. Use Entrar." };
  await garantirContatoWeb(novo);
  return { ok: true, sessao: sessaoDe(novo) };
}

/** Confere usuário e senha. Conta criada à mão, ainda sem senha, fica com a senha desta primeira entrada. */
export async function entrar(dados: { login: string; senha: string }): Promise<Resposta> {
  const login = normalizarLogin(dados.login);
  const [u] = await db.select().from(usuario).where(eq(usuario.login, login));
  if (!u) return { ok: false, erro: "Usuário não encontrado. Para começar, use Criar conta." };
  if (u.senhaHash === null) {
    if (dados.senha.length < SENHA_MINIMA) return { ok: false, erro: `Primeira entrada: escolha uma senha de pelo menos ${SENHA_MINIMA} caracteres.` };
    await db.update(usuario).set({ senhaHash: hashSenha(dados.senha) }).where(eq(usuario.id, u.id));
  } else if (!conferirSenha(dados.senha, u.senhaHash)) {
    return { ok: false, erro: "Senha errada." };
  }
  await garantirContatoWeb(u);
  return { ok: true, sessao: sessaoDe(u) };
}

/** A sessão guardada no navegador ainda vale? (o usuário pode ter sumido do banco). */
export async function conferirSessao(id: string): Promise<Sessao | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [u] = await db.select().from(usuario).where(eq(usuario.id, id));
  return u ? sessaoDe(u) : null;
}

/** Cria (se faltar) uma conta sem senha e liga a ela contatos que já existem. Usado à mão, por script. */
export async function ligarContatos(dados: { login: string; nome: string; contatoIds: string[] }): Promise<{ usuarioId: string; ligados: number }> {
  const login = normalizarLogin(dados.login);
  await db.insert(usuario).values({ login, nome: dados.nome }).onConflictDoNothing({ target: usuario.login });
  const [u] = await db.select().from(usuario).where(eq(usuario.login, login));
  if (!u) throw new Error(`usuário ${login} não ficou no banco`);
  const ligados = dados.contatoIds.length
    ? await db.update(contato).set({ usuarioId: u.id }).where(inArray(contato.id, dados.contatoIds)).returning({ id: contato.id })
    : [];
  await garantirContatoWeb(u);
  return { usuarioId: u.id, ligados: ligados.length };
}

/** Contatos ligados a um usuário, para a tela de perfil. */
export async function contatosDoUsuario(usuarioId: string) {
  return db
    .select({ canal: contato.canal, papel: contato.papel, nome: contato.nome, criadoEm: contato.criadoEm })
    .from(contato)
    .where(eq(contato.usuarioId, usuarioId));
}
