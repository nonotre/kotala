// 3.5: conferência. Expectativas do gabarito, como funções puras sobre o rastro da rodada,
// e as expectativas que valem para todo cenário (trava de rede, valor de outro fornecedor).

import type { Cenario, Expectativa, LinhaMapaRastro, MapaRastro, MensagemRastro, Rastro, ResultadoExpectativa } from "./tipos.ts";
import type { TipoEnvio } from "../../nucleo/mensagens/index.ts";
import { brl } from "./falas.ts";

const ok = (detalhe?: string): ResultadoExpectativa => ({ ok: true, ...(detalhe ? { detalhe } : {}) });
const falha = (detalhe: string): ResultadoExpectativa => ({ ok: false, detalhe });
const curto = (t: string, n = 120) => (t.length > n ? `${t.slice(0, n)}…` : t).replace(/\s+/g, " ");

type Vezes = number | { min?: number; max?: number };
function contaBate(n: number, vezes: Vezes | undefined): boolean {
  if (vezes === undefined) return n >= 1;
  if (typeof vezes === "number") return n === vezes;
  return n >= (vezes.min ?? 0) && n <= (vezes.max ?? Infinity);
}
const textoVezes = (v: Vezes | undefined) =>
  v === undefined ? "pelo menos 1" : typeof v === "number" ? String(v) : `${v.min ?? 0} a ${v.max ?? "∞"}`;

/** Mapa mais recente do primeiro item (o cenário tem um item só, salvo dito). */
export const ultimoMapa = (r: Rastro): MapaRastro | null => {
  const item = r.itens[0];
  const doItem = r.mapas.filter((m) => !item || m.itemPedidoId === item.id);
  return doItem.at(-1) ?? null;
};

const linhaDo = (m: MapaRastro, fornecedor: string): LinhaMapaRastro | undefined =>
  [...m.validas, ...m.cortadas].find((l) => l.fornecedor === fornecedor);

// ---------- Estado ----------

export function estadoDoItem(estados: string | string[], regra = "Estado"): Expectativa {
  const lista = Array.isArray(estados) ? estados : [estados];
  return {
    descricao: `item termina em ${lista.join(" ou ")}`,
    regra,
    conferir: (r) => {
      const e = r.itens[0]?.estado;
      return e && lista.includes(e) ? ok() : falha(`item em ${e ?? "(sem item)"}`);
    },
  };
}

// ---------- Mapa ----------

export function mapaSai(o: { validas: number; cortadas?: number; contem?: string[]; semFornecedor?: string[]; recomendada?: string }, regra = "R14"): Expectativa {
  const partes = [`${o.validas} válidas`, o.cortadas !== undefined ? `${o.cortadas} cortadas` : "", o.contem?.length ? `com ${o.contem.join(", ")}` : "", o.semFornecedor?.length ? `sem ${o.semFornecedor.join(", ")}` : ""].filter(Boolean);
  return {
    descricao: `mapa sai com ${partes.join(", ")}`,
    regra,
    conferir: (r) => {
      const m = ultimoMapa(r);
      if (!m) return falha("nenhum mapa");
      const nomes = m.validas.map((l) => l.fornecedor);
      const erros: string[] = [];
      if (m.validas.length !== o.validas) erros.push(`${m.validas.length} válidas (${nomes.join(", ")})`);
      if (o.cortadas !== undefined && m.cortadas.length !== o.cortadas) erros.push(`${m.cortadas.length} cortadas (${m.cortadas.map((l) => `${l.fornecedor}: ${l.motivos.join("; ")}`).join(" | ")})`);
      for (const f of o.contem ?? []) if (!nomes.includes(f)) erros.push(`${f} não está entre as válidas`);
      for (const f of o.semFornecedor ?? []) if (linhaDo(m, f)) erros.push(`${f} aparece no mapa`);
      if (o.recomendada && m.recomendada !== o.recomendada) erros.push(`recomendada ${m.recomendada}, não ${o.recomendada}`);
      return erros.length ? falha(erros.join("; ")) : ok(`válidas: ${nomes.join(", ")}`);
    },
  };
}

export function semMapa(regra = "R14b"): Expectativa {
  return { descricao: "nenhum mapa sai", regra, conferir: (r) => (r.mapas.length ? falha(`${r.mapas.length} mapa(s)`) : ok()) };
}

/** A linha do fornecedor no último mapa tem um alerta (ou a nota da negociação) que casa com o padrão. */
export function linhaDoMapa(fornecedor: string, padrao: RegExp, regra: string, campo: "alertas" | "negociacao" = "alertas"): Expectativa {
  return {
    descricao: `no mapa, ${fornecedor} mostra ${campo === "alertas" ? "o alerta" : "a negociação"} ${padrao}`,
    regra,
    conferir: (r) => {
      const m = ultimoMapa(r);
      if (!m) return falha("nenhum mapa");
      const l = linhaDo(m, fornecedor);
      if (!l) return falha(`${fornecedor} não está no mapa`);
      const textos = campo === "alertas" ? l.alertas : l.negociacao ? [l.negociacao] : [];
      return textos.some((t) => padrao.test(t)) ? ok(textos.find((t) => padrao.test(t))) : falha(`${campo}: ${textos.join(" | ") || "(vazio)"}`);
    },
  };
}

/** Custo total da linha do fornecedor no último mapa (produto + frete), em reais, com 1 centavo de folga. */
export function custoNoMapa(fornecedor: string, esperado: number, regra: string): Expectativa {
  return {
    descricao: `no mapa, ${fornecedor} custa R$ ${brl(esperado)}`,
    regra,
    conferir: (r) => {
      const m = ultimoMapa(r);
      const l = m && linhaDo(m, fornecedor);
      if (!l) return falha(`${fornecedor} não está no mapa`);
      return l.custo !== null && Math.abs(l.custo - esperado) <= 0.01 ? ok() : falha(`custo ${l.custo === null ? "vazio" : `R$ ${brl(l.custo)}`}`);
    },
  };
}

// ---------- Eventos ----------

export function evento(acao: RegExp, o: { fornecedor?: string; dadosTipo?: string; vezes?: Vezes; regra: string; descricao?: string }): Expectativa {
  return {
    descricao: o.descricao ?? `evento ${acao}${o.fornecedor ? ` de ${o.fornecedor}` : ""} (${textoVezes(o.vezes)})`,
    regra: o.regra,
    conferir: (r) => {
      const achados = r.eventos.filter(
        (e) => acao.test(e.acao) && (!o.fornecedor || e.fornecedores.includes(o.fornecedor)) && (!o.dadosTipo || e.dados?.tipo === o.dadosTipo),
      );
      return contaBate(achados.length, o.vezes) ? ok(achados[0] ? curto(achados[0].acao) : undefined) : falha(`${achados.length} evento(s)`);
    },
  };
}

// ---------- Mensagens ----------

type FiltroMensagem = { com: string; direcao?: "saida" | "entrada"; tipo?: TipoEnvio; texto?: RegExp; botoes?: RegExp[] };

function casa(m: MensagemRastro, f: FiltroMensagem) {
  if (m.com !== f.com) return false;
  if (m.direcao !== (f.direcao ?? "saida")) return false;
  if (f.tipo && m.tipo !== f.tipo) return false;
  if (f.texto && !f.texto.test(m.texto)) return false;
  if (f.botoes && !f.botoes.every((b) => m.botoes?.some((x) => b.test(x.rotulo)))) return false;
  return true;
}

export function mensagem(f: FiltroMensagem & { vezes?: Vezes; regra: string; descricao?: string }): Expectativa {
  const partes = [f.tipo ? `[${f.tipo}]` : "", f.texto ? String(f.texto) : "", f.botoes ? `botões ${f.botoes.join(" ")}` : ""].filter(Boolean).join(" ");
  return {
    descricao: f.descricao ?? `${f.direcao === "entrada" ? "de" : "para"} ${f.com}: ${partes} (${textoVezes(f.vezes)})`,
    regra: f.regra,
    conferir: (r) => {
      const achadas = r.mensagens.filter((m) => casa(m, f));
      if (contaBate(achadas.length, f.vezes)) return ok(achadas[0] ? curto(achadas[0].texto) : undefined);
      const doContato = r.mensagens.filter((m) => m.com === f.com && m.direcao === (f.direcao ?? "saida"));
      return falha(`${achadas.length} mensagem(ns); última para ${f.com}: ${doContato.at(-1) ? `[${doContato.at(-1)!.tipo ?? "-"}] ${curto(doContato.at(-1)!.texto)}` : "(nenhuma)"}`);
    },
  };
}

export function nuncaMensagem(f: FiltroMensagem & { regra: string; descricao?: string }): Expectativa {
  return { ...mensagem({ ...f, vezes: 0 }), descricao: f.descricao ?? `nenhuma mensagem para ${f.com} com ${f.texto ?? f.tipo}` };
}

/**
 * Ester (revisaodochat.md) e R13: o pedido de desconto sai em mensagem própria, depois do
 * recebimento, sem outra pergunta junto; e depois dele nada sai ao fornecedor por `esperaSeg`,
 * a menos que ele responda antes.
 */
export function descontoEmMensagemPropria(fornecedor: string, esperaSeg: number): Expectativa {
  return {
    descricao: `pedido de desconto a ${fornecedor} em mensagem própria, depois do recebimento, e ${esperaSeg}s sem outra mensagem`,
    regra: "R13/desconto",
    conferir: (r) => {
      const conversa = r.mensagens.filter((m) => m.com === fornecedor);
      const i = conversa.findIndex((m) => m.direcao === "saida" && m.tipo === "negociacao");
      if (i < 0) return falha("nenhum pedido de desconto");
      const d = conversa[i]!;
      if (/recebi sua proposta|para completar|me diga também/i.test(d.texto)) return falha(`desconto junto de outra coisa: ${curto(d.texto)}`);
      const antes = conversa.slice(0, i).filter((m) => m.direcao === "saida").at(-1);
      if (!antes || antes.tipo !== "proposta_recebida") return falha(`antes do desconto veio ${antes ? `[${antes.tipo ?? "-"}] ${curto(antes.texto, 60)}` : "nada"}`);
      const depois = conversa.slice(i + 1);
      const resposta = depois.find((m) => m.direcao === "entrada");
      const limite = Math.min(d.em + esperaSeg * 1000, resposta?.em ?? Infinity);
      const cedo = depois.find((m) => m.direcao === "saida" && m.em < limite);
      return cedo ? falha(`saiu ${((cedo.em - d.em) / 1000).toFixed(1)}s depois: [${cedo.tipo ?? "-"}] ${curto(cedo.texto, 60)}`) : ok();
    },
  };
}

/** A mensagem `primeira` chega ao contato antes da `segunda` (primeira ocorrência de cada). */
export function ordem(com: string, primeira: Omit<FiltroMensagem, "com">, segunda: Omit<FiltroMensagem, "com">, regra: string, descricao: string): Expectativa {
  return {
    descricao,
    regra,
    conferir: (r) => {
      const a = r.mensagens.find((m) => casa(m, { com, ...primeira }));
      const b = r.mensagens.find((m) => casa(m, { com, ...segunda }));
      if (!a) return falha("a primeira mensagem não saiu");
      if (!b) return falha("a segunda mensagem não saiu");
      return a.em <= b.em ? ok() : falha(`a segunda saiu ${((a.em - b.em) / 1000).toFixed(1)}s antes`);
    },
  };
}

// ---------- Cotação e contato ----------

export function situacaoDaCotacao(fornecedor: string, situacao: string, regra: string): Expectativa {
  return {
    descricao: `cotação de ${fornecedor} fica ${situacao}`,
    regra,
    conferir: (r) => {
      const c = r.cotacoes.filter((x) => x.fornecedor === fornecedor).at(-1);
      return c?.situacao === situacao ? ok() : falha(`situação ${c?.situacao ?? "(sem cotação)"}`);
    },
  };
}

export function contatoAtivo(fornecedor: string, ativo: boolean, regra: string): Expectativa {
  return {
    descricao: `contato de ${fornecedor} ${ativo ? "continua ativo" : "parou"}`,
    regra,
    conferir: (r) => {
      const c = r.contatos.find((x) => x.fornecedor === fornecedor);
      return c?.ativo === ativo ? ok() : falha(c ? (c.ativo ? "ativo" : "parou") : "sem contato");
    },
  };
}

// ---------- Expectativas de todo cenário ----------

/** Valores (unitário e total) que cada persona mandou, para conferir que ninguém mais os recebeu. */
function valoresDasPersonas(r: Rastro): Map<string, Set<string>> {
  const porPersona = new Map<string, Set<string>>();
  for (const m of r.mensagens) {
    if (m.direcao !== "entrada" || m.com === "comprador") continue;
    const s = porPersona.get(m.com) ?? new Set<string>();
    for (const v of m.texto.match(/R\$\s?[\d.]+,\d{2}/g) ?? []) s.add(v.replace(/R\$\s?/, ""));
    porPersona.set(m.com, s);
  }
  return porPersona;
}

export const GLOBAIS: Expectativa[] = [
  {
    descricao: "nenhuma chamada saiu para a internet (trava de rede)",
    regra: "R2",
    conferir: (r) => (r.rede.bloqueadas.length ? falha(`bloqueadas: ${[...new Set(r.rede.bloqueadas)].join(", ")}`) : ok()),
  },
  {
    descricao: "nunca citou a um fornecedor o valor de outro",
    regra: "07/11",
    conferir: (r) => {
      const valores = valoresDasPersonas(r);
      for (const m of r.mensagens) {
        if (m.direcao !== "saida" || m.com === "comprador") continue;
        const meus = valores.get(m.com) ?? new Set<string>();
        for (const [outro, vs] of valores) {
          if (outro === m.com) continue;
          for (const v of vs) {
            if (meus.has(v)) continue;
            if (m.texto.includes(v)) return falha(`para ${m.com}, citou ${v} de ${outro}: ${curto(m.texto)}`);
          }
        }
      }
      return ok();
    },
  },
  {
    descricao: "passos do comprador cumpridos (botões e estados esperados apareceram)",
    regra: "roteiro",
    conferir: (r) => (r.passosFalhos.length ? falha(r.passosFalhos.join("; ")) : ok()),
  },
  {
    descricao: "sem erro no simulador nem leitura sem gabarito na IA falsa",
    regra: "roteiro",
    conferir: (r) => {
      const problemas = [...r.erros, ...r.iaSemResposta.map((s) => `IA falsa sem leitura (${s.agente}): "${curto(s.texto, 60)}"`)];
      return problemas.length ? falha(problemas.join("; ")) : ok();
    },
  },
];

export type ResultadoCenario = {
  cenario: string;
  titulo: string;
  esperadoFalhar: string | null;
  passou: boolean;
  resultados: { descricao: string; regra: string; ok: boolean; detalhe?: string }[];
  duracaoMs: number;
  usoIa: Rastro["usoIa"];
  rede: Rastro["rede"];
};

/** Confere o rastro contra o gabarito do cenário e as expectativas globais. Puro. */
export function conferir(c: Cenario, r: Rastro): ResultadoCenario {
  const resultados = [...c.gabarito, ...GLOBAIS].map((e) => {
    let res: ResultadoExpectativa;
    try {
      res = e.conferir(r);
    } catch (erro) {
      res = falha(`erro na conferência: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
    return { descricao: e.descricao, regra: e.regra, ok: res.ok, ...(res.detalhe ? { detalhe: res.detalhe } : {}) };
  });
  return {
    cenario: c.chave,
    titulo: c.titulo,
    esperadoFalhar: c.esperadoFalhar ?? null,
    passou: resultados.every((x) => x.ok),
    resultados,
    duracaoMs: r.duracaoMs,
    usoIa: r.usoIa,
    rede: r.rede,
  };
}
