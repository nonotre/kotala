// Peças comuns às abas: cada item do pedido é uma seção com âncora `item-<id>`,
// para os avisos e o quadro levarem direto a ele (`/pedidos/N/decisao#item-M`).

import Link from "next/link";
import type { ReactNode } from "react";
import { SeloSimulado } from "@/components/SeloSimulado";
import comum from "@/components/comum.module.scss";
import type { ItemDoPedido } from "@/lib/dados-pedido";
import { dias, hora } from "@/lib/formato";
import { StatusItem } from "./Status";
import { tituloItem } from "./textos";
import s from "./pedido.module.scss";

/** Nome do fornecedor com o selo, quando é simulado. */
export function Fornecedor({ nome, simulado, online = false }: { nome: string; simulado: boolean; online?: boolean }) {
  return (
    <span className={comum.fornecedor}>
      <span>{nome}</span>
      {simulado ? <SeloSimulado /> : online ? <SeloSimulado texto="loja online" /> : null}
    </span>
  );
}

/** Linha de apoio do item: estado, rodada, prazo das respostas e se aceita equivalente. */
export function ContextoItem({ item }: { item: ItemDoPedido["item"] }) {
  return (
    // div, não p: o StatusItem desenha uma div, e div dentro de p quebra a hidratação.
    <div className={s.itemContexto}>
      <StatusItem estado={item.estado} />
      {item.rodada > 1 ? <span>Rodada {item.rodada}</span> : null}
      {item.prazoRespostasEm && item.estado === "cotando" ? <span>Respostas até {hora(item.prazoRespostasEm)}</span> : null}
      {item.aceitaSimilar ? <span>Aceita equivalente</span> : null}
    </div>
  );
}

/** Uma seção por item, com a âncora que os avisos usam. */
export function SecaoItem({ i, children, mostrarTitulo = true }: { i: ItemDoPedido; children: ReactNode; mostrarTitulo?: boolean }) {
  return (
    <section id={`item-${i.item.id}`} className={s.item} aria-label={tituloItem(i.item)}>
      {mostrarTitulo ? (
        <header className={s.itemTopo}>
          <h2 className={s.itemTitulo}>{tituloItem(i.item)}</h2>
          <ContextoItem item={i.item} />
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Com mais de um item, a lista no topo da aba leva a cada um. */
export function IndiceItens({ itens }: { itens: ItemDoPedido[] }) {
  if (itens.length < 2) return null;
  return (
    <nav aria-label="Itens desta cotação" className={s.indice}>
      <span className={s.indiceRotulo}>{itens.length} itens nesta cotação</span>
      <ol className={s.indiceLista}>
        {itens.map((i) => (
          <li key={i.item.id} className={s.indiceItem}>
            <Link href={`#item-${i.item.id}`}>{tituloItem(i.item)}</Link>
            <StatusItem estado={i.item.estado} />
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Lista de frases com título, como o que o assistente considerou. Sem frase, nada. */
export function ListaTextos({ titulo, itens, selo }: { titulo: string; itens: string[]; selo?: ReactNode }) {
  if (!itens.length) return null;
  return (
    <div className={s.grupo}>
      <div className={s.grupoTopo}>
        <h3 className={s.grupoTitulo}>{titulo}</h3>
        {selo}
      </div>
      <ul className={s.lista}>
        {itens.map((t, n) => (
          <li key={n}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

/** Pares de rótulo e valor. Valor vazio fica de fora. */
export function Campos({ linhas }: { linhas: [string, ReactNode][] }) {
  const cheias = linhas.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false);
  if (!cheias.length) return null;
  return (
    <dl className={s.campos}>
      {cheias.map(([r, v]) => (
        <div key={r} className={s.campo}>
          <dt className={s.campoRotulo}>{r}</dt>
          <dd className={s.campoValor}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export const textoDias = (n: number | null | undefined) => (n === null || n === undefined ? "—" : dias(n));
