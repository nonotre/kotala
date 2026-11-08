// Compra › Cotando › Cotações: quem foi consultado na rodada, a situação de cada um, a ligação
// por voz para quem não respondeu e as propostas como chegaram.

import { Column, InlineNotification } from "@carbon/react";
import Link from "next/link";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { GradePagina } from "@/components/Pagina";
import { Tabela } from "@/components/Tabela";
import type { DadosPedido, ItemDoPedido } from "@/lib/dados-pedido";
import { brl, dataHora, hora } from "@/lib/formato";
import { LinkExterno } from "@/components/LinkExterno";
import { Fornecedor, IndiceItens, SecaoItem, textoDias } from "./Item";
import { StatusCotacao } from "./Status";
import { FORMATO_OFERTA, hrefAba } from "./textos";
import s from "./pedido.module.scss";

function Consultados({ i }: { i: ItemDoPedido }) {
  const { item, cotacoes } = i;
  if (!cotacoes.length) return null;
  const respostas = cotacoes.filter((c) => c.cotacao.situacao === "respondeu").length;
  const prazo = item.prazoRespostasEm && item.estado === "cotando" ? ` Respostas até ${hora(item.prazoRespostasEm)}.` : "";
  return (
    <Bloco
      titulo={item.rodada > 1 ? `Consultados na rodada ${item.rodada}` : "Fornecedores consultados"}
      descricao={`${respostas} de ${cotacoes.length} ${cotacoes.length === 1 ? "respondeu" : "responderam"}.${prazo}${item.rodada > 1 ? " Quem não foi consultado nesta rodada mantém a proposta anterior no mapa." : ""}`}
    >
      <Tabela
        rotulo={`Fornecedores consultados no item ${item.ordem}`}
        vazio="Ninguém consultado nesta rodada."
        colunas={["Fornecedor", "Situação", "Enviada", "Respondeu", ""]}
        linhas={cotacoes.map(({ cotacao: ct, nome, origem }) => [
          <Fornecedor key="f" nome={nome} simulado={origem === "simulado"} />,
          <StatusCotacao key="s" situacao={ct.situacao} />,
          ct.enviadaEm ? dataHora(ct.enviadaEm) : "—",
          ct.respondeuEm ? dataHora(ct.respondeuEm) : "—",
          // Quem não respondeu ao texto pode receber uma ligação por voz.
          item.estado === "cotando" && ct.situacao === "aguardando" ? (
            <Link key="v" href={`/voz/${ct.id}`}>
              Ligar por voz
            </Link>
          ) : (
            ""
          ),
        ])}
      />
    </Bloco>
  );
}

function Propostas({ i }: { i: ItemDoPedido }) {
  if (!i.ofertas.length) return null;
  const ofertas = [...i.ofertas].sort((a, b) => b.rodada - a.rodada);
  const variasRodadas = new Set(ofertas.map((o) => o.rodada)).size > 1;
  return (
    <Bloco titulo="Propostas recebidas" descricao="Como cada fornecedor respondeu, antes das contas do mapa.">
      <Tabela
        rotulo={`Propostas do item ${i.item.ordem}`}
        vazio="Nenhuma proposta ainda."
        colunas={[...(variasRodadas ? ["Rodada"] : []), "Fornecedor", "O que ofereceu", "Como chegou", "Preço unitário", "Produto", "Frete", "Entrega", "Pagamento", "Validade"]}
        linhas={ofertas.map((o) => [
          ...(variasRodadas ? [o.rodada] : []),
          <Fornecedor key="f" nome={o.nome} simulado={o.origem === "simulado"} online={o.formato === "busca"} />,
          <span key="o">
            {o.itemOferecido}
            {!o.itemExato ? <span className={s.ajudaCelula}>Equivalente</span> : null}
            {o.embalagem ? <span className={s.ajudaCelula}>Embalagem: {o.embalagem}</span> : null}
            {o.impostosNaoInclusos ? (
              <span className={s.ajudaCelula}>{o.impostosNaoInclusos === "inclusos" ? "Impostos inclusos no preço" : `Fora do preço: ${o.impostosNaoInclusos}`}</span>
            ) : null}
            {o.formato === "busca" && o.fonte ? (
              <span className={s.ajudaCelula}>
                <LinkExterno href={o.fonte}>Ver anúncio</LinkExterno>
              </span>
            ) : null}
          </span>,
          `${FORMATO_OFERTA[o.formato] ?? o.formato}, ${hora(o.criadoEm)}`,
          <span key="pu" className={s.numero}>{brl(o.precoUnitario)}</span>,
          <span key="tp" className={s.numero}>
            {brl(o.totalProduto ?? (o.precoUnitario !== null ? String(Number(o.precoUnitario) * Number(i.item.quantidade)) : null))}
          </span>,
          <span key="fr" className={s.numero}>{o.frete !== null ? brl(o.frete) : o.formato === "busca" ? "a calcular no site" : "—"}</span>,
          textoDias(o.prazoDias),
          o.pagamento ?? "—",
          textoDias(o.validadeDias),
        ])}
      />
    </Bloco>
  );
}

function RodadasAnteriores({ i }: { i: ItemDoPedido }) {
  const antigas = i.cotacoesTodas.filter((c) => c.cotacao.rodada < i.item.rodada);
  if (!antigas.length) return null;
  return (
    <Bloco titulo="Rodadas anteriores">
      <Tabela
        rotulo={`Rodadas anteriores do item ${i.item.ordem}`}
        tamanho="sm"
        vazio="Sem rodada anterior."
        colunas={["Rodada", "Fornecedor", "Situação"]}
        linhas={antigas.map((c) => [c.cotacao.rodada, <Fornecedor key="f" nome={c.nome} simulado={c.origem === "simulado"} />, <StatusCotacao key="s" situacao={c.cotacao.situacao} />])}
      />
    </Bloco>
  );
}

function vazioDoItem(d: DadosPedido, i: ItemDoPedido): string {
  if (["interpretando", "aguardando_confirmacao"].includes(d.pedido.estado)) return "As solicitações de proposta saem depois que você confirmar a cotação.";
  if (i.item.estado === "na_fila") return "A solicitação de proposta deste item ainda não saiu: ele está na fila.";
  if (i.item.estado === "buscando") return "Ninguém recebeu ainda. A solicitação de proposta sai depois da busca.";
  if (i.item.estado === "aguardando_recompra") return "Compra repetida: sem solicitação de proposta nova até você escolher na etapa Comparação.";
  return "Nenhum fornecedor recebeu a solicitação de proposta deste item.";
}

export function AbaCotacoes({ d }: { d: DadosPedido }) {
  return (
    <GradePagina>
      <Column sm={4} md={8} lg={16}>
        <IndiceItens itens={d.itens} />
      </Column>
      {d.itens.map((i) => {
        const duvida = i.item.duvidaPendente;
        return (
          <Column key={i.item.id} sm={4} md={8} lg={16}>
            <SecaoItem i={i}>
              {duvida ? (
                <InlineNotification kind="info" lowContrast hideCloseButton title={`${duvida.fornecedor} perguntou:`} subtitle={`${duvida.pergunta} Só você sabe responder: a próxima mensagem que você mandar ao assistente vai para ele.`} statusIconDescription="Informação" />
              ) : null}
              {i.item.estado === "sem_proposta" ? (
                <InlineNotification kind="warning" lowContrast hideCloseButton title="Sem proposta válida." subtitle="Nenhum fornecedor mandou proposta que passasse nas regras." statusIconDescription="Aviso">
                  {i.mapa?.comparacao.cortadas.length ? <Link href={hrefAba(d.pedido.id, "comparacao", i.item.id)}>Ver por que cada proposta saiu</Link> : null}
                </InlineNotification>
              ) : null}
              {i.cotacoesTodas.length || i.ofertas.length ? (
                <>
                  <Consultados i={i} />
                  <Propostas i={i} />
                  <RodadasAnteriores i={i} />
                </>
              ) : (
                <EstadoVazio compacto titulo={vazioDoItem(d, i)} />
              )}
            </SecaoItem>
          </Column>
        );
      })}
      {!d.itens.length ? (
        <Column sm={4} md={8} lg={16}>
          <EstadoVazio titulo="As solicitações de proposta saem depois que você confirmar a cotação." proximoPasso="A confirmação fica na etapa Solicitada." acao={{ texto: "Ir para Solicitada", href: hrefAba(d.pedido.id, "solicitado"), tipo: "tertiary" }} />
        </Column>
      ) : null}
    </GradePagina>
  );
}
