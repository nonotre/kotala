"use client";
// Lista de pedidos: tabela no notebook, linhas no celular. Quem espera o comprador vem primeiro.

import {
  Column,
  ContentSwitcher,
  DataTable,
  Link as CarbonLink,
  Search,
  Select,
  SelectItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  type DataTableHeader,
} from "@carbon/react";
import { ArrowRight, ChevronRight } from "@carbon/react/icons";
import NextLink from "next/link";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { CabecalhoPagina, CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { SeloIA } from "@/components/SeloIA";
import { SeloSimulado } from "@/components/SeloSimulado";
import type { Coluna } from "@/lib/dados";
import type { Grupo, LinhaPedido } from "@/lib/dados-operacao";
import { brl, dataHora, quantidade } from "@/lib/formato";
import { EtapaIndicador, Situacao, Urgencia, VistaPedidos } from "./Situacao";
import { ESTADO_PEDIDO, nomeDoCanal } from "./textos";
import s from "./lista-pedidos.module.scss";

export type Filtro = Grupo | "todos";

export const FILTROS: { id: Filtro; rotulo: string; vazio: string }[] = [
  { id: "todos", rotulo: "Todos", vazio: "Nenhum pedido por aqui." },
  { id: "voce", rotulo: "Esperam você", vazio: "Nada precisa de você agora." },
  { id: "andando", rotulo: "Em andamento", vazio: "Nenhum pedido em andamento." },
  { id: "concluidos", rotulo: "Concluídos", vazio: "Nenhum pedido concluído ainda." },
  { id: "cancelados", rotulo: "Cancelados", vazio: "Nenhum pedido cancelado." },
];

const COLUNAS: Coluna[] = ["Solicitado", "Cotando", "Comparando", "Decidido"];
const PESO_GRUPO: Record<Grupo, number> = { voce: 0, andando: 1, concluidos: 2, cancelados: 3 };

function normalizar(t: string): string {
  return t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function usarLargura(consulta: string): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const m = window.matchMedia(consulta);
      m.addEventListener("change", avisar);
      return () => m.removeEventListener("change", avisar);
    },
    () => window.matchMedia(consulta).matches,
    () => true,
  );
}

const resumir = (t: string) => (t.length > 90 ? `${t.slice(0, 90)}…` : t);

/** O item que dá nome à linha: o da vez, ou o primeiro. */
function nomeDoPedido(l: LinhaPedido): string {
  const i = l.itemDaVez ?? l.descricoes[0];
  return i ? `${quantidade(i.quantidade, i.unidade)} de ${i.descricao}` : resumir(l.texto);
}

function textoItens(n: number) {
  return n === 1 ? "1 item" : `${n} itens`;
}

/** Itens, obra, prazo, setor e urgência, numa linha só. */
function LinhaDeApoio({ l }: { l: LinhaPedido }) {
  const partes = [l.dono ?? "Sem dono", textoItens(l.itens), l.destino, l.prazoTexto, l.setor].filter(Boolean);
  return (
    <>
      {partes.join(" · ")}
      {l.urgencia !== "normal" ? (
        <>
          {" · "}
          <Urgencia urgencia={l.urgencia} />
        </>
      ) : null}
    </>
  );
}

function CelulaProposta({ l }: { l: LinhaPedido }) {
  const p = l.proposta;
  if (!p) return <span className={s.semValor}>—</span>;
  return (
    <span className={s.proposta}>
      <span className={s.propostaLinha}>
        <span className={s.custo}>{brl(p.custo)}</span>
        {p.rotulo === "Recomendada" ? (
          <SeloIA titulo="Por que esta proposta" tipo="inline" tamanho="mini" texto="Recomendada">
            Maior nota entre as {p.validas} propostas válidas do mapa de cotação. Quem decide é você.
          </SeloIA>
        ) : (
          <span className={s.apoio}>{p.rotulo}</span>
        )}
      </span>
      <span className={s.propostaLinha}>
        <span className={s.apoio}>{p.fornecedor}</span>
        {p.simulado ? <SeloSimulado /> : null}
      </span>
    </span>
  );
}

function Passo({ l, seta = true }: { l: LinhaPedido; seta?: boolean }) {
  return (
    <div className={s.colPasso}>
      <span className={l.acao ? s.passoVez : s.passo}>{l.passo}</span>
      {l.acao ? (
        <CarbonLink as={NextLink} href={l.acao.href} className={s.acao} renderIcon={seta ? ArrowRight : undefined} aria-label={`${l.acao.texto} do pedido ${l.id}`}>
          {l.acao.texto}
        </CarbonLink>
      ) : null}
    </div>
  );
}

function traduzirOrdem(_id: string, args?: { header?: ReactNode; isSortHeader?: boolean; sortDirection?: string }): string {
  const coluna = typeof args?.header === "string" ? args.header : "esta coluna";
  if (args?.isSortHeader && args.sortDirection === "ASC") return `Ordenar por ${coluna}, do maior para o menor`;
  if (args?.isSortHeader && args.sortDirection === "DESC") return "Voltar à ordem de quem espera você";
  return `Ordenar por ${coluna}, do menor para o maior`;
}

const CABECALHOS: DataTableHeader[] = [
  { key: "pedido", header: "Pedido" },
  { key: "item", header: "Pedido do comprador" },
  { key: "etapa", header: "Etapa e situação" },
  { key: "passo", header: "Próximo passo", isSortable: false },
  { key: "custo", header: "Custo total" },
  { key: "chegou", header: "Canal e data" },
];

type PropsVista = {
  linhas: LinhaPedido[];
  total: number;
  filtro: Filtro;
  contagens: Record<Filtro, number>;
  aoFiltrar: (f: Filtro) => void;
  chaveBusca: number;
  aoBuscar: (texto: string) => void;
  vazio: ReactNode;
};

function FiltroEmSeletor({ filtro, contagens, aoFiltrar }: Pick<PropsVista, "filtro" | "contagens" | "aoFiltrar">) {
  return (
    <Select id="pedidos-filtro" labelText="Mostrar" inline size="lg" className={s.seletor} value={filtro} onChange={(e) => aoFiltrar(e.target.value as Filtro)}>
      {FILTROS.map((f) => (
        <SelectItem key={f.id} value={f.id} text={`${f.rotulo} (${contagens[f.id]})`} />
      ))}
    </Select>
  );
}

function TabelaPedidos({ linhas, total, filtro, contagens, aoFiltrar, chaveBusca, aoBuscar, vazio }: PropsVista) {
  // Com o menu aberto, de lg a xlg, os filtros não cabem ao lado da busca: viram seletor.
  const grande = usarLargura("(min-width: 82rem)");
  const porId = useMemo(() => new Map(linhas.map((l) => [String(l.id), l])), [linhas]);
  const dados = linhas.map((l) => ({
    id: String(l.id),
    pedido: l.id,
    item: nomeDoPedido(l),
    etapa: COLUNAS.indexOf(l.coluna),
    passo: "",
    custo: l.proposta?.custo ?? null,
    chegou: l.criadoEm,
  }));
  return (
    <DataTable
      rows={dados}
      headers={CABECALHOS}
      isSortable
      locale="pt-BR"
      size="lg"
      sortRow={(a, b, { sortDirection, sortStates }) => {
        // Sem valor fica sempre no fim, nos dois sentidos.
        if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
        const conta = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "pt-BR", { numeric: true });
        return sortDirection === sortStates.ASC ? conta : -conta;
      }}
    >
      {({ rows, headers, getHeaderProps, getRowProps, getTableProps, getToolbarProps }) => (
        <TableContainer className={s.tabela}>
          <TableToolbar {...getToolbarProps()} aria-label="Filtrar e buscar pedidos">
            <div className={s.filtros}>
              {grande ? (
                <ContentSwitcher
                  size="lg"
                  lowContrast
                  selectedIndex={FILTROS.findIndex((f) => f.id === filtro)}
                  onChange={({ name }) => aoFiltrar(name as Filtro)}
                  aria-label="Filtrar pedidos"
                >
                  {FILTROS.map((f) => (
                    <Switch key={f.id} name={f.id} text={`${f.rotulo} (${contagens[f.id]})`} />
                  ))}
                </ContentSwitcher>
              ) : (
                <FiltroEmSeletor filtro={filtro} contagens={contagens} aoFiltrar={aoFiltrar} />
              )}
            </div>
            <TableToolbarContent>
              <TableToolbarSearch
                key={chaveBusca}
                persistent
                labelText="Buscar pedido"
                placeholder="Buscar pedido"
                onChange={(_e, valor) => aoBuscar(valor ?? "")}
                onClear={() => aoBuscar("")}
              />
            </TableToolbarContent>
          </TableToolbar>
          {rows.length === 0 ? (
            <div className={s.semLinhas}>{vazio}</div>
          ) : (
            <Table {...getTableProps()} aria-label="Pedidos">
              <TableHead>
                <TableRow>
                  {headers.map((h) => {
                    const { key, ...props } = getHeaderProps({ header: h });
                    return (
                      <TableHeader key={key} {...props} className={h.key === "pedido" ? s.colPedido : h.key === "custo" ? s.colCusto : undefined} translateWithId={traduzirOrdem}>
                        {h.header}
                      </TableHeader>
                    );
                  })}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => {
                  const l = porId.get(r.id);
                  if (!l) return null;
                  const { key, ...props } = getRowProps({ row: r });
                  return (
                    <TableRow key={key} {...props}>
                      <TableCell>
                        <CarbonLink as={NextLink} href={`/pedidos/${l.id}`} className={s.numero}>
                          Pedido {l.id}
                        </CarbonLink>
                      </TableCell>
                      <TableCell>
                        <span className={s.item}>
                          <span className={s.itemNome}>{nomeDoPedido(l)}</span>
                          <span className={s.apoio}>
                            <LinhaDeApoio l={l} />
                          </span>
                          <span className={s.mensagem}>{resumir(l.texto)}</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={s.situacao}>
                          <EtapaIndicador coluna={l.coluna} />
                          <span className={s.apoio}>{ESTADO_PEDIDO[l.estado]}</span>
                          <Situacao lista={l.etiquetas} />
                        </span>
                      </TableCell>
                      <TableCell>
                        <Passo l={l} />
                      </TableCell>
                      <TableCell>
                        <CelulaProposta l={l} />
                      </TableCell>
                      <TableCell>
                        <span className={s.item}>
                          <span>{nomeDoCanal(l.canal)}</span>
                          <span className={s.apoio}>{dataHora(l.criadoEm)}</span>
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <p className={s.rodape} aria-live="polite">
            Mostrando {rows.length} de {total}
          </p>
        </TableContainer>
      )}
    </DataTable>
  );
}

function ListaCelular({ linhas, total, filtro, contagens, aoFiltrar, chaveBusca, aoBuscar, vazio }: PropsVista) {
  return (
    <div className={s.celular}>
      <div className={s.celularBarra}>
        <Search
          key={chaveBusca}
          size="lg"
          labelText="Buscar pedido"
          placeholder="Buscar pedido"
          closeButtonLabelText="Limpar busca"
          onChange={(e) => aoBuscar(e.target.value)}
          onClear={() => aoBuscar("")}
        />
        <FiltroEmSeletor filtro={filtro} contagens={contagens} aoFiltrar={aoFiltrar} />
      </div>
      {linhas.length ? (
        <ul className={s.celularLista}>
          {linhas.map((l) => (
            <li key={l.id} className={s.celularItem}>
              <NextLink href={`/pedidos/${l.id}`} className={s.celularLinha}>
                <span className={s.celularTopo}>
                  <span className={s.celularNumero}>Pedido {l.id}</span>
                  <EtapaIndicador coluna={l.coluna} />
                  <ChevronRight size={16} className={s.celularSeta} aria-hidden="true" />
                </span>
                <span>
                  <span className={s.itemNome}>{nomeDoPedido(l)}</span>
                  <span className={s.apoio}>
                    <LinhaDeApoio l={l} />
                  </span>
                  <span className={s.mensagem}>{resumir(l.texto)}</span>
                </span>
                <span className={s.apoio}>
                  {ESTADO_PEDIDO[l.estado]} · {nomeDoCanal(l.canal)} · {dataHora(l.criadoEm)}
                </span>
                <Situacao lista={l.etiquetas} />
              </NextLink>
              {/* Fora do link: o selo da IA e a ação são controles próprios, e link não pode conter controle. */}
              <div className={s.celularPe}>
                <Passo l={l} seta={false} />
                {l.proposta ? <CelulaProposta l={l} /> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className={s.semLinhas}>{vazio}</div>
      )}
      <p className={s.rodape} aria-live="polite">
        Mostrando {linhas.length} de {total}
      </p>
    </div>
  );
}

function fraseDaVez(n: number): string {
  if (n === 0) return "Nada precisa de você agora.";
  return n === 1 ? "1 pedido espera você" : `${n} pedidos esperam você`;
}

/** Tudo o que a linha escreve: quem lê um texto na tabela e o digita precisa achar o pedido. */
function textoDeBusca(l: LinhaPedido): string {
  return normalizar(
    [
      `Pedido ${l.id}`,
      l.texto,
      ...l.descricoes.map((d) => `${quantidade(d.quantidade, d.unidade)} de ${d.descricao}`),
      l.destino ?? "",
      l.prazoTexto ?? "",
      l.setor ?? "",
      l.coluna,
      ESTADO_PEDIDO[l.estado] ?? "",
      ...l.etiquetas.map((e) => e.texto),
      l.passo,
      l.acao?.texto ?? "",
      l.proposta ? `${l.proposta.rotulo} ${l.proposta.fornecedor} ${brl(l.proposta.custo)}` : "",
      nomeDoCanal(l.canal),
      dataHora(l.criadoEm),
    ].join(" "),
  );
}

export function ListaPedidos({ linhas: todasBrutas, filtroInicial }: { linhas: LinhaPedido[]; filtroInicial: Filtro }) {
  const [filtro, setFiltro] = useState<Filtro>(filtroInicial);
  const pedeTabela = usarLargura("(min-width: 66rem)");
  const [busca, setBusca] = useState("");
  const [chaveBusca, setChaveBusca] = useState(0);

  const todas = useMemo(
    () => [...todasBrutas].sort((a, b) => PESO_GRUPO[a.grupo] - PESO_GRUPO[b.grupo] || b.id - a.id).map((l) => ({ l, busca: textoDeBusca(l) })),
    [todasBrutas],
  );
  const contagens = useMemo(() => {
    const c: Record<Filtro, number> = { todos: todas.length, voce: 0, andando: 0, concluidos: 0, cancelados: 0 };
    for (const { l } of todas) c[l.grupo] += 1;
    return c;
  }, [todas]);

  const termo = normalizar(busca);
  const linhas = todas.filter(({ l, busca: b }) => (filtro === "todos" || l.grupo === filtro) && (!termo || b.includes(termo))).map(({ l }) => l);

  function aoFiltrar(f: Filtro) {
    setFiltro(f);
    // O filtro vai para o endereço, sem criar um passo a mais no histórico: quem abre um pedido e volta encontra a lista como deixou.
    window.history.replaceState(null, "", f === "todos" ? "/pedidos" : `/pedidos?filtro=${f}`);
  }

  function verTodos() {
    aoFiltrar("todos");
    setBusca("");
    setChaveBusca((n) => n + 1);
  }

  const textoVazio = termo ? "Nenhum pedido com essa busca." : (FILTROS.find((f) => f.id === filtro)?.vazio ?? "");
  const vazio = <EstadoVazio compacto titulo={textoVazio} acao={{ texto: "Ver todos", aoClicar: verTodos }} />;
  const props: PropsVista = { linhas, total: todas.length, filtro, contagens, aoFiltrar, chaveBusca, aoBuscar: setBusca, vazio };

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Pedidos"
        contexto="Cada mensagem de compra vira um pedido; um pedido pode ter vários itens, cotados um por vez."
        lado={<VistaPedidos atual="lista" />}
      />
      <CorpoPagina>
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            {todas.length === 0 ? (
              <EstadoVazio
                titulo="Nenhum pedido ainda."
                proximoPasso="Mande um pedido pelo Telegram ou pela aba Conversar."
                acao={{ texto: "Conversar", href: "/chat" }}
              />
            ) : (
              <Bloco
                titulo={fraseDaVez(contagens.voce)}
                descricao={!pedeTabela ? undefined : contagens.voce > 0 ? "Quem espera você vem primeiro." : "O assistente avisa quando precisar de você."}
                plano
              >
                {pedeTabela ? <TabelaPedidos {...props} /> : <ListaCelular {...props} />}
              </Bloco>
            )}
          </Column>
        </GradePagina>
      </CorpoPagina>
    </Pagina>
  );
}
