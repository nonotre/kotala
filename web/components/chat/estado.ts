// Estado da tela Conversar que os pedaços desenhados dentro do chat (botões, rodapé de envio) precisam ler.
// Mora fora do React porque o chat da Carbon desenha esses pedaços por conta própria.
// Nada daqui é conversa: a conversa está no banco e chega por /api/chat.

import { useSyncExternalStore } from "react";

export type Botao = { rotulo: string; dado: string };

/** Igual a PREFIXO_LINK em src/assistente/tipos.ts: copiado aqui para o bundle do navegador não puxar código do servidor. */
export const PREFIXO_LINK = "link:";

/** Rota interna de um botão de link, ou null se o botão é de ação (ou se a rota não é uma rota do próprio site). */
export function rotaDoLink(botao: Botao): string | null {
  if (!botao.dado.startsWith(PREFIXO_LINK)) return null;
  return rotaInterna(botao.dado.slice(PREFIXO_LINK.length));
}

/** Só caminho da mesma origem: "//outro.site" e "/\x" também navegariam para fora. */
export function rotaInterna(href: string): string | null {
  return /^\/(?![/\\])/.test(href) ? href : null;
}

/** Botão que o assistente manda para o chat navegar: nada vai ao assistente. */
export const ehLink = (botao: Botao) => botao.dado.startsWith(PREFIXO_LINK);

/** Uma linha da tabela mensagem, como /api/chat devolve. */
export type MensagemChat = {
  id: string;
  direcao: "entrada" | "saida";
  texto: string;
  botoes: Botao[] | null;
  criadoEm: string;
  /** Anexos do comprador (imagem, PDF, áudio): só nome e tipo. */
  anexos?: { tipo: string; nome: string | null }[];
};

/** Envio que não chegou ao assistente, ou que chegou e ficou sem resposta. */
export type Falha = {
  erro: string;
  texto: string;
  botao?: string;
  /** Falso quando a mensagem já está no banco: mandar de novo duplicaria. */
  podeTentar: boolean;
};

type Estado = {
  /** Só a última mensagem do assistente com botões de ação mostra esses botões, como antes. Os de link não contam. */
  ultimaComBotoes: string | null;
  /** Envios esperando a API interna: os botões ficam desligados enquanto isso. */
  enviando: number;
  /** Por id do envio, no chat. */
  falhas: Record<string, Falha>;
};

const VAZIO: Estado = { ultimaComBotoes: null, enviando: 0, falhas: {} };

let atual: Estado = VAZIO;
const ouvintes = new Set<() => void>();

function mudar(novo: Partial<Estado>) {
  atual = { ...atual, ...novo };
  ouvintes.forEach((o) => o());
}

function assinar(o: () => void) {
  ouvintes.add(o);
  return () => {
    ouvintes.delete(o);
  };
}

export function useEstadoChat<T>(ler: (e: Estado) => T): T {
  return useSyncExternalStore(assinar, () => ler(atual), () => ler(VAZIO));
}

export function definirUltimaComBotoes(id: string | null) {
  if (atual.ultimaComBotoes !== id) mudar({ ultimaComBotoes: id });
}

export function comecarEnvio() {
  mudar({ enviando: atual.enviando + 1 });
}

export function terminarEnvio() {
  mudar({ enviando: Math.max(0, atual.enviando - 1) });
}

export function marcarFalha(id: string, falha: Falha | null) {
  const { [id]: _antiga, ...resto } = atual.falhas;
  mudar({ falhas: falha ? { ...resto, [id]: falha } : resto });
}

export function falhaDoEnvio(id: string): Falha | undefined {
  return atual.falhas[id];
}

/** Ao sair da tela: a próxima abertura começa do que está no banco. */
export function zerarEstado() {
  atual = VAZIO;
  ouvintes.forEach((o) => o());
}

// ---------- Rótulo dos botões tocados ----------
// O banco guarda o toque num botão como mensagem sem texto. Para a conversa mostrar o que foi tocado,
// também depois de recarregar, o rótulo fica neste navegador, pelo id da mensagem.

const CHAVE_ROTULOS = "kotala-chat-botoes";
const MAXIMO_ROTULOS = 300;

function lerRotulos(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_ROTULOS) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function rotuloDoToque(mensagemId: string): string | undefined {
  return lerRotulos()[mensagemId];
}

export function guardarRotuloDoToque(mensagemId: string, rotulo: string) {
  try {
    const todos = Object.entries({ ...lerRotulos(), [mensagemId]: rotulo }).slice(-MAXIMO_ROTULOS);
    localStorage.setItem(CHAVE_ROTULOS, JSON.stringify(Object.fromEntries(todos)));
  } catch {
    // Sem armazenamento, o toque aparece com o texto genérico depois de recarregar.
  }
}
