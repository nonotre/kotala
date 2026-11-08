// Frente 2: contas de quem entra nas telas. A senha vai com hash scrypt; a sessão é uma linha em
// `sessao`, cujo id vai num cookie httpOnly (web/lib/sessao-servidor.ts). O navegador guarda só um
// espelho do nome para a interface (web/components/conta/sessao.ts), sem autoridade nenhuma.
// Cada usuário tem um contato "web" (endereço = id do usuário), que é o chat dele no navegador,
// e pode ligar o Telegram pela tela (/vincular CODIGO) ou à mão (scripts/ligar-telegram.ts).
// Bloco 4: empresas e locais de entrega (E4 e E8) também moram aqui.

import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { and, asc, count, eq, gt, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { EMPRESA } from "./config.ts";
import { db } from "./nucleo/db/cliente.ts";
import { contato, empresa, localEntrega, sessao, usuario } from "./nucleo/db/schema.ts";

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

/** O usuário ainda existe? (pelo id do usuário; quem entrou de verdade sai de usuarioDaSessao). */
export async function conferirSessao(id: string): Promise<Sessao | null> {
  if (!UUID.test(id)) return null;
  const [u] = await db.select().from(usuario).where(eq(usuario.id, id));
  return u ? sessaoDe(u) : null;
}

// ---------- Sessão no servidor (cookie) ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: string) => UUID.test(v);

/** Quanto tempo a sessão vale depois de entrar. Sem renovação: depois disso, entra de novo. */
export const DURACAO_SESSAO_MS = 30 * 24 * 3600_000;

/** Cria a sessão de quem acabou de entrar. Aproveita para apagar as vencidas (de todo mundo). */
export async function criarSessao(usuarioId: string): Promise<{ id: string; expiraEm: Date }> {
  await db.delete(sessao).where(lt(sessao.expiraEm, new Date()));
  const [s] = await db
    .insert(sessao)
    .values({ usuarioId, expiraEm: new Date(Date.now() + DURACAO_SESSAO_MS) })
    .returning({ id: sessao.id, expiraEm: sessao.expiraEm });
  return s!;
}

/** Dono desta sessão, se ela existe e não venceu. É a única fonte de "quem entrou" no servidor. */
export async function usuarioDaSessao(sessaoId: string | null | undefined): Promise<Sessao | null> {
  if (!sessaoId || !UUID.test(sessaoId)) return null;
  const [u] = await db
    .select({ id: usuario.id, login: usuario.login, nome: usuario.nome })
    .from(sessao)
    .innerJoin(usuario, eq(usuario.id, sessao.usuarioId))
    .where(and(eq(sessao.id, sessaoId), gt(sessao.expiraEm, new Date())));
  return u ?? null;
}

/** Sair: a sessão deixa de valer em qualquer aba ou aparelho que tenha o mesmo cookie. */
export async function apagarSessao(sessaoId: string | null | undefined): Promise<void> {
  if (!sessaoId || !UUID.test(sessaoId)) return;
  await db.delete(sessao).where(eq(sessao.id, sessaoId));
}

/** O contato web (endereço do chat) é deste usuário? Só assim a tela lê ou escreve na conversa. */
export async function enderecoWebDoUsuario(endereco: string, usuarioId: string): Promise<boolean> {
  if (!/^[a-z0-9-]{8,64}$/i.test(endereco) || !UUID.test(usuarioId)) return false;
  const [c] = await db
    .select({ id: contato.id })
    .from(contato)
    .where(and(eq(contato.canal, "web"), eq(contato.endereco, endereco), eq(contato.usuarioId, usuarioId)));
  return Boolean(c);
}

/** O contato (qualquer canal) é deste usuário? Para abrir uma conversa pelo id do contato. */
export async function contatoDoUsuario(contatoId: string, usuarioId: string): Promise<boolean> {
  if (!UUID.test(contatoId) || !UUID.test(usuarioId)) return false;
  const [c] = await db.select({ id: contato.id }).from(contato).where(and(eq(contato.id, contatoId), eq(contato.usuarioId, usuarioId)));
  return Boolean(c);
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

/** "Nova conversa" no site: um contato web novo da pessoa, com endereço próprio. Devolve o id do contato. */
export async function novaConversaWeb(u: { id: string; nome: string }): Promise<string> {
  // O aviso de privacidade é por pessoa: quem já o viu em outra conversa não o recebe de novo.
  const [viu] = await db.select({ id: contato.id }).from(contato).where(and(eq(contato.usuarioId, u.id), isNotNull(contato.avisoPrivacidadeEm))).limit(1);
  const [c] = await db
    .insert(contato)
    .values({ canal: "web", endereco: crypto.randomUUID(), papel: "comprador", nome: u.nome, usuarioId: u.id, avisoPrivacidadeEm: viu ? new Date() : null })
    .returning({ id: contato.id });
  return c!.id;
}

/** Contatos ligados a um usuário, para a tela de perfil. */
export async function contatosDoUsuario(usuarioId: string) {
  return db
    .select({ canal: contato.canal, papel: contato.papel, nome: contato.nome, criadoEm: contato.criadoEm })
    .from(contato)
    .where(eq(contato.usuarioId, usuarioId));
}

// ---------- Ligar o Telegram pela tela (/vincular CODIGO) ----------

/** Sem 0/O e 1/I, que se confundem ao digitar. 32 símbolos em 8 posições: 2^40 combinações. */
const ALFABETO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TAMANHO_CODIGO = 8;
/** O código vale pouco tempo e uma vez só: adivinhar entre 2^40 nesse tempo, pelo Telegram, não é viável. */
export const VALIDADE_CODIGO_MS = 15 * 60_000;

/** Linha que o contato novo de Telegram, sem conta, recebe no primeiro contato. */
export const TEXTO_OFERTA_VINCULAR =
  "Já tem conta nas telas do Kotala? Em Configurações, pegue o seu código e mande aqui /vincular CODIGO: os pedidos deste chat passam a aparecer com o seu nome.";

/** Gera (ou troca) o código da pessoa. O anterior deixa de valer. */
export async function gerarCodigoVinculo(usuarioId: string): Promise<{ codigo: string; expiraEm: Date }> {
  if (!UUID.test(usuarioId)) throw new Error("usuário inválido");
  for (let tentativa = 0; ; tentativa++) {
    const codigo = Array.from({ length: TAMANHO_CODIGO }, () => ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)]).join("");
    const expiraEm = new Date(Date.now() + VALIDADE_CODIGO_MS);
    try {
      const feito = await db.update(usuario).set({ codigoVinculo: codigo, codigoVinculoExpiraEm: expiraEm }).where(eq(usuario.id, usuarioId)).returning({ id: usuario.id });
      if (!feito.length) throw new Error("usuário não encontrado");
      return { codigo, expiraEm };
    } catch (erro) {
      // O mesmo código já é de outra pessoa (é único no banco): sorteia de novo. Na prática, nunca.
      if (tentativa < 3 && /usuario_codigo_vinculo_unique/.test(String((erro as { cause?: unknown }).cause ?? erro))) continue;
      throw erro;
    }
  }
}

/** Maiúsculo, sem espaço nem hífen: "abcd-efgh" vale como "ABCDEFGH". */
export function normalizarCodigo(codigo: string): string {
  return codigo.replace(/[\s-]/g, "").toUpperCase();
}

/** "/vincular CODIGO" (também "/vincular@bot CODIGO"). null: não é o comando; "": o comando sem código. */
export function lerComandoVincular(texto: string): string | null {
  const m = /^\/vincular(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(texto.trim());
  if (!m) return null;
  return normalizarCodigo(m[1] ?? "");
}

export type RespostaVinculo = { ok: true; nome: string } | { ok: false };

/**
 * Liga o contato do Telegram (bot do comprador) à conta dona do código, criando o contato se esta
 * for a primeira mensagem dele. O código é gasto na hora. Se o chat já era de outra conta, passa
 * para esta: quem tem o código está entrado nela.
 */
export async function vincularTelegram(dados: { endereco: string; nome?: string; codigo: string }): Promise<RespostaVinculo> {
  const codigo = normalizarCodigo(dados.codigo);
  if (codigo.length !== TAMANHO_CODIGO) return { ok: false };
  return db.transaction(async (tx) => {
    // Confere e gasta no mesmo comando: duas mensagens com o mesmo código não ligam duas vezes.
    const [u] = await tx
      .update(usuario)
      .set({ codigoVinculo: null, codigoVinculoExpiraEm: null })
      .where(and(eq(usuario.codigoVinculo, codigo), gt(usuario.codigoVinculoExpiraEm, new Date())))
      .returning({ id: usuario.id, nome: usuario.nome });
    if (!u) return { ok: false } as const;
    await tx
      .insert(contato)
      .values({ canal: "telegram", endereco: dados.endereco, papel: "comprador", nome: dados.nome, usuarioId: u.id })
      .onConflictDoUpdate({ target: [contato.canal, contato.endereco], set: { usuarioId: u.id } });
    return { ok: true, nome: u.nome } as const;
  });
}

// ---------- Empresas e locais de entrega (E4 e E8) ----------

export type DadosEmpresa = {
  nome: string;
  cnpj: string | null;
  razaoSocial: string | null;
  enderecoFaturamento: string | null;
  cepFaturamento: string | null;
};
export type Empresa = DadosEmpresa & { id: string };

export type DadosLocal = {
  apelido: string;
  endereco: string;
  cep: string | null;
  janelaRecebimento: string | null;
  restricao: string | null;
};
export type Local = DadosLocal & { id: string; empresaId: string; padrao: boolean };

export type Falha = { ok: false; erro: string };
type Bruto<T> = Partial<Record<keyof T, unknown>>;

const CEP_VALIDO = /^\d{5}-\d{3}$/;
const limpo = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max) || null;

/**
 * A primeira empresa do banco; num banco sem nenhuma, cria a de EMPRESA (src/config.ts), com o
 * endereço de entrega de antes como local padrão. A trava evita duas empresas padrão numa corrida.
 */
export async function garantirEmpresaPadrao(): Promise<string> {
  const [ja] = await db.select({ id: empresa.id }).from(empresa).orderBy(asc(empresa.criadoEm)).limit(1);
  if (ja) return ja.id;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kotala-empresa-padrao'))`);
    const [outra] = await tx.select({ id: empresa.id }).from(empresa).orderBy(asc(empresa.criadoEm)).limit(1);
    if (outra) return outra.id;
    const [nova] = await tx
      .insert(empresa)
      .values({ nome: EMPRESA.nome, cnpj: EMPRESA.cnpj, razaoSocial: EMPRESA.nome, enderecoFaturamento: EMPRESA.enderecoEntrega, cepFaturamento: EMPRESA.cep })
      .returning({ id: empresa.id });
    await tx.insert(localEntrega).values({
      empresaId: nova!.id,
      apelido: "Sede",
      endereco: EMPRESA.enderecoEntrega,
      cep: EMPRESA.cep,
      janelaRecebimento: EMPRESA.janelaRecebimento,
      padrao: true,
    });
    return nova!.id;
  });
}

/** A empresa em que a pessoa compra agora. Sem nenhuma escolhida (ou se ela sumiu), fica a padrão, e é gravada. */
export async function empresaAtivaDe(usuarioId: string): Promise<string> {
  const [u] = await db.select({ empresaId: usuario.empresaId }).from(usuario).where(eq(usuario.id, usuarioId));
  if (!u) throw new Error("usuário não encontrado");
  if (u.empresaId) {
    const [e] = await db.select({ id: empresa.id }).from(empresa).where(eq(empresa.id, u.empresaId));
    if (e) return e.id;
  }
  const id = await garantirEmpresaPadrao();
  await db.update(usuario).set({ empresaId: id }).where(eq(usuario.id, usuarioId));
  return id;
}

export async function trocarEmpresaAtiva(usuarioId: string, empresaId: string): Promise<{ ok: true } | Falha> {
  if (!UUID.test(empresaId)) return { ok: false, erro: "Empresa inválida." };
  const [e] = await db.select({ id: empresa.id }).from(empresa).where(eq(empresa.id, empresaId));
  if (!e) return { ok: false, erro: "Empresa não encontrada." };
  await db.update(usuario).set({ empresaId }).where(eq(usuario.id, usuarioId));
  return { ok: true };
}

const colunasEmpresa = {
  id: empresa.id,
  nome: empresa.nome,
  cnpj: empresa.cnpj,
  razaoSocial: empresa.razaoSocial,
  enderecoFaturamento: empresa.enderecoFaturamento,
  cepFaturamento: empresa.cepFaturamento,
};

/** Todas as empresas, da mais antiga para a mais nova (a padrão primeiro). */
export async function listarEmpresas(): Promise<Empresa[]> {
  await garantirEmpresaPadrao();
  return db.select(colunasEmpresa).from(empresa).orderBy(asc(empresa.criadoEm));
}

export function validarEmpresa(bruto: Bruto<DadosEmpresa>): { ok: true; dados: DadosEmpresa } | Falha {
  const dados: DadosEmpresa = {
    nome: limpo(bruto.nome, 120) ?? "",
    cnpj: limpo(bruto.cnpj, 30),
    razaoSocial: limpo(bruto.razaoSocial, 200),
    enderecoFaturamento: limpo(bruto.enderecoFaturamento),
    cepFaturamento: limpo(bruto.cepFaturamento, 9),
  };
  if (!dados.nome) return { ok: false, erro: "Diga o nome da empresa." };
  if (dados.cepFaturamento && !CEP_VALIDO.test(dados.cepFaturamento)) return { ok: false, erro: "Digite os 8 números do CEP, como 00000-000." };
  return { ok: true, dados };
}

/** Nova empresa (sem id) ou correção dos dados de faturamento. */
export async function salvarEmpresa(bruto: Bruto<DadosEmpresa>, id?: string): Promise<{ ok: true; empresa: Empresa } | Falha> {
  const v = validarEmpresa(bruto);
  if (!v.ok) return v;
  if (id !== undefined) {
    if (!UUID.test(id)) return { ok: false, erro: "Empresa inválida." };
    const [e] = await db.update(empresa).set(v.dados).where(eq(empresa.id, id)).returning(colunasEmpresa);
    return e ? { ok: true, empresa: e } : { ok: false, erro: "Empresa não encontrada." };
  }
  const [e] = await db.insert(empresa).values(v.dados).returning(colunasEmpresa);
  return { ok: true, empresa: e! };
}

/** Todos os usuários com a empresa em que estão agora (usuario.empresa_id). */
export async function pessoasComEmpresa() {
  return db.select({ id: usuario.id, nome: usuario.nome, login: usuario.login, papel: usuario.papel, empresaId: usuario.empresaId }).from(usuario).orderBy(asc(usuario.nome));
}

const colunasLocal = {
  id: localEntrega.id,
  empresaId: localEntrega.empresaId,
  apelido: localEntrega.apelido,
  endereco: localEntrega.endereco,
  cep: localEntrega.cep,
  janelaRecebimento: localEntrega.janelaRecebimento,
  restricao: localEntrega.restricao,
  padrao: localEntrega.padrao,
};

/** Locais de uma empresa, ou de todas (sem id), na ordem em que foram cadastrados. */
export async function listarLocais(empresaId?: string): Promise<Local[]> {
  if (empresaId !== undefined && !UUID.test(empresaId)) return [];
  const q = db.select(colunasLocal).from(localEntrega);
  return (empresaId ? q.where(eq(localEntrega.empresaId, empresaId)) : q).orderBy(asc(localEntrega.criadoEm));
}

export function validarLocal(bruto: Bruto<DadosLocal>): { ok: true; dados: DadosLocal } | Falha {
  const dados: DadosLocal = {
    apelido: limpo(bruto.apelido, 80) ?? "",
    endereco: limpo(bruto.endereco) ?? "",
    cep: limpo(bruto.cep, 9),
    janelaRecebimento: limpo(bruto.janelaRecebimento, 200),
    restricao: limpo(bruto.restricao, 200),
  };
  if (!dados.apelido) return { ok: false, erro: "Diga como o local é chamado." };
  if (!dados.endereco) return { ok: false, erro: "Falta o endereço, com número e cidade." };
  // O frete é calculado até o CEP: local sem CEP válido não serve de destino.
  if (!dados.cep || !CEP_VALIDO.test(dados.cep)) return { ok: false, erro: "Digite os 8 números do CEP, como 00000-000." };
  return { ok: true, dados };
}

/** Novo local (o primeiro da empresa já nasce padrão) ou correção de um que existe. */
export async function salvarLocal(empresaId: string, bruto: Bruto<DadosLocal>, id?: string): Promise<{ ok: true; local: Local } | Falha> {
  if (!UUID.test(empresaId)) return { ok: false, erro: "Empresa inválida." };
  const v = validarLocal(bruto);
  if (!v.ok) return v;
  if (id !== undefined) {
    if (!UUID.test(id)) return { ok: false, erro: "Local inválido." };
    const [l] = await db
      .update(localEntrega)
      .set(v.dados)
      .where(and(eq(localEntrega.id, id), eq(localEntrega.empresaId, empresaId)))
      .returning(colunasLocal);
    return l ? { ok: true, local: l } : { ok: false, erro: "Local não encontrado." };
  }
  const [e] = await db.select({ id: empresa.id }).from(empresa).where(eq(empresa.id, empresaId));
  if (!e) return { ok: false, erro: "Empresa não encontrada." };
  const [c] = await db.select({ n: count() }).from(localEntrega).where(and(eq(localEntrega.empresaId, empresaId), eq(localEntrega.padrao, true)));
  const [l] = await db
    .insert(localEntrega)
    .values({ ...v.dados, empresaId, padrao: (c?.n ?? 0) === 0 })
    .returning(colunasLocal);
  return { ok: true, local: l! };
}

/** Um local padrão por empresa: marca este e desmarca os outros, juntos. */
export async function tornarLocalPadrao(empresaId: string, id: string): Promise<{ ok: true } | Falha> {
  if (!UUID.test(empresaId) || !UUID.test(id)) return { ok: false, erro: "Local inválido." };
  return db.transaction(async (tx) => {
    const [l] = await tx.select({ id: localEntrega.id }).from(localEntrega).where(and(eq(localEntrega.id, id), eq(localEntrega.empresaId, empresaId)));
    if (!l) return { ok: false, erro: "Local não encontrado." } as const;
    await tx.update(localEntrega).set({ padrao: false }).where(and(eq(localEntrega.empresaId, empresaId), ne(localEntrega.id, id)));
    await tx.update(localEntrega).set({ padrao: true }).where(eq(localEntrega.id, id));
    return { ok: true } as const;
  });
}

/** Remove o local. Se era o padrão, o mais antigo que sobrar passa a ser; devolve quem herdou. */
export async function removerLocal(empresaId: string, id: string): Promise<{ ok: true; herdeiro: Local | null } | Falha> {
  if (!UUID.test(empresaId) || !UUID.test(id)) return { ok: false, erro: "Local inválido." };
  return db.transaction(async (tx) => {
    const [l] = await tx
      .delete(localEntrega)
      .where(and(eq(localEntrega.id, id), eq(localEntrega.empresaId, empresaId)))
      .returning({ padrao: localEntrega.padrao });
    if (!l) return { ok: false, erro: "Local não encontrado." } as const;
    if (!l.padrao) return { ok: true, herdeiro: null } as const;
    const [prox] = await tx.select(colunasLocal).from(localEntrega).where(eq(localEntrega.empresaId, empresaId)).orderBy(asc(localEntrega.criadoEm)).limit(1);
    if (!prox) return { ok: true, herdeiro: null } as const;
    await tx.update(localEntrega).set({ padrao: true }).where(eq(localEntrega.id, prox.id));
    return { ok: true, herdeiro: { ...prox, padrao: true } } as const;
  });
}

/**
 * Para onde vai a compra quando o pedido não diz o destino: o local padrão da empresa de quem
 * pediu (contato → usuário → empresa → local padrão). Null sem usuário, sem empresa ou sem local:
 * aí vale o endereço de EMPRESA, como antes.
 */
export async function localPadraoDoContato(contatoId: string): Promise<{ apelido: string; endereco: string; cep: string | null; janelaRecebimento: string | null } | null> {
  if (!UUID.test(contatoId)) return null;
  const [l] = await db
    .select({ apelido: localEntrega.apelido, endereco: localEntrega.endereco, cep: localEntrega.cep, janelaRecebimento: localEntrega.janelaRecebimento })
    .from(contato)
    .innerJoin(usuario, eq(usuario.id, contato.usuarioId))
    .innerJoin(localEntrega, and(eq(localEntrega.empresaId, usuario.empresaId), eq(localEntrega.padrao, true)))
    .where(eq(contato.id, contatoId))
    .orderBy(asc(localEntrega.criadoEm))
    .limit(1);
  return l ?? null;
}
