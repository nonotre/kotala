"use client";
// N5: tudo o que aconteceu no pedido, em ordem: ações dos agentes com o motivo,
// mudanças de dados, chamadas de IA e mensagens. Filtros por tipo.
import { useState } from "react";
import { Tag } from "@carbon/react";
import estilos from "./linha.module.scss";

export type EntradaSerial =
  | { tipo: "evento"; em: string; agente: string; acao: string; motivo: string; deEstado: string | null; paraEstado: string | null }
  | { tipo: "dado"; em: string; tabela: string; chave: string; operacao: string; mudancas: { campo: string; de: unknown; para: unknown }[] }
  | { tipo: "ia"; em: string; agente: string; modelo: string; rota: string; ok: boolean; duracaoMs: number; tokensEntrada: number | null; tokensSaida: number | null; erro: string | null; prompt: string | null; resposta: string | null }
  | { tipo: "mensagem"; em: string; canal: string; direcao: string; situacao: string; texto: string };

const ROTULO = { evento: "Agentes", ia: "IA", mensagem: "Mensagens", dado: "Dados" } as const;
type Tipo = keyof typeof ROTULO;

const NOME_TABELA: Record<string, string> = {
  pedido: "Pedido",
  item_pedido: "Item",
  cotacao: "Cotação",
  oferta: "Proposta",
  referencia_preco: "Preço da internet",
  mapa_cotacao: "Mapa",
  historico_compra: "Histórico",
};

const hora = (s: string) => new Date(s).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
const curto = (v: unknown) => {
  const t = typeof v === "string" ? v : JSON.stringify(v);
  return t && t.length > 60 ? `${t.slice(0, 60)}…` : t;
};

export function LinhaDoTempo({ entradas }: { entradas: EntradaSerial[] }) {
  const [ligados, setLigados] = useState<Record<Tipo, boolean>>({ evento: true, mensagem: true, ia: true, dado: false });
  const [aberto, setAberto] = useState<number | null>(null);
  const visiveis = entradas.map((e, i) => ({ e, i })).filter(({ e }) => ligados[e.tipo]);
  return (
    <div>
      <div className={estilos.filtros} role="group" aria-label="Mostrar">
        {(Object.keys(ROTULO) as Tipo[]).map((t) => (
          <label key={t} className={estilos.filtro}>
            <input type="checkbox" checked={ligados[t]} onChange={() => setLigados((l) => ({ ...l, [t]: !l[t] }))} />
            {ROTULO[t]} ({entradas.filter((e) => e.tipo === t).length})
          </label>
        ))}
      </div>
      <ol className={estilos.lista}>
        {visiveis.map(({ e, i }) => (
          <li key={i} className={estilos[e.tipo]}>
            <span className={estilos.hora}>{hora(e.em)}</span>
            {e.tipo === "evento" ? (
              <div>
                <strong>{e.agente}</strong>: {e.acao}
                {e.paraEstado ? <Tag size="sm" type="cool-gray">{`${e.deEstado ?? "início"} → ${e.paraEstado}`}</Tag> : null}
                <div className={estilos.motivo}>{e.motivo}</div>
              </div>
            ) : e.tipo === "mensagem" ? (
              <div>
                <strong>{e.direcao === "entrada" ? "Recebida" : "Enviada"}</strong> · {e.canal}
                {e.situacao !== "enviada" && e.situacao !== "recebida" ? <Tag size="sm" type="magenta">{e.situacao}</Tag> : null}
                <div className={estilos.texto}>{e.texto || "(botão)"}</div>
              </div>
            ) : e.tipo === "ia" ? (
              <div>
                <button type="button" className={estilos.abrir} onClick={() => setAberto(aberto === i ? null : i)} aria-expanded={aberto === i}>
                  <strong>IA · {e.agente.replace(/^\w+:/, "")}</strong> · {e.modelo} · {e.duracaoMs} ms
                  {e.tokensEntrada ? ` · ${e.tokensEntrada}→${e.tokensSaida} tokens` : ""}
                  {e.rota !== "principal" ? " · chave de reserva" : ""}
                </button>
                {!e.ok ? <Tag size="sm" type="red">falhou</Tag> : null}
                {e.erro ? <div className={estilos.motivo}>{e.erro}</div> : null}
                {aberto === i ? (
                  <div className={estilos.ia}>
                    <h4>Enviado</h4>
                    <pre>{e.prompt ?? "(não guardado)"}</pre>
                    <h4>Resposta</h4>
                    <pre>{e.resposta ?? "(não guardada)"}</pre>
                  </div>
                ) : null}
              </div>
            ) : (
              <div>
                <strong>{NOME_TABELA[e.tabela] ?? e.tabela}</strong> {e.operacao === "INSERT" ? "criado" : e.operacao === "DELETE" ? "apagado (guardado na auditoria)" : "alterado"}
                <div className={estilos.motivo}>
                  {e.mudancas
                    .filter((m) => !["criado_em", "id"].includes(m.campo))
                    .slice(0, 6)
                    .map((m) => `${m.campo}: ${curto(m.para)}`)
                    .join(" · ")}
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
