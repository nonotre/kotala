"use client";
// Itens: o que já foi pedido, comprado ou cadastrado, com o preço pago e a referência da internet.

import {
  Column,
  DataTable,
  Link as CarbonLink,
  Search,
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
import { useMemo, useRef, useState, type MouseEvent } from "react";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { LinkExterno } from "@/components/LinkExterno";
import { CabecalhoPagina, CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { SeloSimulado } from "@/components/SeloSimulado";
import type { ItemDaBase } from "@/lib/dados-consulta";
import { brl, dataHora, quantidade } from "@/lib/formato";
import type { Kind } from "./marcas";
import s from "./consulta.module.scss";

const COLUNAS = [
  { key: "descricao", header: "Item" },
  { key: "unidade", header: "Unidade" },
  { key: "pedidos", header: "Pedidos" },
  { key: "compra", header: "Última compra" },
  { key: "referencia", header: "Referência pública" },
];

const ESTADO: Record<string, { kind: Kind; rotulo: string }> = {
  na_fila: { kind: "not-started", rotulo: "Na fila" },
  buscando: { kind: "in-progress", rotulo: "Captando fornecedores" },
  aguardando_recompra: { kind: "informative", rotulo: "Repetir compra?" },
  cotando: { kind: "in-progress", rotulo: "Cotando" },
  comparando: { kind: "pending", rotulo: "Montando o mapa" },
  aguardando_decisao: { kind: "informative", rotulo: "Aguardando sua decisão" },
  aprovado: { kind: "succeeded", rotulo: "Aprovado" },
  pedido_enviado: { kind: "succeeded", rotulo: "Pedido enviado" },
  confirmado: { kind: "succeeded", rotulo: "Confirmado" },
  sem_proposta: { kind: "caution-minor", rotulo: "Sem proposta válida" },
  cancelado: { kind: "normal", rotulo: "Cancelado" },
};

const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

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
          Não estava na base: o assistente cadastrou este item no{" "}
          <CarbonLink as={NextLink} href={`/pedidos/${i.cadastradoNoPedido}`} inline>
            pedido {i.cadastradoNoPedido}
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
                  {c.pedidoId ? ` · pedido ${c.pedidoId}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EstadoVazio compacto titulo="Nenhuma compra deste item ainda." />
        )}
      </section>

      <section className={s.parte} aria-label="Pedidos">
        <h3 className={s.subtitulo}>Pedidos</h3>
        {i.pedidos.length ? (
          <ul className={s.listaSimples}>
            {i.pedidos.map((p) => {
              const e = ESTADO[p.estado] ?? { kind: "normal" as Kind, rotulo: p.estado };
              return (
                <li key={p.itemId} className={s.duasLinhas}>
                  <CarbonLink as={NextLink} href={`/pedidos/${p.pedidoId}#item-${p.itemId}`}>
                    Pedido {p.pedidoId}: {quantidade(p.quantidade, p.unidade)}
                  </CarbonLink>
                  <IconIndicator kind={e.kind} label={`${e.rotulo} · ${dataHora(p.em)}`} size={16} />
                </li>
              );
            })}
          </ul>
        ) : (
          <EstadoVazio compacto titulo="Nenhum pedido deste item." />
        )}
      </section>

      <div className={s.acoes}>
        <CarbonLink as={NextLink} href="/chat">
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

export function BaseItens({ itens, itemInicial }: { itens: ItemDaBase[]; itemInicial: string | null }) {
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<string | null>(itemInicial);
  const painel = useRef<HTMLDivElement>(null);

  const buscaveis = useMemo(() => itens.map((i) => ({ i, texto: normalizar([i.descricao, i.codigo ?? "", i.chave, i.categoria ?? "", especificacaoEmTexto(i.especificacao)].join(" ")) })), [itens]);
  const termo = normalizar(busca);
  const lista = buscaveis.filter((x) => !termo || x.texto.includes(termo)).map((x) => x.i);
  const atual = lista.find((i) => i.chave === selecionado) ?? null;

  function escolher(chave: string) {
    setSelecionado(chave);
    window.history.replaceState(null, "", `/itens?item=${encodeURIComponent(chave)}`);
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
    unidade: i.unidade,
    pedidos: i.pedidos.length,
    compra: i.compras[0]?.precoUnitario ?? -1,
    referencia: i.referencia.mediana ?? -1,
  }));
  const porChave = new Map(lista.map((i) => [i.chave, i]));

  return (
    <Pagina>
      <CabecalhoPagina titulo="Itens" contexto="Os materiais que já foram pedidos, com o que foi pago e o preço de referência da internet. Itens que não estavam na base são cadastrados pelo assistente." />
      <CorpoPagina>
        <GradePagina className={s.grade}>
          <Column sm={4} md={8} lg={16} xlg={10}>
            <section className={s.achar} aria-label="Encontre o material">
              <Search size="lg" labelText="Buscar item" placeholder="Buscar por nome, código ou especificação" closeButtonLabelText="Limpar busca" value={busca} onChange={(e) => setBusca(e.target.value)} onClear={() => setBusca("")} />
              {itens.length === 0 ? (
                <EstadoVazio titulo="Nenhum item ainda." proximoPasso="Os itens aparecem aqui depois do primeiro pedido." acao={{ texto: "Pedir na conversa", href: "/chat", tipo: "tertiary" }} />
              ) : lista.length === 0 ? (
                <EstadoVazio tamanho="sm" titulo="Nenhum item com esse nome." proximoPasso="Confira a escrita, ou tente outro nome." acao={{ texto: "Limpar busca", aoClicar: () => setBusca(""), tipo: "tertiary" }} />
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
                            return (
                              <TableRow key={key} {...props} className={marcado ? `${s.linha} ${s.linhaMarcada}` : s.linha} onClick={(e: MouseEvent) => clicarNaLinha(e, i.chave)}>
                                <TableSelectRow radio id={`item-${i.chave}`} name="item-da-base" checked={marcado} onSelect={() => escolher(i.chave)} aria-label={`Escolher ${i.descricao}`} />
                                <TableCell>
                                  <span className={s.duasLinhas}>
                                    <span className={s.nomeForte}>{i.descricao}</span>
                                    {i.codigo ? <span className={s.apoio}>{i.codigo}</span> : null}
                                    <span className={s.apoioCelular}>
                                      {i.unidade} · {i.pedidos.length} {i.pedidos.length === 1 ? "pedido" : "pedidos"}
                                    </span>
                                  </span>
                                </TableCell>
                                <TableCell className={s.soMaior}>{i.unidade || "—"}</TableCell>
                                <TableCell className={s.soMaior}>
                                  <span className={s.numero}>{i.pedidos.length}</span>
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
                <Bloco titulo="Escolha o material" descricao="Marque um item na lista para ver a especificação, o que foi pago, a referência da internet e os pedidos.">
                  <div className={s.acoes}>
                    <CarbonLink as={NextLink} href="/chat">
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
