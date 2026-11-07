// Aba Resumo: o texto do comprador, o que o assistente entendeu, a confirmação
// do pedido, a compra repetida e onde cada item está.

import { Column, InlineNotification } from "@carbon/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Bloco } from "@/components/Bloco";
import { BotaoAcao } from "@/components/BotaoAcao";
import { EstadoVazio } from "@/components/EstadoVazio";
import { GradePagina } from "@/components/Pagina";
import { SeloIA } from "@/components/SeloIA";
import { SeloSimulado } from "@/components/SeloSimulado";
import type { DadosPedido, ItemDoPedido } from "@/lib/dados-pedido";
import { brl, dataHora, dias, quantidade } from "@/lib/formato";
import { textoEntrega, textoPrazo, Urgencia } from "./CabecalhoPedido";
import { Campos, Fornecedor, IndiceItens, SecaoItem } from "./Item";
import { StatusPedido } from "./Status";
import { CANAL, DECIDIDOS, hrefAba, MOTIVOS_CANCELAMENTO, tituloItem, type AbaId } from "./textos";
import s from "./pedido.module.scss";

/** Para onde levar quem quer ver o item, conforme o estado dele. */
const ABA_DO_ESTADO: Partial<Record<string, { aba: AbaId; texto: string }>> = {
  buscando: { aba: "busca", texto: "Ver a busca" },
  cotando: { aba: "cotacoes", texto: "Ver as cotações" },
  comparando: { aba: "comparacao", texto: "Ver o mapa" },
  aguardando_decisao: { aba: "decisao", texto: "Decidir a compra" },
  aprovado: { aba: "decisao", texto: "Ver o que você aprovou" },
  pedido_enviado: { aba: "decisao", texto: "Ver o que você aprovou" },
  confirmado: { aba: "decisao", texto: "Ver o que você aprovou" },
  sem_proposta: { aba: "cotacoes", texto: "Ver as cotações" },
  cancelado: { aba: "historico", texto: "Ver o histórico" },
};

function Lista({ titulo, itens, selo }: { titulo: string; itens: string[]; selo?: ReactNode }) {
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

function OQueFoiPedido({ d }: { d: DadosPedido }) {
  const { pedido: p, itens } = d;
  const aguardando = p.estado === "aguardando_confirmacao";
  const entendido = itens.map((i) => {
    const espec = Object.entries(i.item.especificacao ?? {}).map(([k, v]) => `${k}: ${v}`);
    return `${tituloItem(i.item)}${espec.length ? ` (${espec.join(", ")})` : ""}${i.item.aceitaSimilar ? ", aceita equivalente" : ""}`;
  });
  return (
    <Bloco
      titulo={aguardando ? "Entendi assim, confirma?" : "O que você pediu"}
      descricao={`Recebido por ${CANAL[p.canalOrigem] ?? p.canalOrigem} em ${dataHora(p.criadoEm)}.`}
      acao={<StatusPedido estado={p.estado} />}
    >
      <blockquote className={s.original}>{p.textoOriginal}</blockquote>
      {p.motivoCancelamento ? <InlineNotification kind="warning" lowContrast hideCloseButton title="Cancelado:" subtitle={p.motivoCancelamento} statusIconDescription="Aviso" /> : null}
      <Lista
        titulo="O que o assistente entendeu"
        itens={entendido}
        selo={
          <SeloIA titulo={`O assistente leu a sua mensagem e separou ${itens.length === 1 ? "1 item" : `${itens.length} itens`}.`} tamanho="mini">
            Quantidade, unidade e descrição saíram do seu texto. O que ele assumiu sem você dizer aparece em “O assistente considerou”.
          </SeloIA>
        }
      />
      <Lista titulo="Correções" itens={p.correcoes} />
      <Lista titulo="O assistente considerou" itens={p.suposicoes} />
      <Lista titulo="Faltou dizer" itens={p.faltando} />
      {aguardando ? (
        <div className={s.acoes}>
          <BotaoAcao dado={`pedido:${p.id}:confirmar`} rotulo="Confirmar pedido" kind="primary" />
          <BotaoAcao
            dado={`pedido:${p.id}:cancelar`}
            rotulo="Cancelar"
            kind="ghost"
            confirmar={{
              titulo: `Cancelar o pedido ${p.id}?`,
              texto: "Nada será cotado. Por que cancelar?",
              botao: "Cancelar pedido",
              opcoes: Object.entries(MOTIVOS_CANCELAMENTO).map(([k, rotulo]) => ({ rotulo, dado: `pedido:${p.id}:cancelar_${k}` })),
            }}
          />
        </div>
      ) : null}
    </Bloco>
  );
}

function EntregaEPrazo({ p }: { p: DadosPedido["pedido"] }) {
  return (
    <Bloco titulo="Entrega e prazo">
      <Campos
        linhas={[
          ["Entrega", textoEntrega(p)],
          ["Janela de recebimento", p.janelaRecebimento],
          ["Setor", p.setor],
          ["Prazo", textoPrazo(p) ?? "Não informado"],
          ["Urgência", p.urgencia !== "normal" ? <Urgencia urgencia={p.urgencia} /> : "Normal"],
        ]}
      />
    </Bloco>
  );
}

function Recompra({ i }: { i: ItemDoPedido }) {
  const { item, recompra } = i;
  if (!recompra) return null;
  return (
    <Bloco titulo="Você comprou este item há pouco tempo" descricao="Compras repetidas em menos de 3 meses quase não mudam de preço. A decisão é sua.">
      <p className={s.texto}>
        Última compra: <strong>{recompra.fornecedorNome}</strong>, em {dataHora(recompra.data)}, a {brl(recompra.precoUnitario)} por {item.unidade}
        {recompra.frete !== null ? `, frete ${brl(recompra.frete)}` : ""}. {recompra.simulado ? <SeloSimulado /> : null}
      </p>
      {recompra.prazoPrometidoDias !== null ? (
        <p className={s.ajuda}>
          Prazo combinado: {dias(recompra.prazoPrometidoDias)}
          {recompra.prazoCumprido === true ? ", cumprido" : ""}. {recompra.comprasNoPeriodo > 1 ? `Comprou ${recompra.comprasNoPeriodo} vezes com ele nos últimos 90 dias.` : ""}
        </p>
      ) : null}
      {recompra.experiencia ? <p className={s.ajuda}>Como foi: {recompra.experiencia}</p> : null}
      <div className={s.acoes}>
        <BotaoAcao
          dado={`item:${item.id}:repetir_ok`}
          rotulo={`Repetir com ${recompra.fornecedorNome}`}
          kind="primary"
          confirmar={{
            titulo: "Repetir a compra?",
            texto: `${quantidade(item.quantidade, item.unidade)} de ${item.descricao} com ${recompra.fornecedorNome}${recompra.simulado ? " (simulado)" : ""}, a ${brl(recompra.precoUnitario)} por ${item.unidade}. O pedido de compra vai para o fornecedor, que confirma se mantém o preço.`,
            botao: "Sim, repetir",
          }}
        />
        <BotaoAcao dado={`item:${item.id}:cotar_novo`} rotulo="Cotar de novo" kind="tertiary" />
      </div>
    </Bloco>
  );
}

function OndeEsta({ d, i }: { d: DadosPedido; i: ItemDoPedido }) {
  const { item, cotacoes, mapa, escolhida, escolhido } = i;
  const respostas = cotacoes.filter((c) => c.cotacao.situacao === "respondeu").length;
  const destino = ABA_DO_ESTADO[item.estado];
  const validas = mapa?.comparacao.validas.length;
  return (
    <Bloco titulo="Onde está" acao={destino ? <Link href={hrefAba(d.pedido.id, destino.aba, item.id)}>{destino.texto}</Link> : undefined}>
      <Campos
        linhas={[
          ["Fornecedores consultados", cotacoes.length ? `${respostas} de ${cotacoes.length} responderam${item.rodada > 1 ? ` na rodada ${item.rodada}` : ""}` : null],
          ["Mapa de cotação", validas !== undefined ? (validas === 1 ? "1 proposta válida" : `${validas} propostas válidas`) : null],
          [
            "Escolhido",
            DECIDIDOS.includes(item.estado) && (escolhida || escolhido) ? (
              <>
                <Fornecedor nome={escolhida?.oferta.fornecedorNome ?? escolhido!.nome} simulado={escolhida?.oferta.simulado ?? escolhido!.simulado} />
                {escolhida ? ` por ${brl(escolhida.custo)}` : null}
              </>
            ) : null,
          ],
        ]}
      />
      {!cotacoes.length && !mapa && item.estado === "na_fila" ? <p className={s.ajuda}>Os itens são cotados um por vez. Este espera o anterior terminar.</p> : null}
    </Bloco>
  );
}

export function AbaResumo({ d }: { d: DadosPedido }) {
  const { pedido: p, itens } = d;
  return (
    <>
      <GradePagina>
        <Column sm={4} md={8} lg={11}>
          <OQueFoiPedido d={d} />
        </Column>
        <Column sm={4} md={8} lg={5}>
          <EntregaEPrazo p={p} />
        </Column>
      </GradePagina>
      <GradePagina>
        {itens.length ? (
          <>
            <Column sm={4} md={8} lg={16}>
              <IndiceItens itens={itens} />
            </Column>
            {itens.map((i) => (
              <Column key={i.item.id} sm={4} md={8} lg={16}>
                <SecaoItem i={i}>
                  <Recompra i={i} />
                  <OndeEsta d={d} i={i} />
                </SecaoItem>
              </Column>
            ))}
          </>
        ) : (
          <Column sm={4} md={8} lg={16}>
            <EstadoVazio compacto titulo={p.estado === "interpretando" ? "O assistente ainda está lendo o pedido." : "Este pedido não tem itens."} />
          </Column>
        )}
      </GradePagina>
    </>
  );
}
