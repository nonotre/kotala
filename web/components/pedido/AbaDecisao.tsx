// Compra › Decidido: aprovar uma das propostas válidas ou reprovar com o motivo, que
// leva o item a um caminho diferente. Depois de aprovar, o que foi aprovado.
// Nada é comprado sem o comprador: toda aprovação passa por um modal.

import { Column } from "@carbon/react";
import Link from "next/link";
import { Bloco } from "@/components/Bloco";
import { BotaoAcao } from "@/components/BotaoAcao";
import { EstadoVazio } from "@/components/EstadoVazio";
import { GradePagina } from "@/components/Pagina";
import { SeloIA } from "@/components/SeloIA";
import { Tabela } from "@/components/Tabela";
import type { DadosPedido, ItemDoPedido } from "@/lib/dados-pedido";
import { brl, dias, nota, quantidade } from "@/lib/formato";
import { Campos, Fornecedor, IndiceItens, SecaoItem, textoDias } from "./Item";
import { Status, StatusItem } from "./Status";
import { DECIDIDOS, hrefAba, MAX_RODADAS, MOTIVOS_CANCELAMENTO } from "./textos";
import s from "./pedido.module.scss";

function Escolha({ i }: { i: ItemDoPedido }) {
  const { item, mapa } = i;
  const c = mapa!.comparacao;
  return (
    <Bloco titulo={`Escolha quem entrega ${quantidade(item.quantidade, item.unidade)}`} descricao="Em ordem de nota. A primeira é a que o assistente põe na frente.">
      <Tabela
        rotulo={`Propostas para aprovar no item ${item.ordem}`}
        vazio="Nenhuma proposta válida."
        destaque={[0]}
        colunas={["Fornecedor", "Custo total", "Entrega", "Nota", ""]}
        linhas={c.validas.map((l, n) => [
          <span key="f" className={s.celulaPilha}>
            <Fornecedor nome={l.oferta.fornecedorNome} simulado={l.oferta.simulado} />
            {!l.oferta.itemExato ? <span className={s.ajudaCelula}>Equivalente: {l.oferta.itemOferecido}</span> : null}
            {l.alertas.length ? (
              <span className={s.alerta}>
                <Status tipo="caution-minor" rotulo={`Atenção: ${l.alertas.join("; ")}`} />
              </span>
            ) : null}
          </span>,
          <span key="c" className={s.celulaPilha}>
            <span className={s.numero}>{brl(l.custo)}</span>
            {/* Q8: o total da loja online leva uma estimativa de frete, não o frete real. */}
            {l.origemFrete === "a_calcular" ? <span className={s.ajudaCelula}>Estimado: frete a calcular no site</span> : null}
            <span className={s.ajudaCelula}>Pagamento: {l.oferta.pagamento ?? "não informado"}</span>
          </span>,
          textoDias(l.oferta.prazoDias),
          <span key="n" className={s.numero}>
            {nota(l.nota)}
          </span>,
          <BotaoAcao
            key="a"
            dado={`item:${item.id}:confirmar:${l.oferta.id}`}
            rotulo={`Aprovar ${l.oferta.fornecedorNome}`}
            kind={n === 0 ? "primary" : "tertiary"}
            size="sm"
            confirmar={{
              titulo: "Confirmar a compra?",
              texto: `${quantidade(item.quantidade, item.unidade)} de ${item.descricao} com ${l.oferta.fornecedorNome}${l.oferta.simulado ? " (simulado)" : ""} por ${brl(l.custo)}${l.origemFrete === "a_calcular" ? " (estimado: o frete sai no site)" : ""}, entrega em ${l.oferta.prazoDias !== null ? dias(l.oferta.prazoDias) : "prazo não informado"}, pagamento ${l.oferta.pagamento ?? "não informado"}. O pedido vai para o fornecedor.`,
              botao: "Sim, aprovar",
            }}
          />,
        ])}
      />
      <p className={s.ajuda}>Aprovar pede uma confirmação antes de mandar o pedido.</p>
    </Bloco>
  );
}

function Reprovar({ i }: { i: ItemDoPedido }) {
  const { item, mapa } = i;
  const c = mapa!.comparacao;
  const v = c.vencedora!;
  return (
    <Bloco titulo="Reprovar" descricao="Cada motivo leva a um caminho diferente.">
      <div className={s.acoesPilha}>
        {item.rodada < MAX_RODADAS ? <BotaoAcao dado={`item:${item.id}:negociar`} rotulo="Preço alto: negociar" kind="tertiary" /> : null}
        <BotaoAcao dado={`item:${item.id}:buscar`} rotulo="Prazo longo: buscar mais fornecedores" kind="ghost" />
        <BotaoAcao
          dado={`item:${item.id}:excluir:${v.oferta.fornecedorId}`}
          rotulo={`Não confio em ${v.oferta.fornecedorNome}`}
          kind="ghost"
          confirmar={{ titulo: `Tirar ${v.oferta.fornecedorNome} do mapa?`, texto: "O mapa é refeito sem esse fornecedor, só para este item.", botao: "Tirar do mapa" }}
        />
        <BotaoAcao dado={`item:${item.id}:reprovar`} rotulo="Cotar de novo com todos" kind="ghost" />
        <BotaoAcao
          dado={`item:${item.id}:cancelar`}
          rotulo="Desistir deste item"
          kind="ghost"
          confirmar={{
            titulo: "Desistir deste item?",
            texto: `${item.descricao} será cancelado. Nada será comprado. Por que desistir?`,
            botao: "Desistir",
            opcoes: Object.entries(MOTIVOS_CANCELAMENTO).map(([k, rotulo]) => ({ rotulo, dado: `item:${item.id}:cancelar:${k}` })),
          }}
        />
      </div>
      {item.rodada >= MAX_RODADAS ? <p className={s.ajuda}>Já foram {MAX_RODADAS} rodadas: é o limite de negociação para não cansar os fornecedores.</p> : <p className={s.ajuda}>Rodada {item.rodada} de {MAX_RODADAS}.</p>}
    </Bloco>
  );
}

function PorQue({ d, i }: { d: DadosPedido; i: ItemDoPedido }) {
  const c = i.mapa!.comparacao;
  const v = c.vencedora!;
  return (
    <Bloco titulo="Por que esta" acao={<Link href={hrefAba(d.pedido.id, "comparacao", i.item.id)}>Ver o mapa</Link>}>
      <p className={s.recomendacaoFrase}>
        {c.podeDizerMelhor ? "Recomendo" : "Na frente"}: <Fornecedor nome={v.oferta.fornecedorNome} simulado={v.oferta.simulado} />{" "}
        <SeloIA titulo="Justificativa redigida pelo assistente." tipo="inline" tamanho="mini" texto="IA">
          Os números vêm do mapa, calculado em código.
        </SeloIA>
      </p>
      <p className={s.texto}>{i.mapa!.recomendacao}</p>
      {c.aMaisQueAMaisBarata > 0 ? <p className={s.ajuda}>Custa {brl(c.aMaisQueAMaisBarata)} a mais que a mais barata.</p> : null}
    </Bloco>
  );
}

function Aprovado({ i }: { i: ItemDoPedido }) {
  const { item, escolhida, escolhido } = i;
  const nome = escolhida?.oferta.fornecedorNome ?? escolhido?.nome;
  const simulado = escolhida?.oferta.simulado ?? escolhido?.simulado ?? false;
  return (
    <Bloco titulo="O que você aprovou" acao={<StatusItem estado={item.estado} />}>
      <Campos
        linhas={[
          ["Fornecedor", nome ? <Fornecedor nome={nome} simulado={simulado} /> : null],
          ["Custo total", escolhida ? brl(escolhida.custo) : null],
          ["Entrega", escolhida && escolhida.oferta.prazoDias !== null ? dias(escolhida.oferta.prazoDias) : null],
          ["Pagamento", escolhida?.oferta.pagamento],
          ["Quantidade", `${quantidade(item.quantidade, item.unidade)} de ${item.descricao}`],
        ]}
      />
      {item.estado === "pedido_enviado" || item.estado === "aprovado" ? <p className={s.ajuda}>O pedido foi para o fornecedor. Você recebe um aviso quando ele confirmar.</p> : null}
    </Bloco>
  );
}

function SemDecisao({ d, i }: { d: DadosPedido; i: ItemDoPedido }) {
  const { item } = i;
  if (item.estado === "aguardando_recompra") {
    return <EstadoVazio compacto titulo="Compra repetida: escolha repetir ou cotar de novo na etapa Comparação." acao={{ texto: "Ir para Comparação", href: hrefAba(d.pedido.id, "comparacao", item.id) }} />;
  }
  if (item.estado === "sem_proposta") {
    return <EstadoVazio compacto titulo="Sem proposta válida: não há o que aprovar." acao={{ texto: "Ver as propostas", href: hrefAba(d.pedido.id, "cotacoes", item.id) }} />;
  }
  if (item.estado === "cancelado") return <EstadoVazio compacto titulo="Item cancelado. Nada foi comprado." />;
  return <EstadoVazio compacto titulo="Ainda não há o que decidir." proximoPasso="A decisão chega quando o mapa estiver pronto." />;
}

export function AbaDecisao({ d }: { d: DadosPedido }) {
  return (
    <GradePagina>
      <Column sm={4} md={8} lg={16}>
        <IndiceItens itens={d.itens} />
      </Column>
      {d.itens.map((i) => {
        const aguardando = i.item.estado === "aguardando_decisao" && !!i.mapa?.comparacao.vencedora;
        return (
          <Column key={i.item.id} sm={4} md={8} lg={16}>
            <SecaoItem i={i}>
              {aguardando ? (
                <div className={s.divisao}>
                  <Escolha i={i} />
                  <div className={`${s.painelPreso} ${s.pilha}`}>
                    <PorQue d={d} i={i} />
                    <Reprovar i={i} />
                  </div>
                </div>
              ) : DECIDIDOS.includes(i.item.estado) ? (
                <Aprovado i={i} />
              ) : (
                <SemDecisao d={d} i={i} />
              )}
            </SecaoItem>
          </Column>
        );
      })}
      {!d.itens.length ? (
        <Column sm={4} md={8} lg={16}>
          <EstadoVazio titulo="Ainda não há o que decidir." proximoPasso="Primeiro, confirme a cotação na etapa Solicitada." acao={{ texto: "Ir para Solicitada", href: hrefAba(d.pedido.id, "solicitado"), tipo: "tertiary" }} />
        </Column>
      ) : null}
    </GradePagina>
  );
}
