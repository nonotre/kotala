// IA falsa do modo determinístico do simulador (3.5, "personas só por template").
// Responde no lugar do Gemini, pela trava de rede (rede.ts), sem sair da máquina e sem
// mudar nada no código dos agentes: o adaptador de IA (src/nucleo/ia/) faz a chamada
// normal e recebe uma resposta no formato da API do Gemini.
//
// Só dois agentes têm resposta:
// - Interpretador: devolve a interpretação que o cenário declarou para o texto do comprador;
// - Extrator: devolve a leitura que a persona registrou junto com o texto que mandou
//   (a "verdade" da persona). Assim o modo determinístico testa o fluxo, as regras e o
//   gabarito; o Extrator de verdade é testado na rodada com IA real (--ia).
// Os outros (justificativa do mapa, resposta a dúvida, plano de busca) recebem erro 400,
// e o código deles já tem a reserva sem IA (texto padrão, plano simples).

import { Extracao, type LeituraExtrator } from "../agentes/extrator/index.ts";
import { Interpretacao } from "../agentes/interpretador/index.ts";
import type { RespondedorGemini } from "./rede.ts";

export const MODELO_FALSO = "simulador-ia-falsa";

type Item = {
  descricao: string;
  quantidade: number;
  unidade: string;
  especificacao?: { nome: string; valor: string }[];
  marca?: string | null;
  marcaExigida?: boolean;
  aceitaSimilar?: boolean | null;
};

/** O que o cenário declara da interpretação; o resto vem com o padrão de um pedido simples. */
export type InterpretacaoSimulada = {
  classe?: "pedido" | "ambiguo" | "controlado" | "proibido" | "fora_do_escopo" | "consulta" | "injecao" | "ofensa";
  subtipo?: string | null;
  itens: Item[];
  destino?: string | null;
  setor?: string | null;
  prazoTexto?: string | null;
  prazoDias?: number | null;
  urgencia?: "normal" | "urgente" | "parada";
  pagamento?: string | null;
  faltando?: string[];
};

/** Leitura do Extrator: só os campos que a persona sabe; o resto fica null ou vazio. */
export type LeituraSimulada = Partial<LeituraExtrator>;

const normalizar = (t: string) => t.replace(/\s+/g, " ").trim();

const leituras = new Map<string, LeituraSimulada>();
const interpretacoes = new Map<string, InterpretacaoSimulada>();
/** Chamadas que a IA falsa não soube responder (texto sem leitura registrada), para o relatório. */
export const semResposta: { agente: string; texto: string }[] = [];

/** A persona registra a leitura certa do texto que vai mandar (antes de mandar). */
export function registrarLeitura(texto: string, leitura: LeituraSimulada) {
  leituras.set(normalizar(texto), leitura);
}

/** O cenário registra a interpretação do texto do comprador. */
export function registrarInterpretacao(texto: string, i: InterpretacaoSimulada) {
  interpretacoes.set(normalizar(texto), i);
}

export function limparIaFalsa() {
  leituras.clear();
  interpretacoes.clear();
  semResposta.length = 0;
}

/** Leitura completa no formato do Extrator, validada pelo mesmo zod. Erro aqui é erro do cenário. */
export function leituraCompleta(l: LeituraSimulada): LeituraExtrator {
  const base = {
    classificacao: "outro",
    duvida: null,
    itemOferecido: null,
    aderencia: "exato",
    divergencias: [],
    leituraPreco: "unitario",
    trechoPreco: null,
    alertas: [],
    descontoPercentual: null,
    descontoValor: null,
    descontoCondicao: null,
    precoUnitario: null,
    quantidadeOfertada: null,
    unidadeOfertada: null,
    embalagem: null,
    totalProduto: null,
    frete: null,
    impostosValor: null,
    impostosNaoInclusos: null,
    prazoDias: null,
    validadeDias: null,
    pagamento: null,
    prazoPagamentoDias: null,
    entregaNoLocal: null,
    cnpj: null,
  };
  return Extracao.parse({ ...base, ...l });
}

/** Interpretação completa no formato do Interpretador, validada pelo mesmo zod. */
export function interpretacaoCompleta(i: InterpretacaoSimulada) {
  return Interpretacao.parse({
    classe: i.classe ?? "pedido",
    subtipo: i.subtipo ?? null,
    motivo: "Interpretação declarada no cenário do simulador (IA falsa).",
    opcoes: [],
    tentouMudarRegras: false,
    hostil: false,
    condicaoIrregular: null,
    itens: i.itens.map((it) => ({
      descricao: it.descricao,
      quantidade: it.quantidade,
      unidade: it.unidade,
      especificacao: it.especificacao ?? [],
      marca: it.marca ?? null,
      marcaExigida: it.marcaExigida ?? false,
      aceitaSimilar: it.aceitaSimilar ?? null,
      risco: "nenhum",
      motivoRisco: null,
    })),
    destino: i.destino ?? null,
    cep: null,
    modoEntrega: null,
    janelaRecebimento: null,
    prazoTexto: i.prazoTexto ?? null,
    prazoDias: i.prazoDias ?? null,
    urgencia: i.urgencia ?? "normal",
    setor: i.setor ?? null,
    pagamento: i.pagamento ?? null,
    entregas: null,
    faltando: i.faltando ?? [],
    suposicoes: [],
  });
}

type CorpoGemini = {
  systemInstruction?: { parts?: { text?: string }[] };
  contents?: { role?: string; parts?: { text?: string }[] }[];
};

function textos(corpo: CorpoGemini) {
  const sistema = (corpo.systemInstruction?.parts ?? []).map((p) => p.text ?? "").join("\n");
  const usuario = (corpo.contents ?? []).flatMap((c) => (c.parts ?? []).map((p) => p.text ?? "")).join("\n");
  return { sistema, usuario };
}

const entre = (texto: string, tag: string) => {
  const todas = [...texto.matchAll(new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`, "g"))];
  return todas.map((m) => m[1]!);
};

function respostaGemini(valor: unknown) {
  const texto = typeof valor === "string" ? valor : JSON.stringify(valor);
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: texto }], role: "model" }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      modelVersion: MODELO_FALSO,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function erroGemini(mensagem: string) {
  return new Response(JSON.stringify({ error: { code: 400, message: mensagem, status: "INVALID_ARGUMENT" } }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

/** Decide a resposta a partir do corpo da chamada. Puro (fora o registro de falta), para os testes. */
export function responderComoGemini(corpo: CorpoGemini): { ok: true; valor: unknown } | { ok: false; erro: string } {
  const { sistema, usuario } = textos(corpo);
  if (sistema.startsWith("Você é o Extrator")) {
    const msg = entre(usuario, "mensagem_fornecedor")[0] ?? "";
    const l = leituras.get(normalizar(msg));
    if (!l) {
      semResposta.push({ agente: "Extrator", texto: msg.slice(0, 200) });
      // Sem leitura registrada: lê como recado sem preço, o que o Extrator real faria com um texto qualquer.
      return { ok: true, valor: leituraCompleta({}) };
    }
    return { ok: true, valor: leituraCompleta(l) };
  }
  if (sistema.startsWith("Você é o Interpretador")) {
    // Vale a última correção, se houver; senão o pedido.
    const candidatos = [...entre(usuario, "correcao").reverse(), ...entre(usuario, "pedido")];
    for (const t of candidatos) {
      const i = interpretacoes.get(normalizar(t));
      if (i) return { ok: true, valor: interpretacaoCompleta(i) };
    }
    semResposta.push({ agente: "Interpretador", texto: (candidatos[0] ?? "").slice(0, 200) });
    return { ok: true, valor: interpretacaoCompleta({ classe: "fora_do_escopo", subtipo: "conversa", itens: [] }) };
  }
  return { ok: false, erro: "IA falsa do simulador: este agente não tem resposta simulada (o código usa a reserva sem IA)." };
}

/** O respondedor que a trava de rede usa no lugar do Gemini. */
export const iaFalsa: RespondedorGemini = async (_url, init) => {
  let corpo: CorpoGemini = {};
  try {
    corpo = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as CorpoGemini;
  } catch {
    return erroGemini("IA falsa do simulador: corpo ilegível.");
  }
  const r = responderComoGemini(corpo);
  return r.ok ? respostaGemini(r.valor) : erroGemini(r.erro);
};

/**
 * Ambiente da IA falsa: uma chave de mentira (o adaptador exige uma) e um modelo só por papel,
 * com nome que deixa claro no uso_ia que a chamada não foi ao Gemini.
 */
export function ambienteIaFalsa(env: NodeJS.ProcessEnv = process.env) {
  env.GEMINI_API_KEY = "simulador-sem-chave";
  delete env.GEMINI_API_KEY_RESERVA;
  for (const v of ["IA_MODELOS_RAPIDO", "IA_MODELOS_FORTE", "IA_MODELOS_CONVERSA", "IA_MODELOS_CONVERSA_FORTE", "IA_MODELOS_JUIZ"]) env[v] = MODELO_FALSO;
}
