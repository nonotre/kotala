"use client";
// Fornecedores: quem recebe cotação, quanto dá para confiar em cada um e o que já mandou ou vendeu.
// Tabela com busca, filtro e ordenação no notebook; linhas no celular.

import {
  Button,
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
import { QrCode } from "@carbon/react/icons";
import NextLink from "next/link";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AcoesFornecedor } from "@/components/AcoesFornecedor";
import { BarraAcao } from "@/components/BarraAcao";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { LinkExterno } from "@/components/LinkExterno";
import { CabecalhoPagina, CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { SeloSimulado } from "@/components/SeloSimulado";
import { useCelular } from "@/components/useCelular";
import type { LinhaFornecedor } from "@/lib/dados-consulta";
import { dataHora } from "@/lib/formato";
import { Canal, Confianca, canalEmTexto, estadoDoCanal, pesoConfianca, type EstadoCanal } from "./marcas";
import s from "./consulta.module.scss";

export type Filtro = "todos" | "com-canal" | "sem-canal" | "verificados" | "homologados" | "bloqueados";

type Linha = { f: LinhaFornecedor; canal: EstadoCanal; busca: string };

const FILTROS: { id: Filtro; rotulo: string; vazio: string; passo: string; passa: (l: Linha) => boolean }[] = [
  { id: "todos", rotulo: "Todos", vazio: "Nenhum fornecedor ainda.", passo: "Eles aparecem quando o assistente busca fornecedores para uma cotação, ou quando alguém entra pelo convite.", passa: () => true },
  { id: "com-canal", rotulo: "Com canal", vazio: "Nenhum fornecedor com canal ativo.", passo: "Quem entra pelo convite passa a receber as solicitações de proposta.", passa: (l) => l.canal.peso === 0 },
  { id: "sem-canal", rotulo: "Sem canal", vazio: "Todos têm canal.", passo: "Lojas achadas na internet aparecem aqui: são referência de preço e não são contatadas.", passa: (l) => l.canal.peso === 1 },
  { id: "verificados", rotulo: "Verificados", vazio: "Nenhum fornecedor verificado.", passo: "A verificação confere o CNPJ na Receita.", passa: (l) => l.f.verificado },
  { id: "homologados", rotulo: "Homologados", vazio: "Nenhum fornecedor homologado.", passo: "Homologar é a sua aprovação, feita aqui ou na ficha de cada um.", passa: (l) => l.f.homologado },
  { id: "bloqueados", rotulo: "Bloqueados", vazio: "Nenhum fornecedor bloqueado.", passo: "Bloqueado não entra nas buscas nem na recompra.", passa: (l) => !!l.f.bloqueadoEm },
];

const CABECALHOS: DataTableHeader[] = [
  { key: "nome", header: "Fornecedor" },
  { key: "confianca", header: "Confiança" },
  { key: "pesou", header: "O que pesou" },
  { key: "canal", header: "Canal" },
  { key: "propostas", header: "Propostas" },
  { key: "compras", header: "Compras" },
  { key: "acoes", header: "Empresa" },
];

const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

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

// ---------- Células ----------

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
      {f.homologado ? <span className={s.apoio}>Homologado</span> : null}
      {f.bloqueadoEm ? <span className={s.alerta}>Bloqueado: {f.motivoBloqueio}</span> : null}
      {f.fonte?.startsWith("http") ? <LinkExterno href={f.fonte}>{f.fonte.replace(/^https?:\/\//, "")}</LinkExterno> : null}
    </span>
  );
}

function CelulaConfianca({ f }: { f: LinhaFornecedor }) {
  return (
    <span className={s.duasLinhas}>
      <Confianca simulado={f.simulado} verificacao={f.verificacao} />
      {f.verificacao?.em && !f.simulado ? <span className={s.apoioRecuado}>{dataHora(f.verificacao.em)}</span> : null}
    </span>
  );
}

function Pesou({ f }: { f: LinhaFornecedor }) {
  if (f.simulado) return <span className={s.semValor}>Base fictícia do time</span>;
  const motivos = (f.verificacao?.motivos ?? []).slice(0, 4);
  return (
    <span className={s.duasLinhas}>
      {motivos.length ? <span className={s.texto}>{motivos.join("; ")}</span> : <span className={s.semValor}>—</span>}
      {f.verificacao?.alertas?.length ? <span className={s.alerta}>{f.verificacao.alertas.join("; ")}</span> : null}
    </span>
  );
}

// ---------- Vistas ----------

type PropsVista = {
  linhas: Linha[];
  total: number;
  filtro: Filtro;
  contagens: Record<Filtro, number>;
  aoFiltrar: (f: Filtro) => void;
  busca: string;
  aoBuscar: (t: string) => void;
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

function TabelaFornecedores({ linhas, total, filtro, contagens, aoFiltrar, busca, aoBuscar, vazio }: PropsVista) {
  // Os seis filtros só cabem ao lado da busca em telas bem largas: abaixo disso, viram seletor.
  const grande = usarLargura("(min-width: 99rem)");
  const porId = useMemo(() => new Map(linhas.map((l) => [l.f.id, l])), [linhas]);
  const dados = linhas.map((l) => ({
    id: l.f.id,
    nome: l.f.nome,
    confianca: pesoConfianca(l.f.simulado, l.f.verificacao),
    pesou: "",
    canal: l.canal.peso,
    propostas: l.f.propostas,
    compras: l.f.compras,
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
          <TableToolbar {...getToolbarProps()} aria-label="Filtrar e buscar fornecedores">
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
            <TableToolbarContent>
              <TableToolbarSearch defaultValue={busca} persistent labelText="Buscar fornecedor" placeholder="Buscar por nome, CNPJ, região ou canal" onChange={(_e, valor) => aoBuscar(valor ?? "")} onClear={() => aoBuscar("")} />
            </TableToolbarContent>
          </TableToolbar>
          {rows.length === 0 ? (
            <div className={s.semLinhas}>{vazio}</div>
          ) : (
            <div className={s.rolagem}>
              <Table {...getTableProps()} aria-label="Fornecedores">
                <TableHead>
                  <TableRow>
                    {headers.map((h) => {
                      const ordena = h.key !== "pesou" && h.key !== "acoes";
                      const { key, ...props } = getHeaderProps({ header: h, isSortable: ordena });
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
                          <Nome f={l.f} />
                        </TableCell>
                        <TableCell>
                          <CelulaConfianca f={l.f} />
                        </TableCell>
                        <TableCell>
                          <Pesou f={l.f} />
                        </TableCell>
                        <TableCell>
                          <Canal estado={l.canal} />
                        </TableCell>
                        <TableCell>
                          <span className={l.f.propostas ? s.numero : `${s.numero} ${s.semValor}`}>{l.f.propostas}</span>
                        </TableCell>
                        <TableCell>
                          <span className={l.f.compras ? s.numero : `${s.numero} ${s.semValor}`}>{l.f.compras}</span>
                        </TableCell>
                        <TableCell>
                          <AcoesFornecedor id={l.f.id} nome={l.f.nome} homologado={l.f.homologado} bloqueado={!!l.f.bloqueadoEm} />
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

function ListaCelular({ linhas, total, filtro, contagens, aoFiltrar, busca, aoBuscar, vazio }: PropsVista) {
  return (
    <div>
      <div className={s.celularBarra}>
        <Search defaultValue={busca} size="lg" labelText="Buscar fornecedor" placeholder="Buscar por nome, CNPJ, região ou canal" closeButtonLabelText="Limpar busca" onChange={(e) => aoBuscar(e.target.value)} onClear={() => aoBuscar("")} />
        <div className={s.celularFiltro}>
          <FiltroEmSeletor filtro={filtro} contagens={contagens} aoFiltrar={aoFiltrar} />
        </div>
      </div>
      {linhas.length ? (
        <ul className={s.celularLista}>
          {linhas.map((l) => (
            <li key={l.f.id} className={s.celularLinha}>
              <Nome f={l.f} />
              <Canal estado={l.canal} />
              <CelulaConfianca f={l.f} />
              <Pesou f={l.f} />
              <span className={s.apoio}>
                {l.f.propostas} {l.f.propostas === 1 ? "proposta" : "propostas"} · {l.f.compras} {l.f.compras === 1 ? "compra" : "compras"}
              </span>
              <AcoesFornecedor id={l.f.id} nome={l.f.nome} homologado={l.f.homologado} bloqueado={!!l.f.bloqueadoEm} />
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

export function ListaFornecedores({ fornecedores, filtroInicial }: { fornecedores: LinhaFornecedor[]; filtroInicial: Filtro }) {
  const celular = useCelular();
  const [filtro, setFiltro] = useState<Filtro>(filtroInicial);
  const [busca, setBusca] = useState("");

  const todas = useMemo(
    () =>
      fornecedores.map((f): Linha => ({
        f,
        canal: estadoDoCanal(f),
        busca: normalizar([f.nome, f.cnpj ?? "", f.regiao ?? "", f.verificacao?.razaoSocial ?? "", f.verificacao?.municipio ?? "", ...f.canais.map(canalEmTexto)].join(" ")),
      })),
    [fornecedores],
  );
  const contagens = useMemo(() => Object.fromEntries(FILTROS.map((x) => [x.id, todas.filter(x.passa).length])) as Record<Filtro, number>, [todas]);
  const dados = FILTROS.find((x) => x.id === filtro) ?? FILTROS[0]!;
  const termo = normalizar(busca);
  const linhas = todas.filter((l) => dados.passa(l) && (!termo || l.busca.includes(termo)));
  const recebem = contagens["com-canal"];
  const simulados = fornecedores.filter((f) => f.simulado).length;

  function aoFiltrar(f: Filtro) {
    setFiltro(f);
    // O filtro fica no endereço: quem abre uma ficha e volta encontra a lista como deixou.
    window.history.replaceState(null, "", f === "todos" ? "/fornecedores" : `/fornecedores?filtro=${f}`);
  }

  const vazio = (
    <EstadoVazio
      tamanho="sm"
      titulo={termo ? "Nenhum fornecedor com essa busca." : dados.vazio}
      proximoPasso={termo ? "Confira a escrita, ou veja a lista completa." : dados.passo}
      acao={filtro !== "todos" || termo ? { texto: "Ver todos", aoClicar: () => aoFiltrar("todos"), tipo: "tertiary" } : undefined}
    />
  );
  const props: PropsVista = { linhas, total: todas.length, filtro, contagens, aoFiltrar, busca, aoBuscar: setBusca, vazio };

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Fornecedores"
        contexto="A confiança de cada fornecedor real é conferida na Receita (CNPJ), nas listas de empresas punidas do Portal da Transparência (CEIS e CNEP), no TJSP, no site e no histórico de compras. Lojas achadas na internet entram como referência de preço e não são contatadas."
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
                <dt>Sem canal</dt>
                <dd>Loja achada na internet: entra como referência de preço e não é contatada.</dd>
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
