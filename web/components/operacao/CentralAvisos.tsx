"use client";
// Avisos: o que espera o comprador agora, em ordem de urgência, e o que já aconteceu nos últimos dias.

import { Button, Column, ContentSwitcher, Layer, Link as CarbonLink, Select, SelectItem, Switch } from "@carbon/react";
import { ArrowRight, CheckmarkOutline } from "@carbon/react/icons";
import NextLink from "next/link";
import { useState, type CSSProperties } from "react";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { CabecalhoPagina, CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { SeloSimulado } from "@/components/SeloSimulado";
import { useCelular } from "@/components/useCelular";
import type { Acontecido, AvisoSerial } from "@/lib/dados-operacao";
import { dataHora } from "@/lib/formato";
import { Urgencia } from "./Situacao";
import { VERBO_DO_AVISO, nomeDoCanal } from "./textos";
import s from "./avisos.module.scss";

const TODOS = "todos";

const O_QUE_CHEGA = [
  "Quando o assistente leu um pedido e espera você confirmar o que entendeu.",
  "Quando o mapa de cotação fica pronto e falta a sua decisão.",
  "Quando você comprou o mesmo item há pouco e pode repetir a compra.",
  "Quando nenhum fornecedor mandou proposta que passasse nas regras.",
];

/** O canal do pedido. Conversar fica no app; os outros só dizem por onde o pedido chegou. */
function CanalDoPedido({ canal }: { canal: string }) {
  if (canal === "web") {
    return (
      <CarbonLink as={NextLink} href="/chat" size="sm">
        Abrir em Conversar
      </CarbonLink>
    );
  }
  return <span className={s.rotulo}>Chegou por {nomeDoCanal(canal)}</span>;
}

function LinhaTarefa({ aviso, principal }: { aviso: AvisoSerial; principal: boolean }) {
  const celular = useCelular();
  return (
    <li className={s.tarefa}>
      <span className={s.hora}>{dataHora(aviso.em)}</span>
      <div className={s.tarefaTexto}>
        <p className={s.rotulo}>
          Pedido {aviso.pedidoId}
          {aviso.item ? ` · ${aviso.item}` : null}
        </p>
        <p className={principal ? s.fraseGrande : s.frase}>{aviso.titulo}</p>
        <p className={s.apoio}>{aviso.texto}</p>
        {aviso.urgencia !== "normal" ? (
          <div className={s.tarefaMarcas}>
            <Urgencia urgencia={aviso.urgencia} />
          </div>
        ) : null}
      </div>
      <div className={s.tarefaAcao}>
        <Button as={NextLink} href={aviso.href} kind={principal ? "primary" : "tertiary"} size={celular ? "lg" : "md"} renderIcon={ArrowRight}>
          {VERBO_DO_AVISO[aviso.tipo]}
        </Button>
        <CanalDoPedido canal={aviso.canal} />
      </div>
    </li>
  );
}

type Passado = { chave: string; pedidoId: number; texto: string; item: string | null; fornecedor: string | null; simulado: boolean; canal: string; em: string; href: string };

function LinhaPassada({ p }: { p: Passado }) {
  return (
    <li className={s.passado}>
      <span className={s.passadoHora}>{dataHora(p.em)}</span>
      <div className={s.passadoTexto}>
        <p className={s.passadoFrase}>{p.texto}</p>
        {p.item ? <p className={s.passadoApoio}>{p.item}</p> : null}
        {p.fornecedor && p.simulado ? <SeloSimulado /> : null}
      </div>
      <span className={s.passadoPedido}>
        <CarbonLink as={NextLink} href={p.href}>
          Pedido {p.pedidoId}
        </CarbonLink>
      </span>
      <span className={s.passadoCanal}>{nomeDoCanal(p.canal)}</span>
    </li>
  );
}

/** Sem pendência é boa notícia: uma faixa calma, e o histórico continua na primeira dobra. */
function TudoEmDia() {
  const celular = useCelular();
  return (
    <Layer as="section" className={s.superficie}>
      <div className={s.emDia}>
        <CheckmarkOutline size={32} className={s.emDiaIcone} aria-hidden="true" />
        <div className={s.tarefaTexto}>
          <h2 className={s.fraseGrande}>Nada precisa de você agora.</h2>
          <p className={s.apoio}>Quando precisar, o aviso aparece aqui e no sino.</p>
        </div>
        <Button as={NextLink} href="/quadro" kind="tertiary" size={celular ? "lg" : "md"} renderIcon={ArrowRight}>
          Ver o quadro
        </Button>
      </div>
    </Layer>
  );
}

function OQueChega() {
  return (
    <Bloco titulo="O que chega aqui" plano solto>
      <ul className={s.oQueChega}>
        {O_QUE_CHEGA.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </Bloco>
  );
}

type OpcaoFiltro = { id: string; rotulo: string; n: number };

/** Só aparece com mais de um canal. No celular, a lista nativa. */
function FiltroCanal({ opcoes, ativo, aoEscolher }: { opcoes: OpcaoFiltro[]; ativo: string; aoEscolher: (id: string) => void }) {
  const celular = useCelular();
  if (celular) {
    return (
      <Select id="filtro-canal" labelText="Canal" value={ativo} onChange={(e) => aoEscolher(e.target.value)}>
        {opcoes.map((o) => (
          <SelectItem key={o.id} value={o.id} text={`${o.rotulo} (${o.n})`} />
        ))}
      </Select>
    );
  }
  return (
    <ContentSwitcher
      size="md"
      className={s.filtro}
      style={{ "--opcoes": opcoes.length } as CSSProperties}
      selectedIndex={Math.max(
        opcoes.findIndex((o) => o.id === ativo),
        0,
      )}
      aria-label="Filtrar avisos por canal"
      onChange={({ index }) => aoEscolher(opcoes[index ?? 0]?.id ?? TODOS)}
    >
      {opcoes.map((o) => (
        <Switch key={o.id} name={o.id} text={`${o.rotulo} (${o.n})`} />
      ))}
    </ContentSwitcher>
  );
}

function SemResultado({ titulo, aoVerTodos }: { titulo: string; aoVerTodos: () => void }) {
  return (
    <div className={s.semResultado}>
      <span>{titulo}</span>
      <Button kind="ghost" size="sm" onClick={aoVerTodos}>
        Ver todos
      </Button>
    </div>
  );
}

type Props = {
  avisos: AvisoSerial[];
  acontecidos: Acontecido[];
  /** Há algum pedido no banco? Sem nenhum, é a primeira vez. */
  temPedidos: boolean;
};

export function CentralAvisos({ avisos, acontecidos, temPedidos }: Props) {
  const [filtro, setFiltro] = useState<string>(TODOS);

  // A ordem vem de lib/avisos.ts: obra parada, urgente, depois o mais novo.
  const tarefas = avisos.filter((a) => a.tipo !== "sem_proposta");
  const passados: Passado[] = [
    ...avisos
      .filter((a) => a.tipo === "sem_proposta")
      .map((a) => ({ chave: a.chave, pedidoId: a.pedidoId, texto: a.titulo, item: null, fornecedor: null, simulado: false, canal: a.canal, em: a.em, href: a.href })),
    ...acontecidos,
  ].sort((a, b) => b.em.localeCompare(a.em));

  const canais = [...new Set([...tarefas.map((a) => a.canal), ...passados.map((p) => p.canal)])].filter(Boolean);
  // Um canal que deixou de ter aviso não pode prender a tela num filtro que já sumiu.
  const canal = canais.length > 1 && canais.includes(filtro) ? filtro : null;
  const contar = (c: string) => tarefas.filter((a) => a.canal === c).length + passados.filter((p) => p.canal === c).length;
  const opcoes: OpcaoFiltro[] = [{ id: TODOS, rotulo: "Todos", n: tarefas.length + passados.length }, ...canais.map((c) => ({ id: c, rotulo: nomeDoCanal(c), n: contar(c) }))];
  const tarefasVistas = canal ? tarefas.filter((a) => a.canal === canal) : tarefas;
  const passadosVistos = canal ? passados.filter((p) => p.canal === canal) : passados;
  const verTodos = () => setFiltro(TODOS);
  const contagem = (n: number) => <span className={s.contagem}>{n === 1 ? "1 aviso" : `${n} avisos`}</span>;

  return (
    <Pagina>
      <CabecalhoPagina titulo="Avisos" contexto="O que espera você agora e o que mudou nas suas compras." />
      <CorpoPagina>
        {!temPedidos ? (
          <GradePagina>
            <Column sm={4} md={8} lg={16} xlg={11}>
              <Layer as="section" className={s.superficie}>
                <EstadoVazio
                  titulo="Os avisos chegam aqui."
                  proximoPasso="Quando um pedido precisar de você, ele aparece aqui e no sino."
                  acao={{ texto: "Fazer um pedido", href: "/chat" }}
                />
              </Layer>
            </Column>
            <Column sm={4} md={8} lg={16} xlg={5} className={s.lado}>
              <OQueChega />
            </Column>
          </GradePagina>
        ) : (
          <GradePagina>
            <Column sm={4} md={8} lg={16} xlg={11} className={s.principal}>
              {canais.length > 1 ? <FiltroCanal opcoes={opcoes} ativo={canal ?? TODOS} aoEscolher={setFiltro} /> : null}
              {tarefasVistas.length > 0 ? (
                <Bloco titulo="Precisa de você" acao={contagem(tarefasVistas.length)}>
                  <ul className={s.tarefas}>
                    {tarefasVistas.map((a, i) => (
                      <LinhaTarefa key={a.chave} aviso={a} principal={i === 0} />
                    ))}
                  </ul>
                </Bloco>
              ) : canal ? (
                <Layer as="section" className={s.superficie}>
                  <SemResultado titulo="Nada precisa de você neste canal." aoVerTodos={verTodos} />
                </Layer>
              ) : (
                <TudoEmDia />
              )}
              {passados.length > 0 ? (
                <Bloco titulo="O que já aconteceu" descricao="Últimos 7 dias." plano solto acao={passadosVistos.length > 0 ? contagem(passadosVistos.length) : undefined}>
                  {passadosVistos.length > 0 ? (
                    <ol className={s.passados}>
                      {passadosVistos.map((p) => (
                        <LinhaPassada key={p.chave} p={p} />
                      ))}
                    </ol>
                  ) : (
                    <SemResultado titulo="Nenhum aviso antigo neste canal." aoVerTodos={verTodos} />
                  )}
                </Bloco>
              ) : null}
            </Column>
            <Column sm={4} md={8} lg={16} xlg={5} className={s.lado}>
              <OQueChega />
              <Bloco titulo="Onde mais ver" plano solto>
                <p className={s.ladoTexto}>
                  O sino no topo conta o que pede você. O{" "}
                  <CarbonLink as={NextLink} href="/quadro" inline>
                    quadro
                  </CarbonLink>{" "}
                  e a{" "}
                  <CarbonLink as={NextLink} href="/pedidos" inline>
                    lista de pedidos
                  </CarbonLink>{" "}
                  ficam sempre atualizados.
                </p>
              </Bloco>
            </Column>
          </GradePagina>
        )}
      </CorpoPagina>
    </Pagina>
  );
}
