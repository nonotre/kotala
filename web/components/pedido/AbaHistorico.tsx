// Aba Histórico: tudo o que aconteceu no pedido, em ordem, com as chamadas de IA
// abertas, e um resumo de quem agiu, contado da própria linha do tempo.

import { Column } from "@carbon/react";
import { Bloco } from "@/components/Bloco";
import { LinhaDoTempo, type EntradaSerial } from "@/components/LinhaDoTempo";
import { GradePagina } from "@/components/Pagina";
import { Tabela } from "@/components/Tabela";
import type { DadosPedido } from "@/lib/dados-pedido";
import { Campos } from "./Item";
import s from "./pedido.module.scss";

type Entrada = DadosPedido["linhaDoTempo"][number];

/** Só o que a linha do tempo mostra, com a data em texto para ir ao navegador. */
function serial(e: Entrada): EntradaSerial {
  const em = e.em.toISOString();
  switch (e.tipo) {
    case "evento":
      return { tipo: "evento", em, agente: e.agente, acao: e.acao, motivo: e.motivo, deEstado: e.deEstado, paraEstado: e.paraEstado };
    case "dado":
      return { tipo: "dado", em, tabela: e.tabela, chave: e.chave, operacao: e.operacao, mudancas: e.mudancas };
    case "ia":
      return { ...e, em };
    case "mensagem":
      return { tipo: "mensagem", em, canal: e.canal, direcao: e.direcao, situacao: e.situacao, texto: e.texto };
  }
}

const milhar = (n: number) => n.toLocaleString("pt-BR");

export function AbaHistorico({ d }: { d: DadosPedido }) {
  const tempo = d.linhaDoTempo.map(serial);
  const agentes = new Map<string, number>();
  for (const e of d.linhaDoTempo) if (e.tipo === "evento") agentes.set(e.agente, (agentes.get(e.agente) ?? 0) + 1);
  const ias = d.linhaDoTempo.filter((e) => e.tipo === "ia");
  const msgs = d.linhaDoTempo.filter((e) => e.tipo === "mensagem");
  const tokens = ias.reduce((t, e) => t + (e.tokensEntrada ?? 0) + (e.tokensSaida ?? 0), 0);
  const segundos = ias.reduce((t, e) => t + e.duracaoMs, 0) / 1000;

  return (
    <GradePagina>
      <Column sm={4} md={8} lg={11}>
        <Bloco titulo="Linha do tempo" descricao="Tudo o que aconteceu neste pedido, em ordem. Toque numa chamada de IA para ver o que foi enviado e respondido.">
          <LinhaDoTempo entradas={tempo} />
        </Bloco>
      </Column>
      <Column sm={4} md={8} lg={5}>
        <div className={`${s.painelPreso} ${s.pilha}`}>
          <Bloco titulo="Agentes neste pedido">
            <Tabela
              rotulo="Ações por agente"
              tamanho="sm"
              vazio="Nenhum agente agiu neste pedido ainda."
              colunas={["Agente", "Ações"]}
              linhas={[...agentes.entries()].sort((a, b) => b[1] - a[1]).map(([a, n]) => [a, <span key="n" className={s.numero}>{n}</span>])}
            />
          </Bloco>
          <Bloco titulo="Chamadas de IA e mensagens">
            <Campos
              linhas={[
                ["Chamadas de IA", milhar(ias.length)],
                ["Falharam", ias.length ? milhar(ias.filter((e) => !e.ok).length) : null],
                ["Tokens", ias.length ? milhar(tokens) : null],
                ["Tempo de IA", ias.length ? `${segundos.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s` : null],
                ["Mensagens recebidas", milhar(msgs.filter((e) => e.direcao === "entrada").length)],
                ["Mensagens enviadas", milhar(msgs.filter((e) => e.direcao !== "entrada").length)],
              ]}
            />
          </Bloco>
        </div>
      </Column>
    </GradePagina>
  );
}
