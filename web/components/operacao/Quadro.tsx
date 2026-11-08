"use client";
// Quadro de compras: cada item do pedido é um card, nas 4 colunas fixas da esteira.
// As raias servem ao Início (ao lado do chat) e à tela Pedidos; o cabeçalho é de quem as usa.

import { Accordion, AccordionItem, DefinitionTooltip, Link as CarbonLink, Tile } from "@carbon/react";
import NextLink from "next/link";
import { BarraProgresso } from "@/components/BarraProgresso";
import { EstadoVazio } from "@/components/EstadoVazio";
import { SeloIA } from "@/components/SeloIA";
import { ROTULO_COLUNA } from "@/lib/colunas";
import type { Coluna, Etiqueta } from "@/lib/dados";
import type { AvisoSerial, ExtraDoItem } from "@/lib/dados-operacao";
import { brl, quantidade } from "@/lib/formato";
import { NomeFornecedor, Situacao, UrgenciaDasEtiquetas } from "./Situacao";
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
  Solicitado: "Cotações que chegaram e esperam confirmação ou a vez na fila.",
  Cotando: "Buscando fornecedores e esperando as propostas.",
  Comparando: "Mapa de cotações montado ou esperando sua decisão.",
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
              Maior nota entre as {recomendada.validas} propostas válidas do mapa de cotações. Quem decide é você.
            </SeloIA>
          </div>
        ) : undefined
      }
    >
      <div className={s.cartao}>
        <div className={s.cartaoTopo}>
          {/* O link cobre o card inteiro: abrir o pedido é a ação do card. */}
          <NextLink href={`/pedidos/${c.pedidoId}`} className={s.numero}>
            Cotação {c.pedidoId}
          </NextLink>
          <h3 className={s.cartaoTitulo}>
            {quantidade(c.quantidade, c.unidade)} de {c.descricao}
          </h3>
          <p className={s.dono}>{c.dono ?? "Sem responsável"}</p>
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
          {/* A explicação da coluna fica no nome: abre com o foco, o toque ou o mouse. */}
          <DefinitionTooltip definition={AJUDA[coluna]} align="bottom-start" openOnHover triggerClassName={s.raiaNome}>
            {ROTULO_COLUNA[coluna]}
          </DefinitionTooltip>
          <span className={s.raiaConta} aria-label={lista.length === 1 ? "1 item" : `${lista.length} itens`}>
            {lista.length}
          </span>
        </h2>
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

/** "Precisa de você": o que pede ação do comprador, recolhido acima do quadro. */
export function PrecisaDeVoce({ avisos }: { avisos: AvisoSerial[] }) {
  const n = avisos.length;
  if (n === 0) return <p className={s.precisaNada}>Nada precisa de você agora.</p>;
  return (
    <Accordion className={s.precisa} size="md">
      <AccordionItem title={<span className={s.precisaTitulo}>{n === 1 ? "1 coisa precisa de você" : `${n} coisas precisam de você`}</span>}>
        <ul className={s.precisaLista}>
          {avisos.map((a) => (
            <li key={a.chave}>
              <p className={o.rotulo}>
                Cotação {a.pedidoId}
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
  /** "Só os meus" ligado: o vazio diz que pode haver cotações de outras pessoas. */
  meus?: boolean;
};

/** As 4 raias do quadro, sem cabeçalho: quem usa põe o título e os controles. */
export function QuadroRaias({ colunas, extras, meus = false }: Props) {
  const total = COLUNAS.reduce((t, c) => t + colunas[c].length, 0);
  if (total === 0) {
    return meus ? (
      <EstadoVazio compacto titulo="Nenhuma cotação sua por aqui." proximoPasso="Desligue “Só os meus” para ver as de todos." />
    ) : (
      <EstadoVazio compacto titulo="Nenhuma cotação ainda." proximoPasso="Peça uma cotação pelo Telegram ou em Conversas." />
    );
  }
  // A raia da vez é a do primeiro card que espera o comprador; sem colunas lado a lado, ela vem primeiro.
  const colunaDaVez = COLUNAS.find((c) => colunas[c].some(esperaVoce)) ?? null;
  return (
    // Região que rola na horizontal quando as 4 raias não cabem: precisa de foco para quem usa teclado.
    <div className={s.raiasRolagem} role="region" aria-label="Quadro de compras" tabIndex={0}>
      <div className={s.raias}>
        {COLUNAS.map((col) => (
          <Raia key={col} coluna={col} lista={colunas[col]} daVez={col === colunaDaVez} extras={extras} />
        ))}
      </div>
    </div>
  );
}

/** Link "Mostrar canceladas" / "Ocultar canceladas": quem usa dá os dois endereços. */
export function AlternarCanceladas({ mostrando, hrefMostrar, hrefOcultar }: { mostrando: boolean; hrefMostrar: string; hrefOcultar: string }) {
  return (
    <CarbonLink as={NextLink} href={mostrando ? hrefOcultar : hrefMostrar}>
      {mostrando ? "Ocultar canceladas" : "Mostrar canceladas"}
    </CarbonLink>
  );
}
