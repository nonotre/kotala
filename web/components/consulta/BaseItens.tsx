"use client";
// Base de Dados, aba Itens: o que já foi pedido, comprado ou cadastrado, com o preço pago e a referência da internet.
// A busca e a categoria vêm da casca comum.

import {
  Column,
  DataTable,
  Link as CarbonLink,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectRow,
  preview__IconIndicator as IconIndicator,
} from "@carbon/react";
import NextLink from "next/link";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { LinkExterno } from "@/components/LinkExterno";
import { CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { SeloSimulado } from "@/components/SeloSimulado";
import type { ItemDaBase } from "@/lib/dados-consulta";
import { brl, dataHora, quantidade } from "@/lib/formato";
import { CabecalhoBaseDados, ControlesBaseDados, enderecoDaBase, mesmaCategoria, normalizar, type FiltrosBase } from "./CascaBaseDados";
import type { Kind } from "./marcas";
import s from "./consulta.module.scss";

const COLUNAS = [
  { key: "descricao", header: "Item" },
  { key: "categoria", header: "Categoria" },
  { key: "unidade", header: "Unidade" },
  { key: "propostas", header: "Propostas" },
  { key: "compra", header: "Última compra" },
  { key: "referencia", header: "Referência pública" },
];

/** Quantas propostas o item recebeu, somando todos os fornecedores. */
const totalPropostas = (i: ItemDaBase) => i.propostas.reduce((n, p) => n + p.quantas, 0);

const ESTADO: Record<string, { kind: Kind; rotulo: string }> = {
  na_fila: { kind: "not-started", rotulo: "Na fila" },
  buscando: { kind: "in-progress", rotulo: "Captando fornecedores" },
  aguardando_recompra: { kind: "informative", rotulo: "Repetir compra?" },
  cotando: { kind: "in-progress", rotulo: "Esperando propostas" },
  comparando: { kind: "pending", rotulo: "Montando o mapa" },
  aguardando_decisao: { kind: "informative", rotulo: "Aguardando sua decisão" },
  aprovado: { kind: "succeeded", rotulo: "Aprovado" },
  pedido_enviado: { kind: "succeeded", rotulo: "Pedido enviado" },
  confirmado: { kind: "succeeded", rotulo: "Confirmado" },
  sem_proposta: { kind: "caution-minor", rotulo: "Sem proposta válida" },
  cancelado: { kind: "normal", rotulo: "Cancelado" },
};

const data = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });

function traduzirOrdem(_id: string, args?: { header: unknown }): string {
  return `Ordenar por ${String(args?.header ?? "esta coluna")}`;
}

function especificacaoEmTexto(e: Record<string, string>): string {
  return Object.entries(e)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
}

function Detalhe({ i }: { i: ItemDaBase }) {
  const ultima = i.compras[0];
  const espec = Object.entries(i.especificacao);
  return (
    <Bloco titulo={i.descricao} descricao={[i.codigo ? `Código ${i.codigo}` : null, i.unidade ? `Comprado por ${i.unidade}` : null, i.categoria].filter(Boolean).join(" · ") || undefined}>
      {i.cadastradoNoPedido ? (
        <p className={s.apoioCorpo}>
          Não estava na base: o assistente cadastrou este item na{" "}
          <CarbonLink as={NextLink} href={`/pedidos/${i.cadastradoNoPedido}`} inline>
            cotação {i.cadastradoNoPedido}
          </CarbonLink>
          .
        </p>
      ) : null}

      {espec.length ? (
        <section className={s.parte} aria-label="Especificação">
          <h3 className={s.subtitulo}>Especificação</h3>
          <dl className={s.ficha}>
            {espec.map(([k, v]) => (
              <div key={k}>
                <dt className={s.rotulo}>{k}</dt>
                <dd className={s.valor}>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className={s.parte} aria-label="Referência pública">
        <h3 className={s.subtitulo}>Referência pública</h3>
        {i.referencia.mediana !== null ? (
          <>
            <p className={s.precoGrande}>{brl(i.referencia.mediana)}</p>
            <p className={s.apoioCorpo}>
              Mediana do preço por {i.unidade || "unidade"} em {i.referencia.lojas} {i.referencia.lojas === 1 ? "loja" : "lojas"} da internet, sem frete. É referência, não proposta.
            </p>
            <ul className={s.listaSimples}>
              {i.referencia.lista.slice(0, 6).map((r) => (
                <li key={r.url} className={s.duasLinhas}>
                  <LinkExterno href={r.url}>{r.loja}</LinkExterno>
                  <span className={s.apoio}>
                    {r.preco !== null ? `${brl(r.preco)} · ` : ""}
                    {r.titulo} · {dataHora(r.coletadoEm)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EstadoVazio compacto titulo="Nenhum preço da internet aceito para este item." />
        )}
      </section>

      <section className={s.parte} aria-label="Compras">
        <h3 className={s.subtitulo}>Compras</h3>
        {ultima ? (
          <ul className={s.listaSimples}>
            {i.compras.map((c, n) => (
              <li key={`${c.data}-${n}`} className={s.duasLinhas}>
                <span className={s.nomeSelo}>
                  <span className={s.numero}>
                    {brl(c.precoUnitario)} por {i.unidade || "unidade"} · {c.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                  </span>
                  {c.simulado ? <SeloSimulado texto="histórico simulado" /> : null}
                </span>
                <span className={s.nomeSelo}>
                  <CarbonLink as={NextLink} href={`/fornecedores/${c.fornecedorId}`} size="sm">
                    {c.fornecedor}
                  </CarbonLink>
                  {c.simuladoFornecedor ? <SeloSimulado /> : null}
                </span>
                <span className={s.apoio}>
                  {data(c.data)}
                  {c.frete !== null ? ` · frete ${brl(c.frete)}` : ""}
                  {c.pedidoId ? ` · cotação ${c.pedidoId}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EstadoVazio compacto titulo="Nenhuma compra deste item ainda." />
        )}
      </section>

      <section className={s.parte} aria-label="Cotações">
        <h3 className={s.subtitulo}>Cotações</h3>
        {i.pedidos.length ? (
          <ul className={s.listaSimples}>
            {i.pedidos.map((p) => {
              const e = ESTADO[p.estado] ?? { kind: "normal" as Kind, rotulo: p.estado };
              return (
                <li key={p.itemId} className={s.duasLinhas}>
                  <CarbonLink as={NextLink} href={`/pedidos/${p.pedidoId}`}>
                    Cotação {p.pedidoId}: {quantidade(p.quantidade, p.unidade)}
                  </CarbonLink>
                  <IconIndicator kind={e.kind} label={`${e.rotulo} · ${dataHora(p.em)}`} size={16} />
                </li>
              );
            })}
          </ul>
        ) : (
          <EstadoVazio compacto titulo="Nenhuma cotação deste item." />
        )}
      </section>

      <div className={s.acoes}>
        <CarbonLink as={NextLink} href="/">
          Pedir na conversa
        </CarbonLink>
      </div>
    </Bloco>
  );
}

function QuemCotou({ i }: { i: ItemDaBase }) {
  const simulados = i.propostas.some((p) => p.simulado);
  return (
    <Bloco titulo={`Quem mandou proposta para ${i.descricao}`} descricao={simulados ? "Inclui fornecedores da base fictícia do time." : undefined}>
      {i.propostas.length ? (
        <ul className={s.listaSimples}>
          {i.propostas.map((p) => (
            <li key={p.fornecedorId} className={s.nomeSelo}>
              <CarbonLink as={NextLink} href={`/fornecedores/${p.fornecedorId}`}>
                {p.fornecedor}
              </CarbonLink>
              {p.simulado ? <SeloSimulado /> : null}
              <span className={s.apoio}>
                {p.quantas} {p.quantas === 1 ? "proposta" : "propostas"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EstadoVazio compacto titulo="Nenhuma proposta para este item ainda." />
      )}
    </Bloco>
  );
}

type Props = { itens: ItemDaBase[]; categorias: string[]; itemInicial: string | null; filtrosIniciais: FiltrosBase };

export function BaseItens({ itens, categorias, itemInicial, filtrosIniciais }: Props) {
  const [filtros, setFiltros] = useState<FiltrosBase>(filtrosIniciais);
  const [selecionado, setSelecionado] = useState<string | null>(itemInicial);
  const painel = useRef<HTMLDivElement>(null);

  // Busca, categoria e item marcado ficam no endereço.
  useEffect(() => {
    window.history.replaceState(null, "", enderecoDaBase("itens", filtros, { item: selecionado }));
  }, [filtros, selecionado]);

  const buscaveis = useMemo(() => itens.map((i) => ({ i, texto: normalizar([i.descricao, i.codigo ?? "", i.chave, i.categoria ?? "", especificacaoEmTexto(i.especificacao)].join(" ")) })), [itens]);
  const termo = normalizar(filtros.busca);
  const lista = buscaveis.filter((x) => (!termo || x.texto.includes(termo)) && (!filtros.categoria || mesmaCategoria(x.i.categoria, filtros.categoria))).map((x) => x.i);
  const atual = lista.find((i) => i.chave === selecionado) ?? null;
  const limpar = () => setFiltros({ busca: "", categoria: "" });

  function escolher(chave: string) {
    setSelecionado(chave);
  }

  /** Abaixo de xlg, o painel fica depois da lista: tocar na linha leva até ele. */
  function clicarNaLinha(e: MouseEvent, chave: string) {
    if ((e.target as HTMLElement).closest("input, label, a")) return;
    escolher(chave);
    if (!window.matchMedia("(min-width: 82rem)").matches) {
      const calmo = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      requestAnimationFrame(() => painel.current?.scrollIntoView({ behavior: calmo ? "auto" : "smooth", block: "start" }));
    }
  }

  const linhas = lista.map((i) => ({
    id: i.chave,
    descricao: i.descricao,
    // Sem categoria vai para o fim, em ordem crescente.
    categoria: i.categoria ?? "\uffff",
    unidade: i.unidade,
    propostas: totalPropostas(i),
    compra: i.compras[0]?.precoUnitario ?? -1,
    referencia: i.referencia.mediana ?? -1,
  }));
  const porChave = new Map(lista.map((i) => [i.chave, i]));

  return (
    <Pagina>
      <CabecalhoBaseDados ativa="itens" filtros={filtros} />
      <CorpoPagina>
        <GradePagina className={s.grade}>
          <Column sm={4} md={8} lg={16}>
            <ControlesBaseDados aba="itens" filtros={filtros} categorias={categorias} aoMudar={setFiltros} />
          </Column>
          <Column sm={4} md={8} lg={16} xlg={10}>
            <section className={s.achar} aria-label="Encontre o material">
              {itens.length === 0 ? (
                <EstadoVazio titulo="Nenhum item ainda." proximoPasso="Os itens aparecem aqui depois da primeira cotação." acao={{ texto: "Pedir na conversa", href: "/", tipo: "tertiary" }} />
              ) : lista.length === 0 ? (
                <EstadoVazio tamanho="sm" titulo="Nenhum item com essa busca ou categoria." proximoPasso="Confira a escrita, ou troque a categoria." acao={{ texto: "Limpar busca e categoria", aoClicar: limpar, tipo: "tertiary" }} />
              ) : (
                <DataTable rows={linhas} headers={COLUNAS} locale="pt-BR" isSortable size="lg">
                  {({ rows, headers, getHeaderProps, getTableProps, getRowProps }) => (
                    <TableContainer className={s.tabela}>
                      <Table {...getTableProps()} aria-label="Itens">
                        <TableHead>
                          <TableRow>
                            <th scope="col" className={s.colEscolha}>
                              <span className={s.somenteLeitor}>Escolher</span>
                            </th>
                            {headers.map((h) => {
                              const { key, ...props } = getHeaderProps({ header: h });
                              return (
                                <TableHeader key={key} {...props} translateWithId={traduzirOrdem} className={h.key === "descricao" ? undefined : s.soMaior}>
                                  {h.header}
                                </TableHeader>
                              );
                            })}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {rows.map((row) => {
                            const i = porChave.get(row.id);
                            if (!i) return null;
                            const { key, ...props } = getRowProps({ row });
                            const marcado = atual?.chave === i.chave;
                            const compra = i.compras[0];
                            const propostas = totalPropostas(i);
                            // O nome traz as especificações técnicas logo abaixo, para distinguir itens parecidos.
                            const espec = Object.values(i.especificacao).filter(Boolean).join(" · ");
                            return (
                              <TableRow key={key} {...props} className={marcado ? `${s.linha} ${s.linhaMarcada}` : s.linha} onClick={(e: MouseEvent) => clicarNaLinha(e, i.chave)}>
                                <TableSelectRow radio id={`item-${i.chave}`} name="item-da-base" checked={marcado} onSelect={() => escolher(i.chave)} aria-label={`Escolher ${i.descricao}`} />
                                <TableCell>
                                  <span className={s.duasLinhas}>
                                    <span className={s.nomeForte}>{i.descricao}</span>
                                    {espec ? <span className={s.apoio}>{espec}</span> : null}
                                    {i.codigo ? <span className={s.apoio}>{i.codigo}</span> : null}
                                    <span className={s.apoioCelular}>
                                      {[i.categoria, i.unidade, `${propostas} ${propostas === 1 ? "proposta" : "propostas"}`].filter(Boolean).join(" · ")}
                                    </span>
                                  </span>
                                </TableCell>
                                <TableCell className={s.soMaior}>{i.categoria ?? <span className={s.semValor}>—</span>}</TableCell>
                                <TableCell className={s.soMaior}>{i.unidade || "—"}</TableCell>
                                <TableCell className={s.soMaior}>
                                  <span className={propostas ? s.numero : `${s.numero} ${s.semValor}`}>{propostas}</span>
                                </TableCell>
                                <TableCell className={s.soMaior}>
                                  {compra ? (
                                    <span className={s.duasLinhas}>
                                      <span className={s.numero}>{brl(compra.precoUnitario)}</span>
                                      <span className={s.apoio}>{data(compra.data)}</span>
                                      {compra.simulado ? <SeloSimulado texto="histórico simulado" /> : null}
                                    </span>
                                  ) : (
                                    <span className={s.semValor}>—</span>
                                  )}
                                </TableCell>
                                <TableCell className={s.soMaior}>
                                  {i.referencia.mediana !== null ? (
                                    <span className={s.duasLinhas}>
                                      <span className={s.numero}>{brl(i.referencia.mediana)}</span>
                                      <span className={s.apoio}>
                                        mediana de {i.referencia.lojas} {i.referencia.lojas === 1 ? "loja" : "lojas"}
                                      </span>
                                    </span>
                                  ) : (
                                    <span className={s.semValor}>—</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      <p className={s.rodape}>
                        Mostrando {lista.length} de {itens.length} itens
                      </p>
                    </TableContainer>
                  )}
                </DataTable>
              )}
            </section>
          </Column>

          <Column sm={4} md={8} lg={16} xlg={6}>
            <div className={s.painel} ref={painel}>
              {atual ? (
                <Detalhe i={atual} />
              ) : (
                <Bloco titulo="Escolha o material" descricao="Marque um item na lista para ver a especificação, o que foi pago, a referência da internet e as cotações.">
                  <div className={s.acoes}>
                    <CarbonLink as={NextLink} href="/">
                      Pedir na conversa
                    </CarbonLink>
                  </div>
                </Bloco>
              )}
            </div>
          </Column>

          {atual ? (
            <Column sm={4} md={8} lg={16} xlg={10}>
              <QuemCotou i={atual} />
            </Column>
          ) : null}
        </GradePagina>
      </CorpoPagina>
    </Pagina>
  );
}
