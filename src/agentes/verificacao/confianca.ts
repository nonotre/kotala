// Q8: julga se o fornecedor é confiável, em código puro. Junta CNPJ na
// Receita, atividade, idade da empresa, presença verificável, histórico de
// compras e homologação. Verificar é diferente de homologar: a homologação é
// decisão da empresa e só soma pontos.

import type { DadosCnpj } from "./cnpj.ts";

export type Nivel = "alta" | "media" | "baixa" | "simulado";

export type EntradaJulgamento = {
  simulado: boolean;
  homologado: boolean;
  /** Dados da Receita; null quando não há CNPJ ou ele não existe. */
  cnpj: DadosCnpj | null;
  /** Tinha CNPJ, mas é inválido ou não existe na Receita. */
  cnpjInexistente: boolean;
  /** Consulta fora do ar: não pune, só não confirma. */
  consultaIndisponivel: boolean;
  /** Link da fonte (site, página do produto) que abre. */
  presencaVerificavel: boolean;
  compras: number;
  prazosCumpridos: number;
  prazosAvaliados: number;
  /** CEIS e CNEP (Portal da Transparência); null quando a base não carregou. */
  sancoes?: { base: string | null; vigentes: { cadastro: string; categoria: string | null; orgao: string | null; fim: string | null; mesmaUnidade: boolean }[]; encerradas: number } | null;
  /** Portal da Transparência pela API (pessoa-juridica); null sem chave ou fora do ar. */
  portal?: { sancoes: string[]; forneceGoverno: boolean; sinais: string[] } | null;
  /** Processos no TJSP; null quando não consultou. */
  tjsp?: { disponivel: true; processos: number; classesGraves: string[] } | { disponivel: false; motivo: string } | null;
  hoje?: Date;
};

export type Julgamento = {
  pontos: number;
  nivel: Nivel;
  verificado: boolean;
  /** Frases curtas do que pesou, para a tela e o registro. */
  motivos: string[];
  /** Sinais de suspeita (R8), vão para os alertas do mapa. */
  alertas: string[];
};

const ATIVIDADE_DA_AREA = /constru|ferrag|ferrament|cimento|areia|pedra|brita|madeira|tinta|el[eé]tric|hidr[aá]ulic|tijol|cer[aâ]mic|vidro|a[cç]o|metal|telha|piso|revestiment|argamass|concreto/i;

function anosDesde(data: string, hoje: Date): number | null {
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return null;
  return (hoje.getTime() - d.getTime()) / (365.25 * 24 * 3600_000);
}

export function julgar(e: EntradaJulgamento): Julgamento {
  if (e.simulado) {
    return { pontos: 60, nivel: "simulado", verificado: false, motivos: ["Fornecedor simulado, da base fictícia do time"], alertas: [] };
  }
  const hoje = e.hoje ?? new Date();
  let pontos = 40;
  const motivos: string[] = [];
  const alertas: string[] = [];
  let verificado = false;

  if (e.cnpj) {
    const ativa = e.cnpj.situacao.toUpperCase() === "ATIVA";
    if (ativa) {
      pontos += 25;
      verificado = true;
      motivos.push(`CNPJ ativo na Receita (${e.cnpj.fonte})`);
    } else {
      pontos -= 40;
      motivos.push(`CNPJ ${e.cnpj.situacao.toLowerCase()} na Receita`);
      alertas.push(`CNPJ ${e.cnpj.situacao.toLowerCase()} na Receita`);
    }
    if (e.cnpj.atividade && ATIVIDADE_DA_AREA.test(e.cnpj.atividade)) {
      pontos += 10;
      motivos.push("Atividade de materiais de construção");
    } else if (e.cnpj.atividade) {
      pontos -= 10;
      motivos.push(`Atividade fora da área: ${e.cnpj.atividade}`);
      alertas.push("Atividade registrada fora de materiais de construção");
    }
    const anos = e.cnpj.abertura ? anosDesde(e.cnpj.abertura, hoje) : null;
    if (anos !== null) {
      if (anos >= 3) {
        pontos += 5;
        motivos.push(`Empresa aberta há ${Math.floor(anos)} anos`);
      } else if (anos < 1) {
        pontos -= 10;
        motivos.push("Empresa aberta há menos de 1 ano");
        alertas.push("Empresa aberta há menos de 1 ano");
      }
    }
  } else if (e.cnpjInexistente) {
    pontos -= 15;
    motivos.push("CNPJ informado não existe ou é inválido");
    alertas.push("CNPJ informado não existe ou é inválido");
  } else if (e.consultaIndisponivel) {
    motivos.push("Não verificado agora: consulta de CNPJ fora do ar");
  } else {
    motivos.push("Sem CNPJ para conferir");
  }

  if (e.sancoes) {
    if (e.sancoes.vigentes.length) {
      pontos -= 40;
      for (const s of e.sancoes.vigentes.slice(0, 2)) {
        const texto = `${s.cadastro}: ${s.categoria ?? "sanção"}${s.orgao ? ` (${s.orgao})` : ""}${s.fim && !/sem informa/i.test(s.fim) ? ` até ${s.fim}` : ""}${s.mesmaUnidade ? "" : ", em outra unidade da empresa"}`;
        motivos.push(texto);
        alertas.push(`Empresa punida pelo poder público: ${texto}`);
      }
    } else {
      pontos += 5;
      motivos.push(`Sem sanção vigente no CEIS e no CNEP${e.sancoes.base ? ` (base de ${e.sancoes.base})` : ""}`);
    }
    if (e.sancoes.encerradas) motivos.push(`${e.sancoes.encerradas} ${e.sancoes.encerradas === 1 ? "sanção encerrada" : "sanções encerradas"} no passado`);
  }

  if (e.portal) {
    // Sanção que o arquivo diário ainda não trazia: a API é mais recente.
    const novas = e.portal.sancoes.filter((c) => !e.sancoes?.vigentes.some((s) => s.cadastro === c));
    if (novas.length && !e.sancoes?.vigentes.length) {
      pontos -= 40;
      const texto = `sancionada no ${novas.join(" e ")} (Portal da Transparência)`;
      motivos.push(`Empresa ${texto}`);
      alertas.push(`Empresa punida pelo poder público: ${texto}`);
    }
    if (e.portal.forneceGoverno) {
      // Fornecer ao governo é sinal de empresa real; com sanção vigente, não soma pontos.
      const punida = !!e.sancoes?.vigentes.length || e.portal.sancoes.length > 0;
      if (!punida) pontos += 5;
      motivos.push(`Já fornece ao governo federal: ${e.portal.sinais.join(", ")}`);
    }
  }

  if (e.tjsp) {
    if (!e.tjsp.disponivel) motivos.push(`TJSP não consultado: ${e.tjsp.motivo}`);
    else if (e.tjsp.classesGraves.length) {
      pontos -= 20;
      motivos.push(`TJSP: ${e.tjsp.classesGraves.join(", ")}`);
      alertas.push(`Processo de ${e.tjsp.classesGraves.join(" ou ").toLowerCase()} no TJSP`);
    } else {
      motivos.push(e.tjsp.processos ? `TJSP: ${e.tjsp.processos} ${e.tjsp.processos === 1 ? "processo" : "processos"}, nenhum de falência ou recuperação` : "TJSP: nenhum processo encontrado");
    }
  }

  if (e.presencaVerificavel) {
    pontos += 10;
    motivos.push("Site ou página da fonte abre");
  } else if (!e.cnpj) {
    alertas.push("Sem presença verificável");
  }

  if (e.compras > 0) {
    pontos += Math.min(15, e.compras * 5);
    const taxa = e.prazosAvaliados ? e.prazosCumpridos / e.prazosAvaliados : null;
    motivos.push(`Já vendeu ${e.compras} ${e.compras === 1 ? "vez" : "vezes"}${taxa !== null ? `, prazo cumprido em ${Math.round(taxa * 100)}%` : ""}`);
    if (taxa !== null && taxa < 0.7) {
      pontos -= 15;
      alertas.push("Histórico de atraso na entrega");
    }
  } else {
    motivos.push("Sem histórico de compras");
  }

  if (e.homologado) {
    pontos += 15;
    motivos.push("Homologado pela empresa");
  }

  pontos = Math.max(0, Math.min(100, pontos));
  const nivel: Nivel = pontos >= 75 ? "alta" : pontos >= 50 ? "media" : "baixa";
  return { pontos, nivel, verificado, motivos, alertas };
}

export const ROTULO_NIVEL: Record<Nivel, string> = { alta: "alta", media: "média", baixa: "baixa", simulado: "simulado" };
