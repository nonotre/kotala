// Peças comuns às abas: cada item do pedido é uma seção com âncora `item-<id>`,
// para os avisos e o quadro levarem direto a ele (`/pedidos/N/decisao#item-M`).

import { Link as CarbonLink } from "@carbon/react";
import { Launch } from "@carbon/react/icons";
import Link from "next/link";
import type { ReactNode } from "react";
import { SeloSimulado } from "@/components/SeloSimulado";
import comum from "@/components/comum.module.scss";
import { FINAIS_ITEM, type DadosPedido, type ItemDoPedido } from "@/lib/dados-pedido";
import { dias, hora } from "@/lib/formato";
import { StatusItem } from "./Status";
import { tituloItem } from "./textos";
import s from "./pedido.module.scss";

/**
 * Nome do fornecedor com o selo, quando é simulado.
 * T8: com `chat` (de `chatDoFornecedor`), o simulado ganha o link "Ser o fornecedor", que abre o Telegram simulado em outra guia.
 */
export function Fornecedor({ nome, simulado, online = false, chat = null }: { nome: string; simulado: boolean; online?: boolean; chat?: string | null }) {
  return (
    <span className={comum.fornecedor}>
      <span>{nome}</span>
      {simulado ? <SeloSimulado /> : online ? <SeloSimulado texto="loja online" /> : null}
      {simulado && chat ? (
        <CarbonLink href={chat} target="_blank" rel="noopener" size="sm" className={s.serFornecedor} title={`Abrir o Telegram simulado de ${nome} e responder como ele`}>
          Ser o fornecedor
          <Launch size={12} aria-hidden="true" />
          <span className={comum.somenteLeitor}> (abre em outra guia)</span>
        </CarbonLink>
      ) : null}
    </span>
  );
}

/**
 * T8: endereço do Telegram simulado do fornecedor, já com a cotação do item, enquanto ela está em andamento.
 * Null para fornecedor real (não tem chat simulado) e para item encerrado.
 */
export function chatDoFornecedor(d: DadosPedido, i: ItemDoPedido, fornecedorId: string | null | undefined): string | null {
  const contatoId = fornecedorId ? d.chatsSimulados[fornecedorId] : undefined;
  if (!contatoId || FINAIS_ITEM.includes(i.item.estado)) return null;
  return `/telegram-simulado/${contatoId}?item=${i.item.id}`;
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
    <nav aria-label="Itens deste pedido" className={s.indice}>
      <span className={s.indiceRotulo}>{itens.length} itens neste pedido</span>
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
