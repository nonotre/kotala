// Compra › Cotando › Propostas: as propostas como chegaram. Quem foi consultado (e a ligação por voz
// para quem não respondeu) fica na Busca, em cards por rodada.

import { Column, InlineNotification } from "@carbon/react";
import Link from "next/link";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { GradePagina } from "@/components/Pagina";
import { Tabela } from "@/components/Tabela";
import type { DadosPedido, ItemDoPedido } from "@/lib/dados-pedido";
import { brl, dataHora, hora } from "@/lib/formato";
import { LinkExterno } from "@/components/LinkExterno";
import { BotaoAcao } from "@/components/BotaoAcao";
import { chatDoFornecedor, Fornecedor, IndiceItens, SecaoItem, textoDias } from "./Item";
import { StatusCotacao } from "./Status";
import { FORMATO_OFERTA, hrefAba } from "./textos";
import s from "./pedido.module.scss";

function Propostas({ d, i }: { d: DadosPedido; i: ItemDoPedido }) {
  if (!i.ofertas.length) return null;
  const ofertas = [...i.ofertas].sort((a, b) => b.rodada - a.rodada);
  const variasRodadas = new Set(ofertas.map((o) => o.rodada)).size > 1;
  return (
    <Bloco titulo="Propostas recebidas">
      <Tabela
        rotulo={`Propostas do item ${i.item.ordem}`}
        vazio="Nenhuma proposta ainda."
        colunas={[...(variasRodadas ? ["Rodada"] : []), "Fornecedor", "O que ofereceu", "Como chegou", "Preço unitário", "Produto", "Frete", "Entrega", "Pagamento", "Validade"]}
        linhas={ofertas.map((o) => [
          ...(variasRodadas ? [o.rodada] : []),
          <Fornecedor key="f" nome={o.nome} simulado={o.origem === "simulado"} online={o.formato === "busca"} chat={chatDoFornecedor(d, i, o.fornecedorId)} />,
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

function vazioDoItem(d: DadosPedido, i: ItemDoPedido): string {
  if (["interpretando", "aguardando_confirmacao"].includes(d.pedido.estado)) return "As solicitações de proposta saem depois que você confirmar a cotação.";
  if (i.item.estado === "na_fila") return "A solicitação de proposta deste item ainda não saiu: ele está na fila.";
  if (i.item.estado === "buscando") return "Ninguém recebeu ainda. A solicitação de proposta sai depois da busca.";
  if (i.item.estado === "aguardando_recompra") return `${i.contrato ? "Item com contrato" : "Compra repetida"}: sem solicitação de proposta nova até você escolher na etapa Comparação.`;
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
            {/* Sem o cabeçalho do item ("1. 20 sacos… Aguardando sua decisão, Rodada 2"), a pedido da Liria; com vários itens, só o nome, para separar. */}
            <SecaoItem i={i} mostrarTitulo={d.itens.length > 1} soNome>
              {duvida ? (
                <InlineNotification kind="info" lowContrast hideCloseButton title={`${duvida.fornecedor} perguntou:`} subtitle={`${duvida.pergunta} Só você sabe responder: a próxima mensagem que você mandar ao assistente vai para ele.`} statusIconDescription="Informação" />
              ) : null}
              {i.perguntaPrazo ? (
                // R14b: a mesma pergunta que o assistente mandou na conversa, com os mesmos botões.
                <InlineNotification
                  kind="warning"
                  lowContrast
                  hideCloseButton
                  title="O prazo acabou com menos de 3 propostas válidas."
                  subtitle="Encerre e veja as opções que chegaram, ou estenda o prazo: a cotação ganha prioridade e o assistente procura mais fornecedores."
                  statusIconDescription="Aviso"
                >
                  <span className={s.acoesPrazo}>
                    <BotaoAcao dado={`item:${i.item.id}:prazo_encerrar`} rotulo="Encerrar e ver as opções" kind="secondary" size="sm" />
                    <BotaoAcao dado={`item:${i.item.id}:prazo_estender`} rotulo="Estender o prazo" kind="primary" size="sm" />
                  </span>
                </InlineNotification>
              ) : i.prioridade && i.item.estado === "cotando" ? (
                <InlineNotification kind="info" lowContrast hideCloseButton title="Cotação com prioridade." subtitle="Você estendeu o prazo: o assistente perguntou o motivo a quem não respondeu e procura mais fornecedores." statusIconDescription="Informação" />
              ) : null}
              {i.item.estado === "sem_proposta" ? (
                <InlineNotification kind="warning" lowContrast hideCloseButton title="Sem proposta válida." subtitle="Nenhum fornecedor mandou proposta que passasse nas regras." statusIconDescription="Aviso">
                  {i.mapa?.comparacao.cortadas.length ? <Link href={hrefAba(d.pedido.id, "comparacao", i.item.id)}>Ver por que cada proposta saiu</Link> : null}
                </InlineNotification>
              ) : null}
              {/* Liria (interface.md): aqui ficam só as propostas recebidas; quem foi consultado, por rodada, mora na Busca. */}
              {i.ofertas.length ? (
                <Propostas d={d} i={i} />
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
