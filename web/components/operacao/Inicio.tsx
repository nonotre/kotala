"use client";
// Início: a tarefa que mais pede o comprador em destaque; o resto (pendências, andamento, números
// e registro) em apoio. Tudo vem do banco: sem tarefa, o destaque é o caminho para pedir.

import { Button, Column, Layer, Link as CarbonLink, Tile, preview__IconIndicator as IconIndicator } from "@carbon/react";
import { ArrowRight, Chat, CheckmarkOutline } from "@carbon/react/icons";
import NextLink from "next/link";
import type { ReactNode } from "react";
import { BarraAcao } from "@/components/BarraAcao";
import { Bloco } from "@/components/Bloco";
import { CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { SeloIA } from "@/components/SeloIA";
import { SeloSimulado } from "@/components/SeloSimulado";
import type { AvisoSerial, Heroi, LinhaPedido, Numeros, Registro } from "@/lib/dados-operacao";
import { brl, dataHora, dias, quantidade } from "@/lib/formato";
import { ProgressoPedido } from "./ProgressoPedido";
import { EtapaIndicador, NomeFornecedor, Situacao, Urgencia } from "./Situacao";
import { VERBO_DO_AVISO, nomeDoCanal } from "./textos";
import s from "./inicio.module.scss";

export type Informativo = { chave: string; pedidoId: number; texto: string; canal: string; em: string; href: string };

type Props = {
  /** Só o que pede ação, na ordem de lib/avisos.ts. A primeira vira o destaque. */
  tarefas: AvisoSerial[];
  heroi: Heroi | null;
  /** A linha da lista do pedido do destaque: dá a etapa e o progresso. */
  linhaHeroi: LinhaPedido | null;
  andamento: LinhaPedido[];
  numeros: Numeros;
  registro: { pedidoId: number; itens: Registro[] } | null;
  informativos: Informativo[];
};

type Acao = { texto: string; href: string };

// ---------- Destaque ----------

function Fatos({ destino, prazoTexto, urgencia }: { destino: string | null; prazoTexto: string | null; urgencia: string }) {
  const partes: ReactNode[] = [destino, prazoTexto].filter(Boolean);
  if (urgencia !== "normal") partes.push(<Urgencia key="u" urgencia={urgencia} />);
  if (!partes.length) return null;
  return (
    <p className={s.heroiFatos}>
      {partes.map((p, i) => (
        <span key={i}>{p}</span>
      ))}
    </p>
  );
}

function MoldeHeroi({ selo, rotulo, titulo, contexto, children, rodape }: { selo?: ReactNode; rotulo?: ReactNode; titulo: string; contexto?: ReactNode; children?: ReactNode; rodape?: ReactNode }) {
  return (
    <Tile className={s.heroi} decorator={selo || undefined}>
      <Layer className={s.heroiMiolo}>
        <div className={s.heroiTopo}>
          {rotulo ? <p className={s.heroiRotulo}>{rotulo}</p> : null}
          <h1 className={s.heroiTitulo}>{titulo}</h1>
          {contexto}
        </div>
        {children}
        {rodape ? <div className={s.heroiRodape}>{rodape}</div> : null}
      </Layer>
    </Tile>
  );
}

/** A ação principal mora no destaque a partir de lg; abaixo, na barra do pé. */
function Rodape({ acao, secundaria }: { acao: Acao; secundaria?: Acao }) {
  return (
    <>
      <span className={s.soLargo}>
        <Button as={NextLink} href={acao.href} size="lg" renderIcon={ArrowRight}>
          {acao.texto}
        </Button>
      </span>
      {secundaria ? (
        <Button as={NextLink} href={secundaria.href} kind="ghost" size="lg">
          {secundaria.texto}
        </Button>
      ) : null}
    </>
  );
}

function Progresso({ l, validas, respostas }: { l: LinhaPedido | null; validas: number | null; respostas?: { consultados: number; respostas: number } | null }) {
  if (!l) return null;
  return (
    <div className={s.heroiProgresso}>
      <ProgressoPedido coluna={l.coluna} estadoPedido={l.estado} estadoItem={l.itemDaVez?.estado ?? null} respostas={respostas ?? l.respostas} validas={validas} />
    </div>
  );
}

function HeroiDecidir({ h, l }: { h: Extract<Heroi, { tipo: "decidir" }>; l: LinhaPedido | null }) {
  const v = h.propostas.find((p) => p.recomendada) ?? null;
  const acao = { texto: VERBO_DO_AVISO.decidir, href: h.aviso.href };
  const n = h.propostas.length;
  return (
    <MoldeHeroi
      selo={
        v ? (
          <SeloIA titulo={`Recomendamos ${v.fornecedor}`}>
            <p>
              Maior nota entre as {n} propostas válidas do mapa de cotação.{h.urgente ? " Com a urgência do pedido, o prazo pesa mais." : ""} Quem decide é você.
            </p>
          </SeloIA>
        ) : undefined
      }
      rotulo={
        <>
          <span>Pedido {h.aviso.pedidoId}</span>
          <span>{h.descricao}</span>
        </>
      }
      titulo={`Escolha quem entrega ${quantidade(h.quantidade, h.unidade)}`}
      contexto={<Fatos destino={h.destino} prazoTexto={h.prazoTexto} urgencia={h.urgencia} />}
      rodape={<Rodape acao={acao} secundaria={{ texto: "Ver o pedido", href: `/pedidos/${h.aviso.pedidoId}` }} />}
    >
      <Progresso l={l} validas={n} respostas={h.respostas.consultados ? h.respostas : null} />
      <div className={s.numeros}>
        {v ? (
          <div className={s.numeroLinha}>
            <div className={s.numeroPrincipal}>
              <p className={s.numeroRotulo}>Recomendada, custo total com frete</p>
              <p className={s.numero}>{brl(v.custo)}</p>
              <NomeFornecedor nome={v.fornecedor} simulado={v.simulado} />
              {v.prazoDias !== null ? <p className={s.numeroPrazo}>Entrega em {dias(v.prazoDias)}</p> : null}
            </div>
            <div className={s.trocaBloco}>
              <dl className={s.troca}>
                <div>
                  <dt className={s.numeroRotulo}>{h.aMais > 0 ? "A mais que a mais barata" : "Comparada às outras"}</dt>
                  <dd className={s.trocaNumero}>{h.aMais > 0 ? brl(h.aMais) : "A mais barata"}</dd>
                </div>
                {h.aMais > 0 && h.difPrazo !== null ? (
                  <div>
                    <dt className={s.numeroRotulo}>{h.difPrazo > 0 ? "Entrega antes da mais barata" : h.difPrazo < 0 ? "Entrega depois da mais barata" : "Prazo da mais barata"}</dt>
                    <dd className={s.trocaNumero}>{h.difPrazo === 0 ? "O mesmo" : dias(Math.abs(h.difPrazo))}</dd>
                  </div>
                ) : null}
              </dl>
              {h.urgente && h.difPrazo !== null && h.difPrazo > 0 ? <p className={s.porque}>Com a urgência do pedido, o prazo pesa mais.</p> : null}
              <Alertas lista={h.alertas} />
            </div>
          </div>
        ) : (
          <>
            <p className={s.heroiFrase}>
              {n === 0
                ? "Nenhuma proposta válida no mapa."
                : n === 1
                  ? "Há 1 proposta válida. Não há comparação."
                  : `Há ${n} propostas válidas. Com menos de 3, o assistente não diz qual é a melhor.`}
            </p>
            <Alertas lista={h.alertas} />
          </>
        )}
        {n > 0 ? (
          <div className={s.soLargo}>
            <table className={s.propostas}>
              <caption className={s.somenteLeitor}>As {n} propostas válidas{v ? ", com a recomendada na primeira linha" : ", da mais barata para a mais cara"}</caption>
              <thead>
                <tr>
                  <th scope="col">Fornecedor</th>
                  <th scope="col">Custo total</th>
                  <th scope="col">Prazo</th>
                </tr>
              </thead>
              <tbody>
                {h.propostas.map((p, i) => (
                  <tr key={`${p.fornecedor}-${i}`} className={p.recomendada ? s.propostaRecomendada : undefined}>
                    <td>
                      <span className={s.propostaFornecedor}>
                        {p.fornecedor}
                        {p.simulado ? <SeloSimulado /> : null}
                        {p.recomendada ? <span className={s.propostaMarca}>Recomendada</span> : null}
                      </span>
                    </td>
                    <td>{brl(p.custo)}</td>
                    <td>{p.prazoDias !== null ? dias(p.prazoDias) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </MoldeHeroi>
  );
}

/** O alerta dito por extenso, junto dos números. */
function Alertas({ lista }: { lista: string[] }) {
  if (!lista.length) return null;
  return (
    <ul className={s.alertas}>
      {lista.map((t) => (
        <li key={t}>
          <IconIndicator kind="caution-minor" label={t} size={16} />
        </li>
      ))}
    </ul>
  );
}

const A_CONFIRMAR = "A confirmar";

function HeroiConfirmar({ h, l }: { h: Extract<Heroi, { tipo: "confirmar_pedido" }>; l: LinhaPedido | null }) {
  const entrega = [h.modoEntrega === "retirada" ? "Retirada" : h.modoEntrega === "entrega" ? "Entrega na obra" : null, h.janela].filter(Boolean).join(", ");
  const linhas: [string, ReactNode][] = [
    [
      h.itens.length === 1 ? "Item" : "Itens",
      h.itens.length ? (
        <ul>
          {h.itens.map((i, n) => (
            <li key={n}>
              {quantidade(i.quantidade, i.unidade)} de {i.descricao}
            </li>
          ))}
        </ul>
      ) : (
        A_CONFIRMAR
      ),
    ],
    ["Obra", h.destino ?? A_CONFIRMAR],
    ["Prazo", h.prazoTexto ?? A_CONFIRMAR],
    ["Entrega", entrega || A_CONFIRMAR],
  ];
  return (
    <MoldeHeroi
      selo={
        <SeloIA titulo="O que o assistente entendeu">
          <p>O assistente leu a sua mensagem e separou itens, quantidades, obra e prazo. Nada sai para os fornecedores antes de você confirmar.</p>
        </SeloIA>
      }
      rotulo={<span>Pedido {h.aviso.pedidoId}</span>}
      titulo={h.aviso.titulo}
      contexto={h.urgencia !== "normal" ? <Fatos destino={null} prazoTexto={null} urgencia={h.urgencia} /> : null}
      rodape={<Rodape acao={{ texto: VERBO_DO_AVISO.confirmar_pedido, href: h.aviso.href }} />}
    >
      <Progresso l={l} validas={null} />
      <div className={s.entendido}>
        <dl className={s.entendidoLista}>
          {linhas.map(([rotulo, valor]) => (
            <div key={rotulo}>
              <dt className={s.numeroRotulo}>{rotulo}</dt>
              <dd className={valor === A_CONFIRMAR ? s.entendidoAssumido : s.entendidoValor}>{valor}</dd>
            </div>
          ))}
        </dl>
        {h.suposicoes.length ? (
          <div className={s.listaCurta}>
            <p className={s.numeroRotulo}>O assistente assumiu, confira</p>
            <ul>
              {h.suposicoes.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {h.faltando.length ? (
          <div className={s.listaCurta}>
            <p className={s.numeroRotulo}>Falta dizer</p>
            <ul>
              {h.faltando.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className={s.citacao}>
          <span className={s.numeroRotulo}>Você escreveu</span>
          <span>{h.texto}</span>
        </p>
      </div>
    </MoldeHeroi>
  );
}

function HeroiSimples({ h, l }: { h: Extract<Heroi, { tipo: "recompra" | "sem_proposta" }>; l: LinhaPedido | null }) {
  return (
    <MoldeHeroi
      rotulo={
        <>
          <span>Pedido {h.aviso.pedidoId}</span>
          {h.aviso.item ? <span>{h.aviso.item}</span> : null}
        </>
      }
      titulo={h.aviso.titulo}
      contexto={<Fatos destino={h.destino} prazoTexto={h.prazoTexto} urgencia={h.urgencia} />}
      rodape={<Rodape acao={{ texto: VERBO_DO_AVISO[h.tipo], href: h.aviso.href }} />}
    >
      <Progresso l={l} validas={null} />
      <p className={s.heroiFrase}>{h.aviso.texto}</p>
    </MoldeHeroi>
  );
}

const PASSOS: [string, string][] = [
  ["Você pede", "Escreva do seu jeito, aqui em Conversar ou pelo Telegram. Um pedido pode ter vários itens: eles são cotados um por vez."],
  ["O assistente cota", "Ele procura fornecedores, manda a cotação, lê as respostas e monta o mapa de cotação."],
  ["Você decide", "Nada é comprado sem a sua aprovação."],
];

/** Sem tarefa, o caminho para pedir é o que há para fazer. */
function HeroiLivre({ primeiraVez, andando }: { primeiraVez: boolean; andando: boolean }) {
  return (
    <Tile className={s.heroi}>
      <Layer className={s.heroiMiolo}>
        <div className={s.heroiTopo}>
          {primeiraVez ? null : <CheckmarkOutline size={32} className={s.heroiIcone} aria-hidden="true" />}
          <h1 className={s.heroiTitulo}>{primeiraVez ? "Faça seu primeiro pedido" : "Nada precisa de você agora."}</h1>
          <p className={s.heroiFrase}>
            {primeiraVez
              ? "Diga o que a obra precisa, do seu jeito. O assistente cota e você decide."
              : andando
                ? "O assistente está cuidando do resto. Quando precisar de você, o aviso aparece aqui e no sino."
                : "Tudo resolvido. Quando quiser comprar mais, é só dizer o que precisa."}
          </p>
        </div>
        {primeiraVez ? (
          <ol className={s.passos}>
            {PASSOS.map(([titulo, texto], i) => (
              <li key={titulo} className={s.passo}>
                <span className={s.passoNumero} aria-hidden="true">
                  {i + 1}
                </span>
                <span className={s.passoTexto}>
                  <span className={s.passoTitulo}>{titulo}</span>
                  <span className={s.passoCorpo}>{texto}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        <div className={s.heroiRodape}>
          <Button as={NextLink} href="/chat" size="lg" renderIcon={Chat}>
            Fazer um pedido
          </Button>
          {primeiraVez ? null : (
            <Button as={NextLink} href="/quadro" kind="ghost" size="lg">
              Ver o quadro
            </Button>
          )}
        </div>
      </Layer>
    </Tile>
  );
}

// ---------- Apoio ----------

function PrecisaDeVoce({ lista }: { lista: AvisoSerial[] }) {
  return (
    <ul className={s.linhas}>
      {lista.map((a) => (
        <li key={a.chave} className={s.pendencia}>
          <p className={s.linhaRotulo}>
            <span>Pedido {a.pedidoId}</span>
            {a.item ? <span>{a.item}</span> : null}
          </p>
          <p className={s.pendenciaTexto}>{a.titulo}</p>
          {a.urgencia !== "normal" ? <Urgencia urgencia={a.urgencia} /> : null}
          <div className={s.pendenciaAcao}>
            <CarbonLink as={NextLink} href={a.href} renderIcon={ArrowRight}>
              {VERBO_DO_AVISO[a.tipo]}
            </CarbonLink>
          </div>
        </li>
      ))}
    </ul>
  );
}

function nomeDaLinha(l: LinhaPedido): string {
  const i = l.itemDaVez;
  return i ? `${quantidade(i.quantidade, i.unidade)} de ${i.descricao}` : l.texto.length > 60 ? `${l.texto.slice(0, 60)}…` : l.texto;
}

/** O que está andando sem precisar do comprador, em linhas curtas. */
function EmAndamento({ lista }: { lista: LinhaPedido[] }) {
  return (
    <ul className={s.linhas}>
      {lista.map((l) => (
        <li key={l.id} className={s.andamento}>
          <div className={s.andamentoTopo}>
            <p className={s.andamentoTitulo}>
              <CarbonLink as={NextLink} href={l.itemDaVez ? `/pedidos/${l.id}#item-${l.itemDaVez.id}` : `/pedidos/${l.id}`}>
                Pedido {l.id}
              </CarbonLink>
              <span className={s.linhaItem}>{nomeDaLinha(l)}</span>
            </p>
            <EtapaIndicador coluna={l.coluna} />
          </div>
          <p className={s.andamentoTexto}>{l.passo}</p>
          <div className={s.andamentoEtiquetas}>
            <Urgencia urgencia={l.urgencia} />
            <Situacao lista={l.etiquetas} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmNumeros({ n }: { n: Numeros }) {
  const itens: [string, number][] = [
    ["Pedidos abertos", n.abertos],
    ["Itens em cotação", n.emCotacao],
    ["Cotações esperando resposta", n.aguardandoResposta],
    ["Compras fechadas", n.fechadas],
  ];
  return (
    <dl className={s.indicadores}>
      {itens.map(([rotulo, valor]) => (
        <div key={rotulo} className={s.indicador}>
          <dt className={s.numeroRotulo}>{rotulo}</dt>
          <dd className={s.indicadorValor}>{valor.toLocaleString("pt-BR")}</dd>
        </div>
      ))}
    </dl>
  );
}

function RegistroAssistente({ pedidoId, itens }: { pedidoId: number; itens: Registro[] }) {
  return (
    <>
      <ol className={s.registro}>
        {itens.map((e) => (
          <li key={e.id} className={s.registroLinha}>
            <span className={s.registroHora}>{dataHora(e.em)}</span>
            <span className={s.registroTexto}>
              <span className={s.registroAcao}>{e.acao}</span>
              <span className={s.registroMotivo}>{e.motivo}</span>
            </span>
          </li>
        ))}
      </ol>
      <CarbonLink as={NextLink} href={`/pedidos/${pedidoId}/historico`} className={s.linkSolto}>
        Ver o histórico do pedido {pedidoId}
      </CarbonLink>
    </>
  );
}

function UltimosAvisos({ lista }: { lista: Informativo[] }) {
  return (
    <>
      <ul className={s.registro}>
        {lista.map((a) => (
          <li key={a.chave} className={s.registroLinha}>
            <span className={s.registroHora}>{dataHora(a.em)}</span>
            <span className={s.registroTexto}>
              <span className={s.registroAcao}>{a.texto}</span>
              <span className={s.registroMotivo}>
                <CarbonLink as={NextLink} href={a.href} size="sm">
                  Pedido {a.pedidoId}
                </CarbonLink>
                {" · "}
                {nomeDoCanal(a.canal)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <CarbonLink as={NextLink} href="/avisos" className={s.linkSolto}>
        Ver todos os avisos
      </CarbonLink>
    </>
  );
}

// ---------- Tela ----------

export function Inicio({ tarefas, heroi, linhaHeroi, andamento, numeros, registro, informativos }: Props) {
  const primeiraVez = numeros.total === 0;
  const outras = heroi ? tarefas.filter((a) => a.chave !== heroi.aviso.chave) : tarefas;
  const frase = tarefas.length === 1 ? "1 coisa precisa de você." : `${tarefas.length} coisas precisam de você.`;

  const destaque = !heroi ? (
    <HeroiLivre primeiraVez={primeiraVez} andando={andamento.length > 0} />
  ) : heroi.tipo === "decidir" ? (
    <HeroiDecidir h={heroi} l={linhaHeroi} />
  ) : heroi.tipo === "confirmar_pedido" ? (
    <HeroiConfirmar h={heroi} l={linhaHeroi} />
  ) : (
    <HeroiSimples h={heroi} l={linhaHeroi} />
  );

  const acaoPe: Acao | null = heroi ? { texto: VERBO_DO_AVISO[heroi.tipo], href: heroi.aviso.href } : null;
  const resumoPe =
    heroi?.tipo === "decidir"
      ? (() => {
          const v = heroi.propostas.find((p) => p.recomendada);
          return v ? (
            <>
              <NomeFornecedor nome={v.fornecedor} simulado={v.simulado} />
              <strong className={s.resumoCusto}>{brl(v.custo)}</strong>
            </>
          ) : undefined;
        })()
      : undefined;

  const links =
    numeros.total > 0 ? (
      <p className={s.linksPedidos}>
        <CarbonLink as={NextLink} href="/pedidos">
          Ver todos os pedidos
        </CarbonLink>
        {numeros.concluidos > 0 ? (
          <CarbonLink as={NextLink} href="/pedidos?filtro=concluidos">
            Concluídos ({numeros.concluidos})
          </CarbonLink>
        ) : null}
      </p>
    ) : null;

  const temLado = outras.length > 0 || andamento.length > 0;

  return (
    <Pagina>
      {tarefas.length ? (
        <Layer as="header" className={s.topo}>
          <GradePagina>
            <Column sm={4} md={8} lg={10} className={s.topoFrase}>
              <p className={s.frase}>{frase}</p>
              {andamento.length ? <p className={s.fraseApoio}>Do resto, o assistente está cuidando.</p> : null}
            </Column>
            <Column sm={4} md={8} lg={6} className={s.topoAtalhos}>
              <Button as={NextLink} href="/chat" kind="tertiary" size="md" renderIcon={Chat}>
                Conversar
              </Button>
              <Button as={NextLink} href="/quadro" kind="ghost" size="md">
                Ver o quadro
              </Button>
            </Column>
          </GradePagina>
        </Layer>
      ) : null}

      <CorpoPagina>
        <GradePagina className={s.gradePrincipal}>
          <Column sm={4} md={8} lg={16} xlg={temLado ? 10 : 16} className={s.colunaHeroi}>
            {destaque}
          </Column>
          {temLado ? (
            <Column sm={4} md={8} lg={16} xlg={6} className={s.colunaLado}>
              {outras.length ? (
                <Bloco titulo="Precisa de você" acao={<span className={s.contagem}>{outras.length}</span>}>
                  <PrecisaDeVoce lista={outras} />
                </Bloco>
              ) : null}
              {andamento.length ? (
                <Bloco titulo="Em andamento" acao={<span className={s.contagem}>{andamento.length}</span>}>
                  <EmAndamento lista={andamento} />
                </Bloco>
              ) : null}
              {links}
            </Column>
          ) : links ? (
            <Column sm={4} md={8} lg={16}>
              {links}
            </Column>
          ) : null}
        </GradePagina>

        {primeiraVez ? null : (
          <GradePagina className={s.gradeApoio}>
            <Column sm={4} md={8} lg={16}>
              <Bloco titulo="Em números" descricao="Contados agora, a cada atualização da tela.">
                <EmNumeros n={numeros} />
              </Bloco>
            </Column>
          </GradePagina>
        )}

        {registro?.itens.length || informativos.length ? (
          <GradePagina className={s.gradeApoio}>
            {registro?.itens.length ? (
              <Column sm={4} md={8} lg={informativos.length ? 10 : 16} className={s.colunaPlana}>
                <Bloco titulo={`O que o assistente fez no pedido ${registro.pedidoId}`} plano solto>
                  <RegistroAssistente pedidoId={registro.pedidoId} itens={registro.itens} />
                </Bloco>
              </Column>
            ) : null}
            {informativos.length ? (
              <Column sm={4} md={8} lg={registro?.itens.length ? 6 : 16} className={s.colunaPlana}>
                <Bloco titulo="Últimos avisos" plano solto>
                  <UltimosAvisos lista={informativos} />
                </Bloco>
              </Column>
            ) : null}
          </GradePagina>
        ) : null}
      </CorpoPagina>

      {/* Fora do Grid: o espaço que a barra reserva vale no fim da página, e não no meio da coluna. */}
      {acaoPe ? (
        <BarraAcao resumo={resumoPe}>
          <Button as={NextLink} href={acaoPe.href} size="lg" renderIcon={ArrowRight}>
            {acaoPe.texto}
          </Button>
        </BarraAcao>
      ) : null}
    </Pagina>
  );
}
