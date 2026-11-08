// S: guardrails do comprador. Funções puras, testáveis sem banco e sem IA.
// Três barreiras com as mesmas listas: triagem (antes da IA), posRegras (depois
// da IA) e conferirItem/conferirSaida (antes da busca e de tudo que vai ao
// fornecedor). Só a lista dura bloqueia sem a IA; palavra sensível só marca.
// Desenho em docs/plano-ia/guardrails.md. O que mexe no banco fica em rastro.ts.

import type { Interpretacao } from "../interpretador/index.ts";
import {
  CARA_DE_CODIGO,
  CONDICAO_IRREGULAR,
  CONTROLADOS,
  EXCECOES,
  LINK_SUSPEITO,
  LISTA_DURA,
  SINAIS,
  SINAL_INJECAO,
  TEXTO_LONGO,
  type Controlado,
  type TermoDuro,
} from "./listas.ts";

export const CLASSES = ["pedido", "ambiguo", "controlado", "proibido", "fora_do_escopo", "consulta", "injecao", "ofensa"] as const;
export type Classe = (typeof CLASSES)[number];
export const RISCOS = ["nenhum", "regulado", "controlado", "proibido"] as const;
export type Risco = (typeof RISCOS)[number];

/** Subtipos que avisam o gestor já na 1ª tentativa. */
const AVISAR_JA = new Set(LISTA_DURA.filter((t) => t.avisarJa).map((t) => t.subtipo).concat(["fraude", "licitacao", "nota_fria", "sexual_menor"]));

// ---------- Normalização ----------

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** Sem acento e minúsculo. */
export const semAcento = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Formas do texto que as listas testam: a simples, com o leetspeak desfeito
 * ("c0ca1na" → "cocaina", só em palavra que mistura letra e número, para "40 sacos"
 * não mudar) e com letras soltas juntadas ("c o c a i n a").
 */
export function formas(texto: string): string[] {
  const simples = semAcento(texto).replace(/\s+/g, " ").trim();
  const leet = simples.replace(/[a-z0-9@$]+/g, (w) => (/[a-z]/.test(w) && /[0-9@$]/.test(w) ? w.replace(/[013457@$]/g, (c) => LEET[c] ?? c) : w));
  const juntas = leet.replace(/\b(?:[a-z][ .\-_*]){2,}[a-z]\b/g, (m) => m.replace(/[ .\-_*]/g, ""));
  return [...new Set([simples, leet, juntas])];
}

/** A forma principal, para o rastro e para os testes. */
export const normalizar = (texto: string) => formas(texto).at(-1)!;

const casa = (fs: string[], padrao: RegExp) => fs.some((f) => padrao.test(f));

export function listaDura(texto: string): TermoDuro | null {
  const fs = formas(texto);
  return LISTA_DURA.find((t) => casa(fs, t.padrao)) ?? null;
}

export function controlado(texto: string): Controlado | null {
  const fs = formas(texto);
  return CONTROLADOS.find((c) => casa(fs, c.padrao)) ?? null;
}

export const temExcecao = (texto: string) => casa(formas(texto), EXCECOES);

// ---------- Dado pessoal ----------

const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|(?<=\bcpf\b\D{0,15})\b\d{11}\b/gi;
const CARTAO = /\b\d{4}([ -])\d{4}\1\d{4}\1\d{1,7}\b|(?<=\bcart[aã]o\b\D{0,20})\b\d{13,19}\b/gi;
const SENHA = /(\b(?:senha|password|cvv|c[oó]digo de (?:seguran[cç]a|verifica[cç][aã]o|acesso))\b\s*(?:[:=\-]|[eé](?=\s))?\s*)((?=\S{4,})\S*\d\S*)/gi;

/** Algoritmo de Luhn: separa número de cartão de outros números longos. */
function luhn(digitos: string): boolean {
  let soma = 0;
  for (let i = 0; i < digitos.length; i++) {
    let d = Number(digitos[digitos.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    soma += d;
  }
  return soma % 10 === 0;
}

/** Mascara CPF, cartão e senha. O texto mascarado é o que segue (IA, banco do pedido, fornecedor). */
export function mascararDadosPessoais(texto: string): { texto: string; achados: string[] } {
  const achados = new Set<string>();
  let t = texto.replace(CPF, () => (achados.add("CPF"), "[CPF omitido]"));
  t = t.replace(CARTAO, (m) => {
    const d = m.replace(/\D/g, "");
    if (d.length < 13 || d.length > 19 || !luhn(d)) return m;
    achados.add("cartão");
    return "[cartão omitido]";
  });
  t = t.replace(SENHA, (_m, antes: string) => (achados.add("senha"), `${antes}[omitida]`));
  return { texto: t, achados: [...achados] };
}

/** Só detecta (sem mascarar): para conferir o que vai ao fornecedor. */
export const temDadoPessoal = (texto: string) => mascararDadosPessoais(texto).achados;

// ---------- 1 · Triagem, antes da IA ----------

export type Triagem = {
  /** Texto com dado pessoal mascarado: é este que segue. */
  texto: string;
  /** Lista dura casou: bloqueia sem a IA. */
  bloqueio: { subtipo: string; avisarJa: boolean } | null;
  /** Nomes dos sinais sensíveis (só marcam). */
  sinais: string[];
  dadoPessoal: string[];
  condicaoIrregular: string | null;
  /** "codigo" ou "longo": sinal de fora do escopo. */
  foraDoEscopo: "codigo" | "longo" | null;
  injecao: boolean;
};

export function triagem(texto: string): Triagem {
  const { texto: seguro, achados } = mascararDadosPessoais(texto);
  const fs = formas(seguro);
  const duro = LISTA_DURA.find((t) => casa(fs, t.padrao));
  const condicao = fs.map((f) => CONDICAO_IRREGULAR.exec(f)?.[0]).find(Boolean) ?? null;
  return {
    texto: seguro,
    bloqueio: duro ? { subtipo: duro.subtipo, avisarJa: AVISAR_JA.has(duro.subtipo) } : null,
    sinais: SINAIS.filter((s) => casa(fs, s.padrao)).map((s) => s.nome),
    dadoPessoal: achados,
    condicaoIrregular: condicao,
    foraDoEscopo: texto.length > TEXTO_LONGO ? "longo" : CARA_DE_CODIGO.test(texto) ? "codigo" : null,
    injecao: casa(fs, SINAL_INJECAO),
  };
}

/** Triagem vazia, para quem não tem texto do comprador (botão, reprocessamento). */
export const TRIAGEM_NEUTRA: Triagem = { texto: "", bloqueio: null, sinais: [], dadoPessoal: [], condicaoIrregular: null, foraDoEscopo: null, injecao: false };

/** I4: refaz a leitura com o modelo forte quando há sinal sensível ou a IA viu risco que a lista não confirma. */
export function precisaModeloForte(t: Triagem, i: Pick<Interpretacao, "classe" | "itens">): boolean {
  if (t.sinais.length || t.foraDoEscopo || t.injecao) return true;
  if (i.classe === "proibido" || i.classe === "controlado") return true;
  return i.itens.some((it) => it.risco === "proibido" || it.risco === "controlado");
}

// ---------- 3 · Pós-regras, depois da IA ----------

export type ItemControlado = { descricao: string; grupo: string; orgao: string | null };

export type Decisao = {
  /** A interpretação com a classe final, sem os itens controlados, e ehPedido derivado. */
  interpretacao: Interpretacao;
  controlados: ItemControlado[];
  /** A classe veio da lista dura (código), não só da IA. */
  porLista: boolean;
  /** Mensagem proibida com outros itens válidos: o comprador manda esses à parte. */
  outrosItens: number;
};

const textoDoItem = (it: { descricao: string; especificacao?: { nome: string; valor: string }[] | Record<string, string> }) => {
  const e = it.especificacao;
  const valores = !e ? [] : Array.isArray(e) ? e.map((x) => `${x.nome} ${x.valor}`) : Object.entries(e).map(([k, v]) => `${k} ${v}`);
  return [it.descricao, ...valores].join(" ");
};

/**
 * Aplica as listas sobre o que a IA leu. A lista dura vale mesmo que a IA diga
 * "pedido". Controlado sai do pedido. "proibido" da IA sem lista dura e com
 * exceção casada vira pergunta. Deriva ehPedido para o fluxo de hoje não mudar.
 */
export function posRegras(i: Interpretacao, t: Triagem = TRIAGEM_NEUTRA): Decisao {
  let classe: Classe = i.classe;
  let subtipo = i.subtipo;
  let motivo = i.motivo;
  let porLista = false;
  let opcoes = i.opcoes;
  let faltando = i.faltando;
  const controlados: ItemControlado[] = [];
  const itens: Interpretacao["itens"] = [];

  if (t.bloqueio) {
    classe = "proibido";
    subtipo = t.bloqueio.subtipo;
    motivo = `Lista dura: ${t.bloqueio.subtipo}.`;
    porLista = true;
  }
  for (const it of i.itens) {
    const txt = textoDoItem(it);
    const duro = listaDura(txt);
    if (duro) {
      classe = "proibido";
      subtipo = duro.subtipo;
      motivo = `Item na lista dura (${duro.subtipo}): ${it.descricao}.`;
      porLista = true;
      continue;
    }
    const c = controlado(txt);
    if (c || it.risco === "controlado") {
      controlados.push({ descricao: it.descricao, grupo: c?.grupo ?? it.motivoRisco ?? "produto controlado", orgao: c?.orgao ?? null });
      continue;
    }
    if (it.risco === "proibido" && !porLista) {
      // Na dúvida, pergunta: palavra com uso comum ("pistola de cola") não vira recusa.
      if (temExcecao(txt)) {
        itens.push({ ...it, risco: "nenhum" });
        if (classe === "pedido" || classe === "proibido") {
          classe = "ambiguo";
          subtipo = "confirmar_item";
          opcoes = [];
          faltando = [`É "${it.descricao}" para uso da empresa?`];
        }
        continue;
      }
      classe = "proibido";
      subtipo ??= "item_proibido";
      motivo = `A leitura marcou o item como proibido: ${it.descricao}.`;
      continue;
    }
    itens.push(semCondicao(it));
  }

  // A IA recusou a mensagem, mas nenhum item recusado fica sem uso comum e o texto casa
  // uma exceção ("pistola de cola quente"): pergunta em vez de recusar.
  const recusaSoDaIa = classe === "proibido" && !porLista && !i.itens.some((it) => it.risco === "proibido" && !temExcecao(textoDoItem(it)));
  if (recusaSoDaIa && temExcecao(t.texto || i.itens.map(textoDoItem).join(" "))) {
    classe = "ambiguo";
    subtipo = "confirmar_item";
    opcoes = [];
    faltando = [itens[0] ? `É "${itens[0].descricao}" para uso da empresa?` : "Pode dizer o item e para que a empresa vai usar?"];
  }

  if (classe !== "proibido") {
    if (controlados.length && !itens.length && (classe === "pedido" || classe === "controlado" || classe === "ambiguo")) classe = "controlado";
    else if (classe === "controlado" && itens.length) classe = "pedido";
    // Pedido junto com tentativa ou ofensa: cota só o pedido, sem comentar.
    if ((classe === "injecao" || classe === "ofensa") && itens.length) classe = "pedido";
  }

  // O sinal de injeção da triagem só escala o modelo; quem marca a tentativa é a leitura.
  const tentouMudarRegras = i.tentouMudarRegras || i.classe === "injecao";
  const hostil = i.hostil || i.classe === "ofensa";
  const condicaoIrregular = i.condicaoIrregular ?? t.condicaoIrregular;
  // A condição irregular nunca vai ao fornecedor: some dos campos livres.
  const limpo = (v: string | null) => (v && casa(formas(v), CONDICAO_IRREGULAR) ? null : v);
  const final: Interpretacao = {
    ...i,
    destino: limpo(i.destino),
    janelaRecebimento: limpo(i.janelaRecebimento),
    prazoTexto: limpo(i.prazoTexto),
    entregas: limpo(i.entregas),
    classe,
    subtipo,
    motivo,
    opcoes: classe === "ambiguo" ? opcoes.slice(0, 4) : [],
    faltando,
    tentouMudarRegras,
    hostil,
    condicaoIrregular,
    itens: classe === "proibido" ? [] : itens,
    ehPedido: classe === "pedido" && itens.length > 0,
  };
  return { interpretacao: final, controlados, porLista, outrosItens: classe === "proibido" ? itens.length : 0 };
}

/** Tira da especificação do item o que for condição irregular ("sem nota"). */
function semCondicao<T extends { especificacao: { nome: string; valor: string }[] }>(it: T): T {
  const especificacao = it.especificacao.filter((e) => !casa(formas(`${e.nome} ${e.valor}`), CONDICAO_IRREGULAR));
  return especificacao.length === it.especificacao.length ? it : { ...it, especificacao };
}

// ---------- 4 · Item antes da busca ----------

export type Conferencia = { ok: true } | { ok: false; risco: "proibido" | "controlado"; motivo: string };

/** Nada proibido ou controlado vai ao Serper, às lojas ou a fornecedor. Rede de segurança para correção e tela. */
export function conferirItem(item: { descricao: string; especificacao?: Record<string, string> | null }): Conferencia {
  const txt = textoDoItem({ descricao: item.descricao, especificacao: item.especificacao ?? {} });
  const duro = listaDura(txt);
  if (duro) return { ok: false, risco: "proibido", motivo: `Item proibido (${duro.subtipo}).` };
  const c = controlado(txt);
  if (c) return { ok: false, risco: "controlado", motivo: `Produto controlado (${c.grupo}; ${c.orgao}): exige autorização e um responsável.` };
  return { ok: true };
}

// ---------- 5 · Texto antes de ir ao fornecedor ----------

export type ConferenciaSaida = { ok: boolean; motivos: string[]; avisarGestor: boolean };

/**
 * Confere todo texto que vai ao fornecedor: lista dura, dado pessoal, condição
 * irregular ("sem nota", "por fora") e link suspeito. Se falhar, não envia.
 */
export function conferirSaida(texto: string): ConferenciaSaida {
  const motivos: string[] = [];
  const fs = formas(texto);
  const duro = LISTA_DURA.find((t) => casa(fs, t.padrao));
  if (duro) motivos.push(`conteúdo proibido (${duro.subtipo})`);
  const dados = temDadoPessoal(texto);
  if (dados.length) motivos.push(`dado pessoal (${dados.join(", ")})`);
  const condicao = fs.map((f) => CONDICAO_IRREGULAR.exec(f)?.[0]).find(Boolean);
  if (condicao) motivos.push(`condição irregular ("${condicao}")`);
  if (LINK_SUSPEITO.test(texto)) motivos.push("link suspeito");
  return { ok: motivos.length === 0, motivos, avisarGestor: Boolean(duro || condicao) };
}

// ---------- Insistência ----------

export type EventoGuardrail = { classe: string; criadoEm: Date };

const DIA_MS = 24 * 3600_000;
const HORA_MS = 3600_000;

/**
 * Contagem por contato em 24 h (sem migração: vem dos eventos do Guardrail).
 * fora_do_escopo conta só as seguidas: zera no último pedido aberto.
 * Na 3ª tentativa proibida ou de injeção, as respostas ficam fixas por 1 h.
 */
export function contarInsistencia(eventos: readonly EventoGuardrail[], agora: Date, ultimoPedidoEm: Date | null = null) {
  const recentes = eventos.filter((e) => agora.getTime() - e.criadoEm.getTime() <= DIA_MS);
  const de = (c: string) => recentes.filter((e) => e.classe === c);
  const proibido = de("proibido").length;
  const injecao = de("injecao").length;
  const foraSeguidas = de("fora_do_escopo").filter((e) => !ultimoPedidoEm || e.criadoEm > ultimoPedidoEm).length;
  const graves = [...de("proibido"), ...de("injecao")].sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
  const respostaFixa = (proibido >= 3 || injecao >= 3) && graves.length > 0 && agora.getTime() - graves[0]!.criadoEm.getTime() <= HORA_MS;
  return { proibido, injecao, ofensa: de("ofensa").length, condicao: de("condicao_irregular").length, foraSeguidas, respostaFixa };
}
export type Insistencia = ReturnType<typeof contarInsistencia>;

/** Avisa o gestor? (o modo demo e a falta de contato são vistos em rastro.ts) */
export function deveAvisarGestor(classe: Classe | "condicao_irregular", subtipo: string | null, vez: number): boolean {
  if (classe === "proibido") return vez >= 3 || (subtipo !== null && AVISAR_JA.has(subtipo));
  if (classe === "injecao") return vez >= 3;
  if (classe === "controlado") return true;
  if (classe === "condicao_irregular") return vez >= 2;
  return false;
}

// ---------- Respostas ao comprador ----------

export const TEXTO_DADO_PESSOAL = "Não preciso de CPF, cartão nem senha para cotar; não vou usar esse dado.";
export const TEXTO_SO_COM_NOTA = "Só cotamos com nota fiscal. Vou cotar com nota.";
/** Pedido de serviço sem dizer qual: cotamos serviços, mas o fornecedor precisa do escopo, do local e do prazo. */
export const TEXTO_SERVICO =
  'Também cotamos serviços. Me diga o que precisa ser feito, onde e para quando, por exemplo: "instalação de 2 aparelhos de ar-condicionado no escritório até sexta".';
export const TEXTO_RESPOSTA_FIXA = "Não posso ajudar com isso. Esta conversa fica registrada e o gestor de compras foi avisado. Para uma compra da empresa, tente de novo mais tarde.";
export const ROTULO_CONTESTAR = "Era uma compra da empresa";

/** Resposta curta por classe. Nunca ecoa o conteúdo pedido nem comenta a tentativa. */
export function respostaDaClasse(p: { classe: Classe; subtipo: string | null; vez?: number; empresa?: string; comOutrosItens?: boolean }): string {
  const vez = p.vez ?? 1;
  const registrada = vez >= 2 ? " Esta conversa fica registrada." : "";
  switch (p.classe) {
    case "proibido": {
      let t = "Não posso ajudar com esse pedido. Aqui eu só faço cotações de compras da empresa, dentro da lei.";
      if (p.subtipo === "licitacao" || p.subtipo === "fraude") t = "Não monto orçamento combinado, de fachada nem com valor alterado. Posso fazer uma cotação real com fornecedores diferentes.";
      else if (p.subtipo === "sexual" || p.subtipo === "sexual_menor") t = "Não trato desse assunto. Se precisar comprar algo para a empresa, mande o item e a quantidade.";
      if (p.comOutrosItens) t += " Se precisar dos outros itens, mande-os numa mensagem separada.";
      return t + registrada;
    }
    case "fora_do_escopo":
      if (p.subtipo === "calculo") return "Não faço cálculo de quantidade. Se me disser o que comprar e quanto, eu coto.";
      return `Isso eu não faço: sou o assistente de cotações${p.empresa ? ` da ${p.empresa}` : ""}. Me diga o que precisa comprar e a quantidade, que eu coto.`;
    case "consulta":
      return "Ainda não consigo responder isso por aqui. Os detalhes dos pedidos ficam na tela de pedidos.";
    case "injecao":
      return `Não mudo minhas regras por mensagem. Se precisa comprar algo, mande o item e a quantidade.${registrada}`;
    case "ofensa":
      return "Vou seguir só com as compras. Se tiver um pedido, é só mandar.";
    case "ambiguo":
      return p.subtipo === "servico" ? TEXTO_SERVICO : "Não entendi bem o que precisa comprar. Mande o item e a quantidade.";
    case "controlado":
    case "pedido":
      return "";
  }
}

/** Aviso do item controlado: não cota e encaminha a uma pessoa. */
export function respostaControlados(itens: readonly ItemControlado[], gestorAvisado: boolean, outrosSeguem: boolean): string {
  const nomes = itens.map((c) => `"${c.descricao}"`).join(", ");
  const um = itens.length === 1;
  return (
    `${nomes} ${um ? "é produto controlado" : "são produtos controlados"}: a compra exige autorização e um responsável. ` +
    `Não cotei ${um ? "esse item" : "esses itens"} e ${gestorAvisado ? "avisei o gestor de compras" : "deixei registrado para o gestor de compras"}.` +
    (outrosSeguem ? " Os outros itens seguem." : "")
  );
}
