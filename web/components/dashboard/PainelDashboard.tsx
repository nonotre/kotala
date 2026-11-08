"use client";
// Dashboard de economia, no desenho da Ester (docs/workspaces/ester-workspace/interface-dashboard.md):
// KPIs no topo, economia (pizza e curva), gastos e status, e a tabela por pedido.
// Filtros fixos no topo; um clique numa fatia ou barra também filtra.

import { DismissibleTag, Link as CarbonLink, Select, SelectItem, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag, Tile } from "@carbon/react";
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
import type { CliqueStatus, ContagemStatus } from "./Graficos";
import s from "./dashboard.module.scss";

const carregando = () => <div className={s.graficoCarregando} aria-hidden />;
const PizzaEconomia = dynamic(() => import("./Graficos").then((m) => m.PizzaEconomia), { ssr: false, loading: carregando });
const CurvaSaving = dynamic(() => import("./Graficos").then((m) => m.CurvaSaving), { ssr: false, loading: carregando });
const BarrasSetor = dynamic(() => import("./Graficos").then((m) => m.BarrasSetor), { ssr: false, loading: carregando });
const BarrasStatus = dynamic(() => import("./Graficos").then((m) => m.BarrasStatus), { ssr: false, loading: carregando });

// ---------- Filtros ----------

type Periodo = "tudo" | "30" | "90" | "365";
type FiltroStatus = "todas" | StatusRequisicao | "atraso";
type Fatia = "Saving" | "Gasto" | null;

const PERIODOS: { valor: Periodo; texto: string }[] = [
  { valor: "tudo", texto: "Todo o período" },
  { valor: "30", texto: "Últimos 30 dias" },
  { valor: "90", texto: "Últimos 90 dias" },
  { valor: "365", texto: "Últimos 12 meses" },
];

const STATUS: { valor: FiltroStatus; texto: string }[] = [
  { valor: "todas", texto: "Todas, menos canceladas" },
  { valor: "concluida", texto: "Concluídas" },
  { valor: "andamento", texto: "Em andamento" },
  { valor: "iniciar", texto: "A iniciar" },
  { valor: "atraso", texto: "Em atraso" },
  { valor: "cancelada", texto: "Canceladas" },
];

const SEM_SETOR = "Sem setor";
const OUTROS = "Outros";
const MAX_SETORES = 5;

const SEM_COMPRADOR = "Sem responsável";

type Filtros = { periodo: Periodo; setor: string; comprador: string; status: FiltroStatus; fatia: Fatia };
type Dimensao = keyof Filtros;

const setorDe = (p: LinhaPedido) => p.setor ?? SEM_SETOR;
const compradorDe = (p: LinhaPedido) => p.comprador ?? SEM_COMPRADOR;
const fechado = (p: LinhaPedido) => p.gasto !== null && p.inicial !== null && p.inicial > 0;
const saving = (p: LinhaPedido) => (fechado(p) ? p.inicial! - p.gasto! : 0);
const savingPct = (p: LinhaPedido) => (saving(p) / p.inicial!) * 100;

/** Aplica os filtros, menos os da dimensão que o próprio gráfico mostra (para ele seguir dando escolha). */
function filtrar(pedidos: LinhaPedido[], f: Filtros, ignorar: Dimensao[] = []) {
  const desde = f.periodo === "tudo" ? null : Date.now() - Number(f.periodo) * 86_400_000;
  return pedidos.filter((p) => {
    if (!ignorar.includes("periodo") && desde !== null && new Date(p.criadoEm).getTime() < desde) return false;
    if (!ignorar.includes("setor") && f.setor !== "todos" && setorDe(p) !== f.setor) return false;
    if (!ignorar.includes("comprador") && f.comprador !== "todos" && compradorDe(p) !== f.comprador) return false;
    if (!ignorar.includes("status")) {
      if (f.status === "todas" && p.status === "cancelada") return false;
      if (f.status === "atraso" && !p.atrasado) return false;
      if (f.status !== "todas" && f.status !== "atraso" && p.status !== f.status) return false;
    }
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
  const [f, setF] = useState<Filtros>({ periodo: "tudo", setor: "todos", comprador: "todos", status: "todas", fatia: null });
  const mudar = (parcial: Partial<Filtros>) => setF((atual) => ({ ...atual, ...parcial }));

  const setores = useMemo(() => [...new Set(dados.pedidos.map(setorDe))].sort((a, b) => (a === SEM_SETOR ? 1 : b === SEM_SETOR ? -1 : a.localeCompare(b, "pt-BR"))), [dados.pedidos]);
  const compradores = useMemo(
    () => [...new Set(dados.pedidos.map(compradorDe))].sort((a, b) => (a === SEM_COMPRADOR ? 1 : b === SEM_COMPRADOR ? -1 : a.localeCompare(b, "pt-BR"))),
    [dados.pedidos],
  );

  // Por comprador: tudo menos o filtro do próprio comprador, para a tabela seguir dando escolha.
  const porComprador = useMemo<LinhaComprador[]>(() => {
    const grupos = new Map<string, LinhaPedido[]>();
    for (const p of filtrar(dados.pedidos, f, ["comprador"])) grupos.set(compradorDe(p), [...(grupos.get(compradorDe(p)) ?? []), p]);
    return [...grupos]
      .map(([comprador, ps]) => {
        const fs = ps.filter(fechado);
        const gasto = fs.reduce((t, p) => t + p.gasto!, 0);
        const inicial = fs.reduce((t, p) => t + p.inicial!, 0);
        return { comprador, requisicoes: ps.length, fechados: fs.length, gasto, saving: inicial - gasto, savingPct: inicial > 0 ? ((inicial - gasto) / inicial) * 100 : null };
      })
      .sort((a, b) => b.gasto - a.gasto || b.requisicoes - a.requisicoes || a.comprador.localeCompare(b.comprador, "pt-BR"));
  }, [dados.pedidos, f]);

  const visiveis = useMemo(() => filtrar(dados.pedidos, f), [dados.pedidos, f]);
  const fechados = visiveis.filter(fechado);

  // KPIs
  const emitidos = visiveis.filter((p) => p.emitidos > 0).length;
  const gastoTotal = fechados.reduce((t, p) => t + p.gasto!, 0);
  const savingTotal = fechados.reduce((t, p) => t + saving(p), 0);
  const savingMedio = fechados.length ? fechados.reduce((t, p) => t + savingPct(p), 0) / fechados.length : null;
  const atrasados = visiveis.filter((p) => p.atrasado).length;
  const simulados = fechados.filter((p) => p.simulado).length;

  // Pizza: tudo menos o filtro da própria fatia.
  const paraPizza = filtrar(dados.pedidos, f, ["fatia"]).filter(fechado);
  const pizza = { saving: paraPizza.reduce((t, p) => t + saving(p), 0), gasto: paraPizza.reduce((t, p) => t + p.gasto!, 0) };

  // Setores: os 5 maiores e o resto em "Outros".
  const porSetor = useMemo(() => {
    const somas = new Map<string, number>();
    for (const p of filtrar(dados.pedidos, f, ["setor"]).filter(fechado)) somas.set(setorDe(p), (somas.get(setorDe(p)) ?? 0) + p.gasto!);
    const ordem = [...somas].map(([setor, gasto]) => ({ setor, gasto: Math.round(gasto * 100) / 100 })).sort((a, b) => b.gasto - a.gasto);
    if (ordem.length <= MAX_SETORES + 1) return ordem;
    const resto = ordem.slice(MAX_SETORES).reduce((t, l) => t + l.gasto, 0);
    return [...ordem.slice(0, MAX_SETORES), { setor: OUTROS, gasto: Math.round(resto * 100) / 100 }];
  }, [dados.pedidos, f]);

  // Status: as três categorias, com o atraso separado dentro de cada barra aberta.
  const contagem = useMemo<ContagemStatus>(() => {
    const ps = filtrar(dados.pedidos, f, ["status"]);
    const n = (st: StatusRequisicao, atraso: boolean) => ps.filter((p) => p.status === st && p.atrasado === atraso).length;
    return {
      concluidas: ps.filter((p) => p.status === "concluida").length,
      andamentoNoPrazo: n("andamento", false),
      andamentoAtraso: n("andamento", true),
      iniciarNoPrazo: n("iniciar", false),
      iniciarAtraso: n("iniciar", true),
    };
  }, [dados.pedidos, f]);
  const temStatus = Object.values(contagem).some((v) => v > 0);

  const filtrosAtivos = [
    f.periodo !== "tudo" ? { chave: "periodo" as const, texto: PERIODOS.find((p) => p.valor === f.periodo)!.texto, limpar: { periodo: "tudo" as const } } : null,
    f.setor !== "todos" ? { chave: "setor" as const, texto: `Setor: ${f.setor}`, limpar: { setor: "todos" } } : null,
    f.comprador !== "todos" ? { chave: "comprador" as const, texto: `Comprador: ${f.comprador}`, limpar: { comprador: "todos" } } : null,
    f.status !== "todas" ? { chave: "status" as const, texto: STATUS.find((x) => x.valor === f.status)!.texto, limpar: { status: "todas" as const } } : null,
    f.fatia ? { chave: "fatia" as const, texto: f.fatia === "Saving" ? "Só pedidos com saving" : "Só pedidos com compra", limpar: { fatia: null } } : null,
  ].filter((x) => x !== null);

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Dashboard"
        contexto="Quanto a empresa gastou, quanto teria gasto sem a negociação e como andam as requisições."
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
            <Select id="dash-comprador" labelText="Comprador" size="md" value={f.comprador} onChange={(e) => mudar({ comprador: e.target.value })}>
              <SelectItem value="todos" text="Todos os compradores" />
              {compradores.map((c) => (
                <SelectItem key={c} value={c} text={c} />
              ))}
            </Select>
            <Select id="dash-status" labelText="Status" size="md" value={f.status} onChange={(e) => mudar({ status: e.target.value as FiltroStatus })}>
              {STATUS.map((x) => (
                <SelectItem key={x.valor} value={x.valor} text={x.texto} />
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
              <strong className={s.kpiValor}>{emitidos}</strong>
              <span className={s.kpiNota}>Com pedido de compra enviado ao fornecedor.</span>
            </Tile>
          </Column>
          <Column sm={2} md={2} lg={4}>
            <Tile className={s.kpi}>
              <span className={s.kpiRotulo}>Valor total gasto</span>
              <strong className={s.kpiValor}>{brl(gastoTotal)}</strong>
              <span className={s.kpiNota}>
                {plural(fechados.length, "pedido fechado", "pedidos fechados")}, com frete e impostos.{simulados ? ` ${simulados} com fornecedor simulado.` : ""}
              </span>
            </Tile>
          </Column>
          <Column sm={2} md={2} lg={4}>
            <Tile className={s.kpi}>
              <span className={s.kpiRotulo}>Saving total</span>
              <strong className={`${s.kpiValor} ${savingTotal >= 0.01 ? s.positivo : ""}`}>{brl(savingTotal)}</strong>
              <span className={s.kpiNota}>{savingMedio !== null ? `Saving médio de ${pct(savingMedio)} por pedido fechado.` : "Nenhum pedido fechado ainda."}</span>
            </Tile>
          </Column>
          <Column sm={2} md={2} lg={4}>
            <Tile className={`${s.kpi} ${atrasados ? s.kpiAlerta : ""}`}>
              <span className={s.kpiRotulo}>Pedidos em atraso</span>
              <strong className={s.kpiValor}>{atrasados}</strong>
              <span className={s.kpiNota}>Abertos além do prazo que o solicitante deu.</span>
            </Tile>
          </Column>
        </GradePagina>

        {/* 2. Economia */}
        <GradePagina>
          <Column sm={4} md={8} lg={8}>
            <Bloco titulo="Saving × gasto" descricao="O todo é o valor inicial, antes da negociação, somando os pedidos fechados. Clique numa fatia para filtrar a tabela.">
              {paraPizza.length ? (
                <PizzaEconomia saving={pizza.saving} gasto={pizza.gasto} aoClicar={(g) => mudar({ fatia: f.fatia === g ? null : g })} />
              ) : (
                <EstadoVazio compacto titulo="Nenhum pedido fechado nestes filtros." />
              )}
            </Bloco>
          </Column>
          <Column sm={4} md={8} lg={8}>
            <Bloco
              titulo="Saving por pedido"
              descricao={
                fechados.length < 10
                  ? `Distribuição da % de saving por pedido fechado. Com ${plural(fechados.length, "pedido", "pedidos")}, olhe as barras: a curva ajustada com poucos dados pode enganar.`
                  : "Distribuição da % de saving por pedido fechado; as barras são os pedidos reais."
              }
            >
              {fechados.length ? <CurvaSaving valores={fechados.map(savingPct)} /> : <EstadoVazio compacto titulo="Nenhum pedido fechado nestes filtros." />}
            </Bloco>
          </Column>
        </GradePagina>

        {/* Recorte por pessoa: o responsável pelo pedido, o mesmo dono do Quadro e da Lista */}
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco
              titulo="Gasto e economia por comprador"
              descricao="O comprador é o responsável pelo pedido: o escolhido no pedido ou, sem escolha, quem pediu. Saving em % do valor inicial dos pedidos fechados. Clique numa linha para filtrar."
              plano
            >
              <TabelaCompradores linhas={porComprador} escolhido={f.comprador} aoClicar={(c) => mudar({ comprador: f.comprador === c ? "todos" : c })} />
            </Bloco>
          </Column>
        </GradePagina>

        {/* 3. Gastos e status */}
        <GradePagina>
          <Column sm={4} md={8} lg={8}>
            <Bloco titulo="Custo por setor" descricao={`Gasto dos pedidos fechados, do maior para o menor${porSetor.some((l) => l.setor === OUTROS) ? `; depois dos ${MAX_SETORES} maiores, o resto fica em "Outros"` : ""}. Clique numa barra para filtrar.`}>
              {porSetor.length ? (
                <BarrasSetor linhas={porSetor} aoClicar={(setor) => setor !== OUTROS && mudar({ setor: f.setor === setor ? "todos" : setor })} />
              ) : (
                <EstadoVazio compacto titulo="Nenhum gasto nestes filtros." />
              )}
            </Bloco>
          </Column>
          <Column sm={4} md={8} lg={8}>
            <Bloco titulo="Status das requisições" descricao="Em vermelho, a parte em atraso de cada barra. Canceladas ficam de fora. Clique numa barra para filtrar.">
              {temStatus ? (
                <BarrasStatus contagem={contagem} aoClicar={(st: CliqueStatus) => mudar({ status: f.status === st ? "todas" : st })} />
              ) : (
                <EstadoVazio compacto titulo="Nenhuma requisição nestes filtros." />
              )}
            </Bloco>
          </Column>
        </GradePagina>

        {/* 4. Tabela por pedido */}
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco titulo="Pedidos: mapa de cotação × compra" descricao="Preço da compra contra a média das propostas válidas do mapa. Verde: abaixo da média. Clique numa linha para abrir o mapa completo." plano>
              <TabelaPedidos pedidos={visiveis} abrir={(id) => router.push(`/pedidos/${id}`)} />
            </Bloco>
          </Column>
        </GradePagina>

        {/* O que ficou da antiga tela de economia */}
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco titulo="Trabalho feito pelo assistente" descricao="Em todo o período, sem os filtros acima." plano solto>
              <p className={s.trabalho}>
                {plural(dados.trabalho.cotacoes, "pedido de cotação enviado", "pedidos de cotação enviados")} ·{" "}
                {plural(dados.trabalho.mensagensEntrada + dados.trabalho.mensagensSaida, "mensagem", "mensagens")} ({dados.trabalho.mensagensEntrada} recebidas, {dados.trabalho.mensagensSaida} enviadas) ·{" "}
                {plural(dados.trabalho.chamadasIa, "chamada de IA", "chamadas de IA")}
              </p>
            </Bloco>
          </Column>
        </GradePagina>
      </CorpoPagina>
    </Pagina>
  );
}

// ---------- Tabela ----------

const ROTULO_STATUS: Record<StatusRequisicao, { texto: string; tipo: "green" | "blue" | "gray" | "cool-gray" }> = {
  concluida: { texto: "Concluída", tipo: "green" },
  andamento: { texto: "Em andamento", tipo: "blue" },
  iniciar: { texto: "A iniciar", tipo: "gray" },
  cancelada: { texto: "Cancelada", tipo: "cool-gray" },
};

function TabelaPedidos({ pedidos, abrir }: { pedidos: LinhaPedido[]; abrir: (id: number) => void }) {
  if (!pedidos.length) return <EstadoVazio compacto titulo="Nenhum pedido nestes filtros." />;
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
            <TableHeader>Status</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {pedidos.map((p) => {
            const dif = p.gasto !== null && p.mediaMapa !== null ? p.gasto - p.mediaMapa : null;
            const st = ROTULO_STATUS[p.status];
            return (
              <TableRow key={p.id} className={s.linhaClicavel} onClick={() => abrir(p.id)}>
                <TableCell>
                  <span className={s.pedido}>
                    <CarbonLink as={NextLink} href={`/pedidos/${p.id}`} onClick={(e: MouseEvent) => e.stopPropagation()}>
                      Pedido {p.id}
                    </CarbonLink>
                    {p.simulado ? <SeloSimulado /> : null}
                  </span>
                  <span className={s.apoio}>{[p.comprador ?? SEM_COMPRADOR, p.setor].filter(Boolean).join(", ")}</span>
                </TableCell>
                <TableCell>{p.categorias.length ? p.categorias.join(", ") : <span className={s.apoio}>—</span>}</TableCell>
                <TableCell className={s.numero}>{brl(p.mediaMapa)}</TableCell>
                <TableCell className={s.numero}>{brl(p.gasto)}</TableCell>
                <TableCell className={`${s.numero} ${dif === null || Math.abs(dif) < 0.01 ? "" : dif < 0 ? s.positivo : s.negativo}`}>
                  {dif === null ? "—" : `${dif > 0 ? "+" : ""}${brl(dif)} (${dif > 0 ? "+" : ""}${pct((dif / p.mediaMapa!) * 100)})`}
                </TableCell>
                <TableCell>
                  <span className={s.etiquetas}>
                    <Tag size="sm" type={st.tipo}>
                      {st.texto}
                    </Tag>
                    {p.atrasado ? (
                      <Tag size="sm" type="red">
                        Em atraso
                      </Tag>
                    ) : null}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------- Por comprador ----------

type LinhaComprador = { comprador: string; requisicoes: number; fechados: number; gasto: number; saving: number; savingPct: number | null };

function TabelaCompradores({ linhas, escolhido, aoClicar }: { linhas: LinhaComprador[]; escolhido: string; aoClicar: (comprador: string) => void }) {
  if (!linhas.length) return <EstadoVazio compacto titulo="Nenhuma requisição nestes filtros." />;
  return (
    <div className={s.tabela}>
      <Table size="md" aria-label="Gasto e economia por comprador">
        <TableHead>
          <TableRow>
            <TableHeader>Comprador</TableHeader>
            <TableHeader>Requisições</TableHeader>
            <TableHeader>Pedidos fechados</TableHeader>
            <TableHeader>Valor gasto</TableHeader>
            <TableHeader>Saving</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {linhas.map((l) => (
            <TableRow key={l.comprador} className={s.linhaClicavel} isSelected={escolhido === l.comprador} onClick={() => aoClicar(l.comprador)}>
              <TableCell>{l.comprador}</TableCell>
              <TableCell className={s.numero}>{l.requisicoes}</TableCell>
              <TableCell className={s.numero}>{l.fechados}</TableCell>
              <TableCell className={s.numero}>{l.fechados ? brl(l.gasto) : "—"}</TableCell>
              <TableCell className={`${s.numero} ${l.saving >= 0.01 ? s.positivo : ""}`}>
                {l.fechados ? `${brl(l.saving)}${l.savingPct !== null ? ` (${pct(l.savingPct)})` : ""}` : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
