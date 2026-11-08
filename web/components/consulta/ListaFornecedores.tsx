"use client";
// Base de Dados, aba Fornecedores: quem recebe cotação, quanto dá para confiar em cada um e o que já mandou ou vendeu.
// Tabela com filtro e ordenação no notebook; linhas no celular. A busca e a categoria vêm da casca comum.

import {
  Button,
  Column,
  ContentSwitcher,
  DataTable,
  Link as CarbonLink,
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
  preview__IconIndicator as IconIndicator,
  type DataTableHeader,
} from "@carbon/react";
import { QrCode } from "@carbon/react/icons";
import NextLink from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AcoesFornecedor } from "@/components/AcoesFornecedor";
import { BarraAcao } from "@/components/BarraAcao";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { SeloSimulado } from "@/components/SeloSimulado";
import { useCelular } from "@/components/useCelular";
import type { LinhaFornecedor } from "@/lib/dados-consulta";
import { dataHora } from "@/lib/formato";
import { CabecalhoBaseDados, ControlesBaseDados, enderecoDaBase, mesmaCategoria, normalizar, type FiltrosBase } from "./CascaBaseDados";
import { Canal, Confianca, PESO_CANAL, canalEmTexto, estadoDoCanal, pesoConfianca, type EstadoCanal } from "./marcas";
import s from "./consulta.module.scss";

export type Filtro = "todos" | "com-canal" | "sem-canal" | "verificados" | "homologados" | "bloqueados";

type Linha = { f: LinhaFornecedor; canal: EstadoCanal; busca: string };

/** Sem conversa aberta: só e-mail para o convite, só o site, ou nenhum contato. */
const semConversa = (l: Linha) => l.canal.peso === PESO_CANAL.email || l.canal.peso === PESO_CANAL.site || l.canal.peso === PESO_CANAL.nenhum;

const FILTROS: { id: Filtro; rotulo: string; vazio: string; passo: string; passa: (l: Linha) => boolean }[] = [
  { id: "todos", rotulo: "Todos", vazio: "Nenhum fornecedor ainda.", passo: "Eles aparecem quando o assistente busca fornecedores para uma cotação, ou quando alguém entra pelo convite.", passa: () => true },
  { id: "com-canal", rotulo: "Com canal", vazio: "Nenhum fornecedor com canal ativo.", passo: "Quem entra pelo convite passa a receber as solicitações de proposta.", passa: (l) => l.canal.peso === PESO_CANAL.ativo },
  { id: "sem-canal", rotulo: "Sem canal ativo", vazio: "Todos têm canal ativo.", passo: "Aqui ficam quem só tem e-mail para o convite, lojas com site próprio e quem não tem contato: são referência de preço e não recebem solicitação de proposta.", passa: semConversa },
  { id: "verificados", rotulo: "Verificados", vazio: "Nenhum fornecedor verificado.", passo: "A verificação confere o CNPJ na Receita.", passa: (l) => l.f.verificado },
  { id: "homologados", rotulo: "Homologados", vazio: "Nenhum fornecedor homologado.", passo: "Homologar é a sua aprovação, feita aqui ou na ficha de cada um.", passa: (l) => l.f.homologado },
  { id: "bloqueados", rotulo: "Bloqueados", vazio: "Nenhum fornecedor bloqueado.", passo: "Bloqueado não entra nas buscas nem na recompra.", passa: (l) => !!l.f.bloqueadoEm },
];

const CABECALHOS: DataTableHeader[] = [
  { key: "numero", header: "ID" },
  { key: "nome", header: "Fornecedor" },
  { key: "categoria", header: "Categoria" },
  { key: "homologacao", header: "Homologação" },
  { key: "criterios", header: "Critérios relevantes" },
  { key: "confianca", header: "Confiança" },
  { key: "canal", header: "Canal" },
  { key: "propostas", header: "Propostas" },
  { key: "pedidos", header: "Pedidos" },
  { key: "acoes", header: "Ação" },
];

const SEM_ORDEM = new Set(["criterios", "acoes"]);

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

function traduzirOrdem(_id: string, args?: { header?: ReactNode; isSortHeader?: boolean; sortDirection?: string }): string {
  const coluna = typeof args?.header === "string" ? args.header : "esta coluna";
  if (args?.isSortHeader && args.sortDirection === "ASC") return `Ordenar por ${coluna}, do maior para o menor`;
  if (args?.isSortHeader && args.sortDirection === "DESC") return "Voltar à ordem inicial";
  return `Ordenar por ${coluna}, do menor para o maior`;
}

const categoriasEmTexto = (f: LinhaFornecedor) => f.categorias.join(", ");

// ---------- Células ----------

/** Nome com link para a ficha. Sem link externo: loja da internet aparece pelo nome da plataforma. */
function Nome({ f }: { f: LinhaFornecedor }) {
  return (
    <span className={s.duasLinhas}>
      <span className={s.nomeSelo}>
        <CarbonLink as={NextLink} href={`/fornecedores/${f.id}`}>
          {f.nome}
        </CarbonLink>
        {f.simulado ? <SeloSimulado /> : null}
      </span>
      {f.cnpj ? <span className={s.apoio}>CNPJ {f.cnpj}</span> : null}
      {f.bloqueadoEm ? <span className={s.alerta}>Bloqueado: {f.motivoBloqueio}</span> : null}
    </span>
  );
}

function Categoria({ f }: { f: LinhaFornecedor }) {
  return f.categorias.length ? <span className={s.texto}>{categoriasEmTexto(f)}</span> : <span className={s.semValor}>Não informou</span>;
}

function Homologacao({ f }: { f: LinhaFornecedor }) {
  return f.homologado ? <IconIndicator kind="succeeded" label="Homologado" size={16} /> : <IconIndicator kind="not-started" label="Não homologado" size={16} />;
}

function CelulaConfianca({ f }: { f: LinhaFornecedor }) {
  return (
    <span className={s.duasLinhas}>
      <Confianca simulado={f.simulado} verificacao={f.verificacao} />
      {f.verificacao?.em && !f.simulado ? <span className={s.apoioRecuado}>{dataHora(f.verificacao.em)}</span> : null}
    </span>
  );
}

/** Antes "O que pesou": os motivos da verificação cadastral que embasam a confiança. */
function Criterios({ f }: { f: LinhaFornecedor }) {
  if (f.simulado) return <span className={s.semValor}>Base fictícia do time</span>;
  const motivos = (f.verificacao?.motivos ?? []).slice(0, 4);
  return (
    <span className={s.duasLinhas}>
      {motivos.length ? <span className={s.texto}>{motivos.join("; ")}</span> : <span className={s.semValor}>—</span>}
      {f.verificacao?.alertas?.length ? <span className={s.alerta}>{f.verificacao.alertas.join("; ")}</span> : null}
    </span>
  );
}

/** Abrir a ficha completa e, ali mesmo, homologar ou bloquear. */
function Acao({ f }: { f: LinhaFornecedor }) {
  return (
    <span className={s.duasLinhas}>
      <CarbonLink as={NextLink} href={`/fornecedores/${f.id}`} size="sm">
        Abrir ficha
      </CarbonLink>
      <AcoesFornecedor id={f.id} nome={f.nome} homologado={f.homologado} bloqueado={!!f.bloqueadoEm} />
    </span>
  );
}

const Numero = ({ n }: { n: number }) => <span className={n ? s.numero : `${s.numero} ${s.semValor}`}>{n}</span>;

// ---------- Vistas ----------

type PropsVista = {
  linhas: Linha[];
  total: number;
  filtro: Filtro;
  contagens: Record<Filtro, number>;
  aoFiltrar: (f: Filtro) => void;
  vazio: ReactNode;
};

function FiltroEmSeletor({ filtro, contagens, aoFiltrar }: Pick<PropsVista, "filtro" | "contagens" | "aoFiltrar">) {
  return (
    <Select id="fornecedores-filtro" labelText="Mostrar" inline size="lg" className={s.seletor} value={filtro} onChange={(e) => aoFiltrar(e.target.value as Filtro)}>
      {FILTROS.map((x) => (
        <SelectItem key={x.id} value={x.id} text={`${x.rotulo} (${contagens[x.id]})`} />
      ))}
    </Select>
  );
}

function TabelaFornecedores({ linhas, total, filtro, contagens, aoFiltrar, vazio }: PropsVista) {
  // Os seis filtros só cabem lado a lado em telas largas: abaixo disso, viram seletor.
  const grande = usarLargura("(min-width: 82rem)");
  const porId = useMemo(() => new Map(linhas.map((l) => [l.f.id, l])), [linhas]);
  const dados = linhas.map((l) => ({
    id: l.f.id,
    numero: l.f.numero,
    nome: l.f.nome,
    // Quem não informou a categoria vai para o fim, em ordem crescente.
    categoria: categoriasEmTexto(l.f) || "￿",
    homologacao: l.f.homologado ? 0 : 1,
    criterios: "",
    confianca: pesoConfianca(l.f.simulado, l.f.verificacao),
    canal: l.canal.peso,
    propostas: l.f.propostas,
    pedidos: l.f.compras,
    acoes: "",
  }));
  return (
    <DataTable
      rows={dados}
      headers={CABECALHOS}
      isSortable
      locale="pt-BR"
      size="lg"
      sortRow={(a, b, { sortDirection, sortStates }) => {
        const conta = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "pt-BR", { numeric: true });
        return sortDirection === sortStates.ASC ? conta : -conta;
      }}
    >
      {({ rows, headers, getHeaderProps, getRowProps, getTableProps, getToolbarProps }) => (
        <TableContainer className={s.tabela}>
          <TableToolbar {...getToolbarProps()} aria-label="Filtrar fornecedores">
            <div className={s.filtros}>
              {grande ? (
                <ContentSwitcher size="lg" lowContrast selectedIndex={FILTROS.findIndex((x) => x.id === filtro)} onChange={({ name }) => aoFiltrar(name as Filtro)}>
                  {FILTROS.map((x) => (
                    <Switch key={x.id} name={x.id} text={`${x.rotulo} (${contagens[x.id]})`} />
                  ))}
                </ContentSwitcher>
              ) : (
                <FiltroEmSeletor filtro={filtro} contagens={contagens} aoFiltrar={aoFiltrar} />
              )}
            </div>
          </TableToolbar>
          {rows.length === 0 ? (
            <div className={s.semLinhas}>{vazio}</div>
          ) : (
            <div className={`${s.rolagem} ${s.rolagemLarga}`}>
              <Table {...getTableProps()} aria-label="Fornecedores">
                <TableHead>
                  <TableRow>
                    {headers.map((h) => {
                      const { key, ...props } = getHeaderProps({ header: h, isSortable: !SEM_ORDEM.has(h.key) });
                      return (
                        <TableHeader key={key} {...props} translateWithId={traduzirOrdem}>
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
                          <span className={s.numero}>#{l.f.numero}</span>
                        </TableCell>
                        <TableCell>
                          <Nome f={l.f} />
                        </TableCell>
                        <TableCell>
                          <Categoria f={l.f} />
                        </TableCell>
                        <TableCell>
                          <Homologacao f={l.f} />
                        </TableCell>
                        <TableCell className={s.colCriterios}>
                          <Criterios f={l.f} />
                        </TableCell>
                        <TableCell>
                          <CelulaConfianca f={l.f} />
                        </TableCell>
                        <TableCell>
                          <Canal estado={l.canal} />
                        </TableCell>
                        <TableCell>
                          <Numero n={l.f.propostas} />
                        </TableCell>
                        <TableCell>
                          <Numero n={l.f.compras} />
                        </TableCell>
                        <TableCell className={s.colAcao}>
                          <Acao f={l.f} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className={s.rodape} aria-live="polite">
            Mostrando {rows.length} de {total}
          </p>
        </TableContainer>
      )}
    </DataTable>
  );
}

function ListaCelular({ linhas, total, filtro, contagens, aoFiltrar, vazio }: PropsVista) {
  return (
    <div>
      <div className={s.celularBarra}>
        <div className={s.celularFiltro}>
          <FiltroEmSeletor filtro={filtro} contagens={contagens} aoFiltrar={aoFiltrar} />
        </div>
      </div>
      {linhas.length ? (
        <ul className={s.celularLista}>
          {linhas.map((l) => (
            <li key={l.f.id} className={s.celularLinha}>
              <span className={s.apoio}>
                #{l.f.numero}
                {l.f.categorias.length ? ` · ${categoriasEmTexto(l.f)}` : ""}
              </span>
              <Nome f={l.f} />
              <Homologacao f={l.f} />
              <Canal estado={l.canal} />
              <CelulaConfianca f={l.f} />
              <Criterios f={l.f} />
              <span className={s.apoio}>
                {l.f.propostas} {l.f.propostas === 1 ? "proposta" : "propostas"} · {l.f.compras} {l.f.compras === 1 ? "pedido" : "pedidos"}
              </span>
              <Acao f={l.f} />
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

// ---------- Tela ----------

type Props = { fornecedores: LinhaFornecedor[]; categorias: string[]; filtroInicial: Filtro; filtrosIniciais: FiltrosBase };

export function ListaFornecedores({ fornecedores, categorias, filtroInicial, filtrosIniciais }: Props) {
  const celular = useCelular();
  const [filtro, setFiltro] = useState<Filtro>(filtroInicial);
  const [filtros, setFiltros] = useState<FiltrosBase>(filtrosIniciais);

  // Filtro, busca e categoria ficam no endereço: quem abre uma ficha e volta encontra a lista como deixou.
  useEffect(() => {
    window.history.replaceState(null, "", enderecoDaBase("fornecedores", filtros, { filtro: filtro === "todos" ? null : filtro }));
  }, [filtro, filtros]);

  const todas = useMemo(
    () =>
      fornecedores.map((f): Linha => ({
        f,
        canal: estadoDoCanal(f),
        busca: normalizar(
          [`#${f.numero}`, f.nome, f.cnpj ?? "", f.regiao ?? "", f.verificacao?.razaoSocial ?? "", f.verificacao?.municipio ?? "", ...f.categorias, ...f.canais.map(canalEmTexto)].join(" "),
        ),
      })),
    [fornecedores],
  );
  // A categoria vale antes do filtro: as contagens dos filtros já respeitam a categoria escolhida.
  const naCategoria = filtros.categoria ? todas.filter((l) => l.f.categorias.some((c) => mesmaCategoria(c, filtros.categoria))) : todas;
  const contagens = Object.fromEntries(FILTROS.map((x) => [x.id, naCategoria.filter(x.passa).length])) as Record<Filtro, number>;
  const dados = FILTROS.find((x) => x.id === filtro) ?? FILTROS[0]!;
  const termo = normalizar(filtros.busca);
  const linhas = naCategoria.filter((l) => dados.passa(l) && (!termo || l.busca.includes(termo)));
  const recebem = todas.filter((l) => l.canal.peso === PESO_CANAL.ativo).length;
  const simulados = fornecedores.filter((f) => f.simulado).length;

  const algumFiltro = filtro !== "todos" || !!termo || !!filtros.categoria;
  const vazio = (
    <EstadoVazio
      tamanho="sm"
      titulo={termo || filtros.categoria ? "Nenhum fornecedor com essa busca ou categoria." : dados.vazio}
      proximoPasso={termo || filtros.categoria ? "Confira a escrita, troque a categoria, ou veja a lista completa." : dados.passo}
      acao={
        algumFiltro
          ? {
              texto: "Ver todos",
              aoClicar: () => {
                setFiltro("todos");
                setFiltros({ busca: "", categoria: "" });
              },
              tipo: "tertiary",
            }
          : undefined
      }
    />
  );
  const props: PropsVista = { linhas, total: naCategoria.length, filtro, contagens, aoFiltrar: setFiltro, vazio };

  return (
    <Pagina>
      <CabecalhoBaseDados
        ativa="fornecedores"
        filtros={filtros}
        lado={
          <span className={s.acaoTopo}>
            <Button as={NextLink} href="/convite" size="md" renderIcon={QrCode}>
              Convidar fornecedor
            </Button>
          </span>
        }
      />
      <CorpoPagina>
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <ControlesBaseDados aba="fornecedores" filtros={filtros} categorias={categorias} aoMudar={setFiltros} />
            <div className={s.lista}>
              <Bloco
                plano
                titulo={`${recebem} de ${todas.length} ${todas.length === 1 ? "fornecedor recebe" : "fornecedores recebem"} as suas solicitações de proposta`}
                descricao={
                  simulados ? (
                    <>
                      {simulados} de {todas.length} são da base fictícia do time. <SeloSimulado texto="simulados" />
                    </>
                  ) : undefined
                }
              >
                {celular ? <ListaCelular {...props} /> : <TabelaFornecedores {...props} />}
              </Bloco>
            </div>
          </Column>
        </GradePagina>
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <dl className={s.glossario}>
              <div>
                <dt>Confiança</dt>
                <dd>Pontos do que foi conferido: CNPJ na Receita, atividade, idade da empresa, sanções, TJSP, site e histórico de compras. Não se aplica a fornecedor simulado.</dd>
              </div>
              <div>
                <dt>Critérios relevantes</dt>
                <dd>Os motivos da verificação cadastral que sustentam a confiança: CNPJ ativo, atividade, idade da empresa, sanções.</dd>
              </div>
              <div>
                <dt>Site próprio</dt>
                <dd>Loja achada na internet, sem conversa aberta: entra como referência de preço e não é contatada.</dd>
              </div>
              <div>
                <dt>Sem canal</dt>
                <dd>Nenhuma forma de contato conhecida: nem conversa, nem e-mail, nem site.</dd>
              </div>
              <div>
                <dt>Homologado</dt>
                <dd>É a sua aprovação formal. Verificar só confere se a empresa existe; uma coisa não substitui a outra.</dd>
              </div>
              <div>
                <dt>Bloqueado</dt>
                <dd>Deixa de entrar nas buscas e na recompra. As solicitações de proposta em andamento continuam.</dd>
              </div>
            </dl>
          </Column>
        </GradePagina>
      </CorpoPagina>
      <BarraAcao>
        <Button as={NextLink} href="/convite" size="lg" renderIcon={QrCode}>
          Convidar fornecedor
        </Button>
      </BarraAcao>
    </Pagina>
  );
}
