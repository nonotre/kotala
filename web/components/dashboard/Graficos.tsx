"use client";
// Gráficos do dashboard, com o Carbon Charts. Só no navegador: o painel carrega
// este arquivo com next/dynamic e ssr desligado, porque o d3 mexe no DOM.

import "@carbon/charts-react/styles.css";
import { BarEvent, ComboChart, DonutChart, PieEvent, ScaleTypes, SimpleBarChart, StackedBarChart } from "@carbon/charts-react";
import { useEffect, useRef, type RefObject } from "react";
import { useTema } from "@/lib/tema";
import { brl } from "@/lib/formato";

/** Paleta do Carbon por tema: os gráficos não leem os tokens CSS. */
function usarCores() {
  const { escuro, temaCarbon } = useTema();
  return {
    tema: temaCarbon,
    verde: escuro ? "#42be65" : "#24a148", // green 40 / 50
    cinza: escuro ? "#6f6f6f" : "#a8a8a8", // gray 60 / 30
    azul: escuro ? "#78a9ff" : "#0f62fe", // blue 40 / 60
    vermelho: escuro ? "#fa4d56" : "#da1e28", // red 50 / 60
  };
}

type ComGrafico = { chart?: { services: { events: { addEventListener: (t: string, f: (e: Event) => void) => void; removeEventListener: (t: string, f: (e: Event) => void) => void } } } };

/** Liga um evento de clique do gráfico, com o callback mais recente. */
function usarClique<T>(ref: RefObject<ComGrafico | null>, evento: string, extrair: (detalhe: unknown) => T | null, aoClicar?: (v: T) => void) {
  const atual = useRef(aoClicar);
  atual.current = aoClicar;
  useEffect(() => {
    const eventos = ref.current?.chart?.services.events;
    if (!eventos) return;
    const ouvir = (e: Event) => {
      const v = extrair((e as CustomEvent).detail);
      if (v !== null) atual.current?.(v);
    };
    eventos.addEventListener(evento, ouvir);
    return () => eventos.removeEventListener(evento, ouvir);
    // extrair é estável em cada uso (função de módulo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, evento]);
}

const grupoDaFatia = (d: unknown) => ((d as { datum?: { data?: { group?: string } } })?.datum?.data?.group ?? null);
const datumDaBarra = (d: unknown) => ((d as { datum?: { group?: string; key?: string } })?.datum ?? null);

const ALTURA = "320px";
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

// ---------- Pizza: saving × gasto ----------

export function PizzaEconomia({ saving, gasto, aoClicar }: { saving: number; gasto: number; aoClicar?: (grupo: "Saving" | "Gasto") => void }) {
  const c = usarCores();
  const ref = useRef<DonutChart>(null);
  usarClique(ref as RefObject<ComGrafico | null>, PieEvent.SLICE_CLICK, grupoDaFatia, (g) => aoClicar?.(g as "Saving" | "Gasto"));
  const inicial = saving + gasto;
  return (
    <DonutChart
      ref={ref}
      data={[
        { group: "Saving", value: saving },
        { group: "Gasto", value: gasto },
      ]}
      options={{
        theme: c.tema,
        height: ALTURA,
        resizable: true,
        toolbar: { enabled: false },
        legend: { alignment: "center" },
        color: { scale: { Saving: c.verde, Gasto: c.cinza } },
        pie: { labels: { formatter: (d: { data: { value: number } }) => (inicial ? pct((d.data.value / inicial) * 100) : "") } as never, valueMapsTo: "value" },
        tooltip: { valueFormatter: (v: number) => brl(v) } as never,
        donut: {
          alignment: "center",
          center: {
            label: inicial ? `Saving · ${pct((saving / inicial) * 100)} do inicial` : "Saving",
            number: saving,
            numberFormatter: (v: number) => brl(v),
          },
        },
      }}
    />
  );
}

// ---------- Curva normal da % de saving por pedido, com o histograma atrás ----------

export function CurvaSaving({ valores }: { valores: number[] }) {
  const c = usarCores();
  const n = valores.length;
  const media = valores.reduce((a, b) => a + b, 0) / n;
  const desvio = n > 1 ? Math.sqrt(valores.reduce((t, v) => t + (v - media) ** 2, 0) / (n - 1)) : 0;

  // Pontos reais: pedidos por ponto percentual (arredondado), com a barra no próprio valor.
  // Faixa larga com a barra no centro dela faria 0% parecer 2,5%.
  const largura = 1;
  const contagem = new Map<number, number>();
  for (const v of valores) contagem.set(Math.round(v / largura) * largura, (contagem.get(Math.round(v / largura) * largura) ?? 0) + 1);
  const faixas = [...contagem].map(([x, q]) => ({ x, n: q })).sort((a, b) => a.x - b.x);

  // A curva em "pedidos por ponto percentual", na mesma escala das barras.
  const curva: { group: string; x: number; y: number }[] = [];
  const folga = 5;
  // Saving nunca é negativo (só conta o que a negociação baixou): o eixo começa logo antes do 0.
  const ini = Math.max(-1, Math.min(faixas[0]!.x - folga, desvio > 0 ? media - 3 * desvio : Infinity));
  const fim = Math.max(faixas[faixas.length - 1]!.x + folga, desvio > 0 ? media + 3 * desvio : -Infinity);
  if (desvio > 0) {
    for (let i = 0; i <= 60; i++) {
      const x = ini + ((fim - ini) * i) / 60;
      const y = (n * largura * Math.exp(-((x - media) ** 2) / (2 * desvio ** 2))) / (desvio * Math.sqrt(2 * Math.PI));
      curva.push({ group: "Curva normal", x: Math.round(x * 100) / 100, y: Math.round(y * 1000) / 1000 });
    }
  }

  return (
    <ComboChart
      data={[...faixas.map((f) => ({ group: "Pedidos", x: f.x, y: f.n })), ...curva]}
      options={{
        theme: c.tema,
        height: ALTURA,
        resizable: true,
        toolbar: { enabled: false },
        color: { scale: { "Pedidos": c.cinza, "Curva normal": c.azul } },
        axes: {
          bottom: {
            title: "Saving por pedido fechado (%)",
            mapsTo: "x",
            scaleType: ScaleTypes.LINEAR,
            domain: [ini, fim],
            includeZero: false,
            ticks: { formatter: (v: unknown) => pct(Number(v)) } as never,
            thresholds: [{ value: media, label: `Média: ${pct(media)}`, fillColor: c.verde, valueFormatter: (v: number) => pct(v) }],
          },
          left: { title: "Pedidos", mapsTo: "y", scaleType: ScaleTypes.LINEAR },
        },
        comboChartTypes: [
          { type: "simple-bar", options: { bars: { width: 10, maxWidth: 16 } }, correspondingDatasets: ["Pedidos"] },
          { type: "line", options: { points: { enabled: false } }, correspondingDatasets: ["Curva normal"] },
        ],
      }}
    />
  );
}

// ---------- Custo por setor ----------

export function BarrasSetor({ linhas, aoClicar }: { linhas: { setor: string; gasto: number }[]; aoClicar?: (setor: string) => void }) {
  const c = usarCores();
  const ref = useRef<SimpleBarChart>(null);
  usarClique(ref as RefObject<ComGrafico | null>, BarEvent.BAR_CLICK, (d) => datumDaBarra(d)?.group ?? null, aoClicar);
  return (
    <SimpleBarChart
      ref={ref}
      data={linhas.map((l) => ({ group: l.setor, value: l.gasto }))}
      options={{
        theme: c.tema,
        height: ALTURA,
        resizable: true,
        toolbar: { enabled: false },
        legend: { enabled: false },
        color: { scale: Object.fromEntries(linhas.map((l) => [l.setor, c.azul])) },
        axes: {
          // De cima para baixo, do maior para o menor.
          left: { mapsTo: "group", scaleType: ScaleTypes.LABELS, domain: linhas.map((l) => l.setor).reverse() },
          bottom: { mapsTo: "value", ticks: { formatter: (v: unknown) => brl(Number(v)) } as never },
        },
        tooltip: { valueFormatter: (v: number) => brl(v) } as never,
      }}
    />
  );
}

// ---------- Status das requisições, com o atraso dentro da barra ----------

export type ContagemStatus = { concluidas: number; andamentoNoPrazo: number; andamentoAtraso: number; iniciarNoPrazo: number; iniciarAtraso: number };
export type CliqueStatus = "concluida" | "andamento" | "iniciar" | "atraso";

const CATEGORIA: Record<string, CliqueStatus> = { Concluídas: "concluida", "Em andamento": "andamento", "A iniciar": "iniciar" };

export function BarrasStatus({ contagem, aoClicar }: { contagem: ContagemStatus; aoClicar?: (s: CliqueStatus) => void }) {
  const c = usarCores();
  const ref = useRef<StackedBarChart>(null);
  usarClique(
    ref as RefObject<ComGrafico | null>,
    BarEvent.BAR_CLICK,
    (d) => {
      const b = datumDaBarra(d);
      if (!b) return null;
      return b.group === "Em atraso" ? "atraso" : (CATEGORIA[b.key ?? ""] ?? null);
    },
    aoClicar,
  );
  return (
    <StackedBarChart
      ref={ref}
      data={[
        { group: "Concluídas", key: "Concluídas", value: contagem.concluidas },
        { group: "No prazo", key: "Em andamento", value: contagem.andamentoNoPrazo },
        { group: "Em atraso", key: "Em andamento", value: contagem.andamentoAtraso },
        { group: "No prazo", key: "A iniciar", value: contagem.iniciarNoPrazo },
        { group: "Em atraso", key: "A iniciar", value: contagem.iniciarAtraso },
      ]}
      options={{
        theme: c.tema,
        height: ALTURA,
        resizable: true,
        toolbar: { enabled: false },
        // O vermelho dentro da barra já diz o que é atraso; o rótulo aparece ao passar o mouse.
        legend: { enabled: false },
        color: { scale: { Concluídas: c.azul, "No prazo": c.cinza, "Em atraso": c.vermelho } },
        axes: {
          bottom: { mapsTo: "key", scaleType: ScaleTypes.LABELS, domain: ["Concluídas", "Em andamento", "A iniciar"] },
          left: { mapsTo: "value", stacked: true, title: "Requisições" },
        },
      }}
    />
  );
}
