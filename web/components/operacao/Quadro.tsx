"use client";
// Quadro de compras: cada item do pedido é um card, nas 4 colunas fixas da esteira.

import { Accordion, AccordionItem, Column, Link as CarbonLink, Tile } from "@carbon/react";
import NextLink from "next/link";
import { BarraProgresso } from "@/components/BarraProgresso";
import { EstadoVazio } from "@/components/EstadoVazio";
import { CabecalhoPagina, CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { SeloIA } from "@/components/SeloIA";
import type { Coluna, Etiqueta } from "@/lib/dados";
import type { AvisoSerial, ExtraDoItem } from "@/lib/dados-operacao";
import { brl, quantidade } from "@/lib/formato";
import { NomeFornecedor, Situacao, UrgenciaDasEtiquetas, VistaPedidos } from "./Situacao";
import o from "./operacao.module.scss";
import s from "./quadro.module.scss";

export type CartaoSerial = {
  itemId: number;
  pedidoId: number;
  descricao: string;
  quantidade: string;
  unidade: string;
  estado: string;
  estadoPedido: string;
  coluna: Coluna;
  etiquetas: Etiqueta[];
  /** Frente 2: responsável pelo card. */
  dono: string | null;
};

const COLUNAS: Coluna[] = ["Solicitado", "Cotando", "Comparando", "Decidido"];

const AJUDA: Record<Coluna, string> = {
  Solicitado: "Pedidos que chegaram e esperam confirmação ou a vez na fila.",
  Cotando: "Buscando fornecedores e esperando as propostas.",
  Comparando: "Mapa de cotação montado ou esperando sua decisão.",
  Decidido: "Aprovados, enviados, confirmados ou sem proposta.",
};

/** "3/5 respostas": o card mostra a barra, e a contagem vai junto dela. */
const RESPOSTAS = /^\d+\/\d+ respostas$/;

/** O card espera o comprador quando uma etiqueta pede a vez dele. */
const esperaVoce = (c: CartaoSerial) => c.etiquetas.some((e) => e.tipo === "atencao" && e.texto !== "Em negociação");

function Cartao({ c, extra }: { c: CartaoSerial; extra: ExtraDoItem | undefined }) {
  const proposta = extra?.proposta ?? null;
  const recomendada = proposta?.rotulo === "Recomendada" ? proposta : null;
  const respostas = c.estado === "cotando" && c.estadoPedido === "em_andamento" && extra && extra.consultados > 0 ? extra : null;
  const classes = [s.cartaoTile, c.estado === "na_fila" ? s.cartaoQuieto : ""].filter(Boolean).join(" ");
  return (
    <Tile
      className={classes}
      decorator={
        recomendada ? (
          <div className={s.seloCartao}>
            <SeloIA tamanho="mini" titulo="Por que esta proposta">
              Maior nota entre as {recomendada.validas} propostas válidas do mapa de cotação. Quem decide é você.
            </SeloIA>
          </div>
        ) : undefined
      }
    >
      <div className={s.cartao}>
        <div className={s.cartaoTopo}>
          {/* O link cobre o card inteiro: abrir o pedido é a ação do card. */}
          <NextLink href={`/pedidos/${c.pedidoId}#item-${c.itemId}`} className={s.numero}>
            Pedido {c.pedidoId}
          </NextLink>
          <h3 className={s.cartaoTitulo}>
            {quantidade(c.quantidade, c.unidade)} de {c.descricao}
          </h3>
          <p className={s.dono}>{c.dono ?? "Sem dono"}</p>
          <UrgenciaDasEtiquetas lista={c.etiquetas} />
        </div>

        {proposta ? (
          <div className={s.proposta}>
            <p className={o.rotulo}>{recomendada ? "Recomendada, custo total com frete" : "Escolhida, custo total com frete"}</p>
            <p className={s.custo}>{brl(proposta.custo)}</p>
            <NomeFornecedor nome={proposta.fornecedor} simulado={proposta.simulado} />
          </div>
        ) : null}

        {respostas ? (
          <BarraProgresso
            semRotulo
            rotulo={`${respostas.respostas} de ${respostas.consultados} fornecedores responderam`}
            valor={respostas.respostas}
            maximo={respostas.consultados}
            apoio={respostas.respostas === 1 ? `1 de ${respostas.consultados} respondeu` : `${respostas.respostas} de ${respostas.consultados} responderam`}
          />
        ) : null}

        <Situacao lista={c.etiquetas} sem={respostas ? c.etiquetas.filter((e) => RESPOSTAS.test(e.texto)).map((e) => e.texto) : []} />
      </div>
    </Tile>
  );
}

function Raia({ coluna, lista, daVez, extras }: { coluna: Coluna; lista: CartaoSerial[]; daVez: boolean; extras: Record<number, ExtraDoItem> }) {
  const idTitulo = `raia-${coluna}`;
  const classes = [s.raia, daVez ? s.raiaDaVez : "", lista.length === 0 ? s.raiaVazia : ""].filter(Boolean).join(" ");
  // Quem espera o comprador sobe na raia; o resto segue a ordem de atualização.
  const ordem = [...lista].sort((a, b) => Number(esperaVoce(b)) - Number(esperaVoce(a)));
  return (
    <section className={classes} aria-labelledby={idTitulo}>
      <div className={s.raiaCabeca}>
        <h2 className={s.raiaTitulo} id={idTitulo}>
          {coluna}
          <span className={s.raiaConta} aria-label={lista.length === 1 ? "1 item" : `${lista.length} itens`}>
            {lista.length}
          </span>
        </h2>
        <p className={s.raiaAjuda}>{AJUDA[coluna]}</p>
      </div>
      {ordem.length ? (
        <ul className={s.cartoes}>
          {ordem.map((c) => (
            <li key={c.itemId} className={s.cartaoItem}>
              <Cartao c={c} extra={extras[c.itemId]} />
            </li>
          ))}
        </ul>
      ) : (
        <div className={s.raiaFrase}>
          <EstadoVazio compacto titulo="Nenhuma compra aqui." />
        </div>
      )}
    </section>
  );
}

function PrecisaDeVoce({ avisos }: { avisos: AvisoSerial[] }) {
  const n = avisos.length;
  if (n === 0) return <p className={s.precisaNada}>Nada precisa de você agora.</p>;
  return (
    <Accordion className={s.precisa} size="md">
      <AccordionItem title={<span className={s.precisaTitulo}>{n === 1 ? "1 coisa precisa de você" : `${n} coisas precisam de você`}</span>}>
        <ul className={s.precisaLista}>
          {avisos.map((a) => (
            <li key={a.chave}>
              <p className={o.rotulo}>
                Pedido {a.pedidoId}
                {a.item ? ` · ${a.item}` : null}
              </p>
              <p className={o.frase}>{a.titulo}</p>
              <CarbonLink as={NextLink} href={a.href}>
                Resolver
              </CarbonLink>
            </li>
          ))}
        </ul>
      </AccordionItem>
    </Accordion>
  );
}

type Props = {
  colunas: Record<Coluna, CartaoSerial[]>;
  extras: Record<number, ExtraDoItem>;
  /** Só o que pede ação do comprador. */
  avisos: AvisoSerial[];
  mostrarCanceladas: boolean;
};

export function Quadro({ colunas, extras, avisos, mostrarCanceladas }: Props) {
  const total = COLUNAS.reduce((t, c) => t + colunas[c].length, 0);
  // A raia da vez é a do primeiro card que espera o comprador; no celular, ela vem primeiro.
  const colunaDaVez = COLUNAS.find((c) => colunas[c].some(esperaVoce)) ?? null;
  const contexto = total
    ? `${total} ${total === 1 ? "item" : "itens"}. O card anda sozinho a cada etapa.`
    : "Nenhum pedido ainda. Mande um pedido pelo Telegram ou pela aba Conversar.";
  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Quadro de compras"
        contexto={contexto}
        lado={
          <div className={o.ladoCabecalho}>
            <CarbonLink as={NextLink} href={mostrarCanceladas ? "/quadro" : "/quadro?canceladas=1"}>
              {mostrarCanceladas ? "Ocultar canceladas" : "Mostrar canceladas"}
            </CarbonLink>
            <VistaPedidos atual="quadro" />
          </div>
        }
      />
      <CorpoPagina>
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <PrecisaDeVoce avisos={avisos} />
          </Column>
          <Column sm={4} md={8} lg={16}>
            <div className={s.raias}>
              {COLUNAS.map((col) => (
                <Raia key={col} coluna={col} lista={colunas[col]} daVez={col === colunaDaVez} extras={extras} />
              ))}
            </div>
          </Column>
        </GradePagina>
      </CorpoPagina>
    </Pagina>
  );
}
