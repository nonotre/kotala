"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@carbon/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { EstadoVazio } from "./EstadoVazio";
import s from "./comum.module.scss";

type Props = {
  colunas: ReactNode[];
  linhas: ReactNode[][];
  /** Índices das linhas a destacar, como a oferta recomendada. */
  destaque?: number[];
  /** Índices das linhas esmaecidas, como ofertas cortadas. */
  apagadas?: number[];
  /** A frase quando não há linha. */
  vazio: string;
  /** Nome da tabela para o leitor de tela. Único na página. */
  rotulo: string;
  tamanho?: "xs" | "sm" | "md" | "lg";
};

/**
 * Tabela de apoio, com rolagem no próprio bloco.
 * Quem rola é o invólucro que o `Table` do Carbon cria em volta do `<table>`; as setas agem nele a partir do foco no `<table>`.
 * Só há parada de Tab quando há o que rolar: sem isso, cada tabela larga no notebook seria uma parada sem função.
 * Para buscar, ordenar ou selecionar, use `DataTable`; para o mapa de cotação, `Table` direto.
 */
export function Tabela({ colunas, linhas, destaque = [], apagadas = [], vazio, rotulo, tamanho = "md" }: Props) {
  const raiz = useRef<HTMLDivElement>(null);
  const [rola, setRola] = useState(false);
  const temLinhas = linhas.length > 0;

  useEffect(() => {
    const tabela = raiz.current?.querySelector("table");
    const rolagem = tabela?.parentElement;
    if (!tabela || !rolagem) return;
    const medir = () => setRola(rolagem.scrollWidth > rolagem.clientWidth);
    const observador = new ResizeObserver(medir);
    observador.observe(rolagem);
    observador.observe(tabela);
    return () => observador.disconnect();
  }, [temLinhas]);

  if (!temLinhas) return <EstadoVazio compacto titulo={vazio} />;
  return (
    <div ref={raiz} className={s.tabelaRolagem} style={{ "--tabela-colunas": colunas.length } as CSSProperties}>
      <Table size={tamanho} aria-label={rotulo} tabIndex={rola ? 0 : undefined}>
        <TableHead>
          <TableRow>
            {colunas.map((c, i) => (
              <TableHeader key={i}>{c}</TableHeader>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {linhas.map((l, i) => (
            <TableRow key={i} className={destaque.includes(i) ? s.linhaDestaque : apagadas.includes(i) ? s.linhaApagada : undefined}>
              {l.map((c, j) => (
                <TableCell key={j}>{c}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
