"use client";
// Dashboard de economia, no desenho da Ester (docs/workspaces/ester-workspace/interface-dashboard.md,
// com os ajustes de docs/workspaces/ester-workspace/dashboard.md): KPIs no topo, economia (pizza e curva),
// gastos e status, e a tabela por pedido.
// As contas de gasto e saving e a tabela só olham pedidos: requisições concluídas e compradas.
// O card de atraso e o gráfico de status olham as cotações, que são as requisições ainda abertas.
// Filtros fixos no topo (período e setor); um clique numa fatia ou barra de setor também filtra.

import { DismissibleTag, Link as CarbonLink, Search, Select, SelectItem, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tile } from "@carbon/react";
import dynamic from "next/dynamic";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type MouseEvent } from "react";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { CabecalhoPagina, CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { SeloSimulado } from "@/components/SeloSimulado";
import { Column } from "@/components/carbon";
import type { Dashboard, LinhaPedido, StatusRequisicao } from "@/lib/dados-dashboard";
import { brl } from "@/lib/formato";
import type { ContagemStatus } from "./Graficos";
import s from "./dashboard.module.scss";

const carregando = () => <div className={s.graficoCarregando} aria-hidden />;
const PizzaEconomia = dynamic(() => import("./Graficos").then((m) => m.PizzaEconomia), { ssr: false, loading: carregando });
const CurvaSaving = dynamic(() => import("./Graficos").then((m) => m.CurvaSaving), { ssr: false, loading: carregando });
const BarrasSetor = dynamic(() => import("./Graficos").then((m) => m.BarrasSetor), { ssr: false, loading: carregando });
const BarrasStatus = dynamic(() => import("./Graficos").then((m) => m.BarrasStatus), { ssr: false, loading: carregando });

// ---------- Filtros ----------

type Periodo = "tudo" | "30" | "90" | "365";
type Fatia = "Saving" | "Gasto" | null;

const PERIODOS: { valor: Periodo; texto: string }[] = [
  { valor: "tudo", texto: "Todo o período" },
  { valor: "30", texto: "Últimos 30 dias" },
  { valor: "90", texto: "Últimos 90 dias" },
  { valor: "365", texto: "Últimos 12 meses" },
];

const SEM_SETOR = "Sem setor";
const OUTROS = "Outros";
const MAX_SETORES = 5;
const TODAS = "todas";

type Filtros = { periodo: Periodo; setor: string; fatia: Fatia };
type Dimensao = keyof Filtros;

const setorDe = (p: LinhaPedido) => p.setor ?? SEM_SETOR;
const fechado = (p: LinhaPedido) => p.gasto !== null && p.inicial !== null && p.inicial > 0;
/** Pedido, no sentido da Ester: requisição concluída e efetivamente comprada. */
const pedidoConcluido = (p: LinhaPedido) => p.status === "concluida" && fechado(p);
const saving = (p: LinhaPedido) => (fechado(p) ? p.inicial! - p.gasto! : 0);
const savingPct = (p: LinhaPedido) => (saving(p) / p.inicial!) * 100;

/** Aplica os filtros, menos os da dimensão que o próprio gráfico mostra (para ele seguir dando escolha). */
function filtrar(pedidos: LinhaPedido[], f: Filtros, ignorar: Dimensao[] = []) {
  const desde = f.periodo === "tudo" ? null : Date.now() - Number(f.periodo) * 86_400_000;
  return pedidos.filter((p) => {
    if (!ignorar.includes("periodo") && desde !== null && new Date(p.criadoEm).getTime() < desde) return false;
    if (!ignorar.includes("setor") && f.setor !== "todos" && setorDe(p) !== f.setor) return false;
    if (!ignorar.includes("fatia")) {
      if (f.fatia === "Saving" && saving(p) < 0.01) return false;
      if (f.fatia === "Gasto" && p.gasto === null) return false;
    }
    return true;
  });
}

// ---------- Painel ----------

const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function PainelDashboard({ dados }: { dados: Dashboard }) {
  const router = useRouter();
  const [f, setF] = useState<Filtros>({ periodo: "tudo", setor: "todos", fatia: null });
  const mudar = (parcial: Partial<Filtros>) => setF((atual) => ({ ...atual, ...parcial }));

  const concluidos = useMemo(() => dados.pedidos.filter(pedidoConcluido), [dados.pedidos]);
  const setores = useMemo(() => [...new Set(dados.pedidos.map(setorDe))].sort((a, b) => (a === SEM_SETOR ? 1 : b === SEM_SETOR ? -1 : a.localeCompare(b, "pt-BR"))), [dados.pedidos]);
  const categorias = useMemo(() => [...new Set(concluidos.flatMap((p) => p.categorias))].sort((a, b) => a.localeCompare(b, "pt-BR")), [concluidos]);

  const visiveis = useMemo(() => filtrar(concluidos, f), [concluidos, f]);
  // Cotações: requisições não canceladas, nos filtros de período e setor (a fatia só vale para pedidos).
  const cotacoes = useMemo(() => filtrar(dados.pedidos, f, ["fatia"]).filter((p) => p.status !== "cancelada"), [dados.pedidos, f]);

  // KPIs
  const gastoTotal = visiveis.reduce((t, p) => t + p.gasto!, 0);
  const savingTotal = visiveis.reduce((t, p) => t + saving(p), 0);
  const savingMedio = visiveis.length ? visiveis.reduce((t, p) => t + savingPct(p), 0) / visiveis.length : null;
  const atrasadas = cotacoes.filter((p) => p.atrasado).length;
  const simulados = visiveis.filter((p) => p.simulado).length;

  // Pizza: tudo menos o filtro da própria fatia.
  const paraPizza = filtrar(concluidos, f, ["fatia"]);
  const pizza = { saving: paraPizza.reduce((t, p) => t + saving(p), 0), gasto: paraPizza.reduce((t, p) => t + p.gasto!, 0) };

  // Setores: os 5 maiores e o resto em "Outros".
  const porSetor = useMemo(() => {
    const somas = new Map<string, number>();
    for (const p of filtrar(concluidos, f, ["setor"])) somas.set(setorDe(p), (somas.get(setorDe(p)) ?? 0) + p.gasto!);
    const ordem = [...somas].map(([setor, gasto]) => ({ setor, gasto: Math.round(gasto * 100) / 100 })).sort((a, b) => b.gasto - a.gasto);
    if (ordem.length <= MAX_SETORES + 1) return ordem;
    const resto = ordem.slice(MAX_SETORES).reduce((t, l) => t + l.gasto, 0);
    return [...ordem.slice(0, MAX_SETORES), { setor: OUTROS, gasto: Math.round(resto * 100) / 100 }];
  }, [concluidos, f]);

  // Status: as três categorias, com o atraso separado dentro de cada barra aberta.
  const contagem = useMemo<ContagemStatus>(() => {
    const n = (st: StatusRequisicao, atraso: boolean) => cotacoes.filter((p) => p.status === st && p.atrasado === atraso).length;
    return {
      concluidas: cotacoes.filter((p) => p.status === "concluida").length,
      andamentoNoPrazo: n("andamento", false),
      andamentoAtraso: n("andamento", true),
      iniciarNoPrazo: n("iniciar", false),
      iniciarAtraso: n("iniciar", true),
    };
  }, [cotacoes]);
  const temStatus = Object.values(contagem).some((v) => v > 0);

  const filtrosAtivos = [
    f.periodo !== "tudo" ? { chave: "periodo" as const, texto: PERIODOS.find((p) => p.valor === f.periodo)!.texto, limpar: { periodo: "tudo" as const } } : null,
    f.setor !== "todos" ? { chave: "setor" as const, texto: `Setor: ${f.setor}`, limpar: { setor: "todos" } } : null,
    f.fatia ? { chave: "fatia" as const, texto: f.fatia === "Saving" ? "Só pedidos com saving" : "Só pedidos com compra", limpar: { fatia: null } } : null,
  ].filter((x) => x !== null);

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Dashboard"
        contexto="Quanto a empresa gastou nos pedidos concluídos, quanto teria gasto sem a negociação e como andam as cotações."
        lado={
          <div className={s.filtros}>
            <Select id="dash-periodo" labelText="Período" size="md" value={f.periodo} onChange={(e) => mudar({ periodo: e.target.value as Periodo })}>
              {PERIODOS.map((p) => (
                <SelectItem key={p.valor} value={p.valor} text={p.texto} />
              ))}
            </Select>
            <Select id="dash-setor" labelText="Setor" size="md" value={f.setor} onChange={(e) => mudar({ setor: e.target.value })}>
              <SelectItem value="todos" text="Todos os setores" />
              {setores.map((st) => (
                <SelectItem key={st} value={st} text={st} />
              ))}
            </Select>
          </div>
        }
      />
      <CorpoPagina>
        {filtrosAtivos.length ? (
          <div className={s.ativos} aria-label="Filtros ativos">
            {filtrosAtivos.map((a) => (
              <DismissibleTag key={a.chave} type="high-contrast" text={a.texto} dismissTooltipLabel="Tirar filtro" onClose={() => mudar(a.limpar)} />
            ))}
          </div>
        ) : null}

        {/* 1. KPIs */}
        <GradePagina>
          <Column sm={2} md={2} lg={4}>
            <Tile className={s.kpi}>
              <span className={s.kpiRotulo}>Pedidos emitidos</span>
              <strong className={s.kpiValor}>{visiveis.length}</strong>
              <span className={s.kpiNota}>Requisições concluídas, com a compra confirmada.</span>
            </Tile>
          </Column>
          <Column sm={2} md={2} lg={4}>
            <Tile className={s.kpi}>
              <span className={s.kpiRotulo}>Valor total gasto</span>
              <strong className={s.kpiValor}>{brl(gastoTotal)}</strong>
              <span className={s.kpiNota}>
                Nos {plural(visiveis.length, "pedido", "pedidos")}, com frete e impostos.{simulados ? ` ${simulados} com fornecedor simulado.` : ""}
              </span>
            </Tile>
          </Column>
          <Column sm={2} md={2} lg={4}>
            <Tile className={s.kpi}>
              <span className={s.kpiRotulo}>Saving total</span>
              <strong className={`${s.kpiValor} ${savingTotal >= 0.01 ? s.positivo : ""}`}>{brl(savingTotal)}</strong>
              <span className={s.kpiNota}>{savingMedio !== null ? `Saving médio de ${pct(savingMedio)} por pedido.` : "Nenhum pedido concluído ainda."}</span>
            </Tile>
          </Column>
          <Column sm={2} md={2} lg={4}>
            <Tile className={`${s.kpi} ${atrasadas ? s.kpiAlerta : ""}`}>
              <span className={s.kpiRotulo}>Cotações em atraso</span>
              <strong className={s.kpiValor}>{atrasadas}</strong>
              <span className={s.kpiNota}>Abertas além do prazo que o solicitante deu.</span>
            </Tile>
          </Column>
        </GradePagina>

        {/* 2. Economia */}
        <GradePagina>
          <Column sm={4} md={8} lg={8}>
            <Bloco titulo="Saving × gasto" descricao="O todo é o valor inicial, antes da negociação, somando os pedidos concluídos. Clique numa fatia para filtrar a tabela.">
              {paraPizza.length ? (
                <PizzaEconomia saving={pizza.saving} gasto={pizza.gasto} aoClicar={(g) => mudar({ fatia: f.fatia === g ? null : g })} />
              ) : (
                <EstadoVazio compacto titulo="Nenhum pedido concluído nestes filtros." />
              )}
            </Bloco>
          </Column>
          <Column sm={4} md={8} lg={8}>
            <Bloco
              titulo="Saving por pedido"
              descricao={
                visiveis.length < 10
                  ? `Distribuição da % de saving por pedido concluído. Com ${plural(visiveis.length, "pedido", "pedidos")}, olhe as barras: a curva ajustada com poucos dados pode enganar.`
                  : "Distribuição da % de saving por pedido concluído; as barras são os pedidos reais."
              }
            >
              {visiveis.length ? <CurvaSaving valores={visiveis.map(savingPct)} /> : <EstadoVazio compacto titulo="Nenhum pedido concluído nestes filtros." />}
            </Bloco>
          </Column>
        </GradePagina>

        {/* 3. Gastos e status */}
        <GradePagina>
          <Column sm={4} md={8} lg={8}>
            <Bloco titulo="Custo por setor" descricao={`Gasto dos pedidos concluídos, do maior para o menor${porSetor.some((l) => l.setor === OUTROS) ? `; depois dos ${MAX_SETORES} maiores, o resto fica em "Outros"` : ""}. Clique numa barra para filtrar.`}>
              {porSetor.length ? (
                <BarrasSetor linhas={porSetor} aoClicar={(setor) => setor !== OUTROS && mudar({ setor: f.setor === setor ? "todos" : setor })} />
              ) : (
                <EstadoVazio compacto titulo="Nenhum gasto nestes filtros." />
              )}
            </Bloco>
          </Column>
          <Column sm={4} md={8} lg={8}>
            <Bloco titulo="Status das cotações" descricao="Todas as requisições, abertas ou não, no período e setor escolhidos. Em vermelho, a parte em atraso de cada barra. Canceladas ficam de fora.">
              {temStatus ? <BarrasStatus contagem={contagem} /> : <EstadoVazio compacto titulo="Nenhuma requisição nestes filtros." />}
            </Bloco>
          </Column>
        </GradePagina>

        {/* 4. Tabela por pedido */}
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <BlocoPedidos pedidos={visiveis} categorias={categorias} abrir={(id) => router.push(`/pedidos/${id}`)} />
          </Column>
        </GradePagina>

        {/* O que ficou da antiga tela de economia */}
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco titulo="Trabalho feito pelo assistente" descricao="Em todo o período, sem os filtros acima." plano>
              <div className={s.cards}>
                <Tile className={s.kpi}>
                  <span className={s.kpiRotulo}>Pedidos de cotação enviados</span>
                  <strong className={s.kpiValor}>{dados.trabalho.cotacoes}</strong>
                  <span className={s.kpiNota}>Pedidos de preço mandados aos fornecedores.</span>
                </Tile>
                <Tile className={s.kpi}>
                  <span className={s.kpiRotulo}>Mensagens</span>
                  <strong className={s.kpiValor}>{dados.trabalho.mensagensEntrada + dados.trabalho.mensagensSaida}</strong>
                  <span className={s.kpiNota}>
                    {dados.trabalho.mensagensEntrada} recebidas, {dados.trabalho.mensagensSaida} enviadas.
                  </span>
                </Tile>
                <Tile className={s.kpi}>
                  <span className={s.kpiRotulo}>Chamadas de IA</span>
                  <strong className={s.kpiValor}>{dados.trabalho.chamadasIa}</strong>
                  <span className={s.kpiNota}>Leitura de propostas, conversa e decisões.</span>
                </Tile>
              </div>
            </Bloco>
          </Column>
        </GradePagina>
      </CorpoPagina>
    </Pagina>
  );
}

// ---------- Tabela ----------

/** Para a busca: sem acento e sem caixa. */
const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Bloco da tabela com os filtros dela: busca no pedido e categoria. Só valem para a tabela. */
function BlocoPedidos({ pedidos, categorias, abrir }: { pedidos: LinhaPedido[]; categorias: string[]; abrir: (id: number) => void }) {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState(TODAS);

  const termo = normalizar(busca);
  const linhas = pedidos.filter((p) => (categoria === TODAS || p.categorias.includes(categoria)) && (!termo || normalizar(`pedido ${p.id} ${p.setor ?? ""}`).includes(termo)));

  return (
    <Bloco
      titulo="Pedidos: mapa de cotação × compra"
      descricao="Só pedidos concluídos e comprados. Preço da compra contra a média das propostas válidas do mapa. Verde: abaixo da média. Clique numa linha para abrir o mapa completo."
      acao={
        <div className={s.ferramentas}>
          <Search id="dash-busca-pedido" labelText="Buscar pedido" placeholder="Buscar pedido ou setor" size="md" value={busca} onChange={(e) => setBusca(e.target.value)} onClear={() => setBusca("")} />
          <Select id="dash-categoria" labelText="Categoria" hideLabel size="md" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <SelectItem value={TODAS} text="Todas as categorias" />
            {categorias.map((c) => (
              <SelectItem key={c} value={c} text={c} />
            ))}
          </Select>
        </div>
      }
      plano
    >
      {!pedidos.length ? (
        <EstadoVazio compacto titulo="Nenhum pedido concluído nestes filtros." />
      ) : !linhas.length ? (
        <EstadoVazio compacto titulo="Nenhum pedido com essa busca ou categoria." />
      ) : (
        <TabelaPedidos pedidos={linhas} abrir={abrir} />
      )}
    </Bloco>
  );
}

function TabelaPedidos({ pedidos, abrir }: { pedidos: LinhaPedido[]; abrir: (id: number) => void }) {
  return (
    <div className={s.tabela}>
      <Table size="md" aria-label="Pedidos: mapa de cotação contra compra">
        <TableHead>
          <TableRow>
            <TableHeader>Pedido</TableHeader>
            <TableHeader>Categoria(s)</TableHeader>
            <TableHeader>Preço médio do mapa</TableHeader>
            <TableHeader>Preço da compra</TableHeader>
            <TableHeader>Diferença</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {pedidos.map((p) => {
            const dif = p.gasto !== null && p.mediaMapa !== null ? p.gasto - p.mediaMapa : null;
            return (
              <TableRow key={p.id} className={s.linhaClicavel} onClick={() => abrir(p.id)}>
                <TableCell>
                  <span className={s.pedido}>
                    <CarbonLink as={NextLink} href={`/pedidos/${p.id}`} onClick={(e: MouseEvent) => e.stopPropagation()}>
                      Pedido {p.id}
                    </CarbonLink>
                    {p.simulado ? <SeloSimulado /> : null}
                  </span>
                  {p.setor ? <span className={s.apoio}>{p.setor}</span> : null}
                </TableCell>
                <TableCell>{p.categorias.length ? p.categorias.join(", ") : <span className={s.apoio}>—</span>}</TableCell>
                <TableCell className={s.numero}>{brl(p.mediaMapa)}</TableCell>
                <TableCell className={s.numero}>{brl(p.gasto)}</TableCell>
                <TableCell className={`${s.numero} ${dif === null || Math.abs(dif) < 0.01 ? "" : dif < 0 ? s.positivo : s.negativo}`}>
                  {dif === null ? "—" : `${dif > 0 ? "+" : ""}${brl(dif)} (${dif > 0 ? "+" : ""}${pct((dif / p.mediaMapa!) * 100)})`}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
