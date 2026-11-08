// Pedido › Resumo: os detalhes do pedido e onde cada item está, com o link para a
// etapa da compra em que ele anda. As seções por item guardam a âncora `item-<id>`,
// que o quadro, os avisos e as fichas usam (`/pedidos/N#item-M`).

import { Column } from "@carbon/react";
import Link from "next/link";
import { Bloco } from "@/components/Bloco";
import { GradePagina } from "@/components/Pagina";
import type { DadosPedido, ItemDoPedido } from "@/lib/dados-pedido";
import { brl } from "@/lib/formato";
import { DetalhesPedido } from "./DetalhesPedido";
import { Campos, Fornecedor, IndiceItens, SecaoItem } from "./Item";
import { DECIDIDOS, hrefAba, type AbaId } from "./textos";
import s from "./pedido.module.scss";

/** Para onde levar quem quer ver o item, conforme o estado dele. */
const ABA_DO_ESTADO: Partial<Record<string, { aba: AbaId; texto: string }>> = {
  buscando: { aba: "busca", texto: "Ver a busca" },
  cotando: { aba: "cotacoes", texto: "Ver as propostas" },
  aguardando_recompra: { aba: "comparacao", texto: "Repetir ou cotar de novo" },
  comparando: { aba: "comparacao", texto: "Ver o mapa" },
  aguardando_decisao: { aba: "decisao", texto: "Decidir a compra" },
  aprovado: { aba: "decisao", texto: "Ver o que você aprovou" },
  pedido_enviado: { aba: "decisao", texto: "Ver o que você aprovou" },
  confirmado: { aba: "decisao", texto: "Ver o que você aprovou" },
  sem_proposta: { aba: "cotacoes", texto: "Ver as propostas" },
  cancelado: { aba: "historico", texto: "Ver o histórico" },
};

function OndeEsta({ d, i }: { d: DadosPedido; i: ItemDoPedido }) {
  const { pedido: p } = d;
  const { item, cotacoes, mapa, escolhida, escolhido } = i;
  const respostas = cotacoes.filter((c) => c.cotacao.situacao === "respondeu").length;
  // Antes da confirmação, todo item espera nela.
  const aConfirmar = p.estado === "aguardando_confirmacao";
  const destino = aConfirmar ? { aba: "solicitado" as const, texto: "Conferir e confirmar" } : p.estado === "interpretando" ? undefined : ABA_DO_ESTADO[item.estado];
  const validas = mapa?.comparacao.validas.length;
  return (
    <Bloco titulo="Onde está" acao={destino ? <Link href={hrefAba(p.id, destino.aba, item.id)}>{destino.texto}</Link> : undefined}>
      <Campos
        linhas={[
          ["Fornecedores consultados", cotacoes.length ? `${respostas} de ${cotacoes.length} responderam${item.rodada > 1 ? ` na rodada ${item.rodada}` : ""}` : null],
          ["Mapa de cotações", validas !== undefined ? (validas === 1 ? "1 proposta válida" : `${validas} propostas válidas`) : null],
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
      {aConfirmar ? <p className={s.ajuda}>As solicitações de proposta saem depois que você confirmar a cotação.</p> : null}
      {!aConfirmar && !cotacoes.length && !mapa && item.estado === "na_fila" ? <p className={s.ajuda}>Os itens são cotados um por vez. Este espera o anterior terminar.</p> : null}
    </Bloco>
  );
}

export function AbaResumo({ d }: { d: DadosPedido }) {
  const { itens } = d;
  return (
    <>
      <GradePagina>
        <Column sm={4} md={8} lg={16}>
          <DetalhesPedido d={d} />
        </Column>
      </GradePagina>
      {/* Sem itens, a tabela dos Detalhes já diz por quê. */}
      {itens.length ? (
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <IndiceItens itens={itens} />
          </Column>
          {itens.map((i) => (
            <Column key={i.item.id} sm={4} md={8} lg={16}>
              <SecaoItem i={i}>
                <OndeEsta d={d} i={i} />
              </SecaoItem>
            </Column>
          ))}
        </GradePagina>
      ) : null}
    </>
  );
}
