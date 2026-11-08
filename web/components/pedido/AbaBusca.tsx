// Compra › Cotando › Busca: quem foi consultado em cada rodada (cards, com a resposta e os horários)
// e o preço público coletado na internet, que serve só de referência.

import { Column } from "@carbon/react";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { LegendaOutraGuia, LinkExterno } from "@/components/LinkExterno";
import { GradePagina } from "@/components/Pagina";
import { Tabela } from "@/components/Tabela";
import type { DadosPedido, ItemDoPedido } from "@/lib/dados-pedido";
import { brl, dataHora, dias } from "@/lib/formato";
import Link from "next/link";
import { chatDoFornecedor, Fornecedor, IndiceItens, SecaoItem } from "./Item";
import { Status, StatusCotacao } from "./Status";
import { hrefAba } from "./textos";
import s from "./pedido.module.scss";

const ehLink = (t: string | null) => !!t && /^https?:\/\//.test(t);

/**
 * Liria (interface.md): quem foi consultado, em cards um embaixo do outro, separados por rodada
 * ("Consultados na rodada 2"). Cada card: nome, região, pedidos confirmados com ele; à direita,
 * se respondeu e os horários de envio e de resposta. Quem ainda não respondeu pode receber uma ligação.
 */
function Consultados({ d, i }: { d: DadosPedido; i: ItemDoPedido }) {
  if (!i.cotacoesTodas.length) return null;
  const rodadas = [...new Set(i.cotacoesTodas.map((c) => c.cotacao.rodada))].sort((a, b) => b - a);
  return (
    <>
      {rodadas.map((r) => {
        const daRodada = i.cotacoesTodas.filter((c) => c.cotacao.rodada === r);
        return (
          <Bloco key={r} titulo={`Consultados na rodada ${r}`} descricao={`${daRodada.length === 1 ? "1 fornecedor" : `${daRodada.length} fornecedores`}.`}>
            <ul className={s.cardsConsultados}>
              {daRodada.map(({ cotacao: ct, nome, origem, regiao, verificado, homologado }) => {
                const confirmados = d.pedidosConfirmados[ct.fornecedorId] ?? 0;
                const podeLigar = r === i.item.rodada && i.item.estado === "cotando" && ct.situacao === "aguardando";
                return (
                  <li key={ct.id} className={s.cardConsultado}>
                    <div className={s.cardConsultadoQuem}>
                      <Fornecedor nome={nome} simulado={origem === "simulado"} chat={r === i.item.rodada ? chatDoFornecedor(d, i, ct.fornecedorId) : null} />
                      <span className={s.ajudaCelula}>{regiao ?? "Endereço não informado"}</span>
                      <span className={s.ajudaCelula}>
                        {confirmados === 0 ? "Nenhum pedido confirmado com ele" : confirmados === 1 ? "1 pedido confirmado" : `${confirmados} pedidos confirmados`}
                      </span>
                      <span className={s.marcas}>
                        {verificado ? <Status tipo="succeeded" rotulo="Verificado" /> : null}
                        {homologado ? <Status tipo="succeeded" rotulo="Homologado" /> : null}
                      </span>
                    </div>
                    <div className={s.cardConsultadoSituacao}>
                      <StatusCotacao situacao={ct.situacao} />
                      <span className={s.ajudaCelula}>Enviada: {ct.enviadaEm ? dataHora(ct.enviadaEm) : "—"}</span>
                      <span className={s.ajudaCelula}>Respondeu: {ct.respondeuEm ? dataHora(ct.respondeuEm) : "—"}</span>
                      {podeLigar ? <Link href={`/voz/${ct.id}`}>Ligar por voz</Link> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Bloco>
        );
      })}
    </>
  );
}

function Referencias({ i }: { i: ItemDoPedido }) {
  if (!i.referencias.length) return null;
  return (
    <Bloco titulo="Preço de referência na internet" descricao="Preços públicos servem só de contexto. Quem cota são os fornecedores." acao={<LegendaOutraGuia />}>
      <Tabela
        rotulo={`Referência pública do item ${i.item.ordem}`}
        tamanho="sm"
        vazio="Nenhum preço público coletado."
        colunas={["Loja", "Produto", "Preço", "Entrega", "Situação", "Coletado"]}
        apagadas={i.referencias.map((r, n) => (r.aceita ? -1 : n)).filter((n) => n >= 0)}
        linhas={i.referencias.map((r) => [
          <span key="l" className={s.marcas}>
            {r.loja}
            {r.cnpjAtivo ? <Status tipo="succeeded" rotulo="CNPJ ativo" /> : null}
          </span>,
          <LinkExterno key="p" href={r.url}>
            {r.titulo}
          </LinkExterno>,
          <span key="v" className={s.numero}>
            {brl(r.precoUnitario ?? r.precoFonte)}
            {r.conversao ? <span className={s.ajudaCelula}>{r.conversao}</span> : null}
          </span>,
          r.entregaNoCep && r.frete
            ? `${brl(r.frete)}${r.fretePrazoDias !== null ? ` em ${dias(r.fretePrazoDias)}` : ""}${r.regiaoDoPreco?.startsWith("Frete do anúncio") ? " (do anúncio)" : ""}`
            : (r.regiaoDoPreco ?? "—"),
          r.aceita ? (r.disponivel === false ? "Sem estoque" : "Usado na referência") : `Cortado: ${r.motivoCorte}`,
          dataHora(r.coletadoEm),
        ])}
      />
    </Bloco>
  );
}

function vazioDoItem(d: DadosPedido, i: ItemDoPedido): string {
  if (["interpretando", "aguardando_confirmacao"].includes(d.pedido.estado)) return "A busca começa depois que você confirmar a cotação.";
  if (i.item.estado === "na_fila") return "A busca começa quando este item sair da fila.";
  if (i.item.estado === "buscando") return "O assistente está procurando fornecedores.";
  if (i.item.estado === "aguardando_recompra") return "Compra repetida: sem busca nova até você escolher na etapa Comparação.";
  if (i.item.estado === "cancelado") return "Item cancelado.";
  return "A busca não achou fornecedor para este item.";
}

export function AbaBusca({ d }: { d: DadosPedido }) {
  return (
    <GradePagina>
      <Column sm={4} md={8} lg={16}>
        <IndiceItens itens={d.itens} />
      </Column>
      {d.itens.map((i) => (
        <Column key={i.item.id} sm={4} md={8} lg={16}>
          <SecaoItem i={i}>
            {i.cotacoesTodas.length || i.referencias.length ? (
              <>
                <Consultados d={d} i={i} />
                <Referencias i={i} />
              </>
            ) : (
              <EstadoVazio compacto titulo={vazioDoItem(d, i)} />
            )}
          </SecaoItem>
        </Column>
      ))}
      {!d.itens.length ? (
        <Column sm={4} md={8} lg={16}>
          <EstadoVazio titulo="A busca começa depois que você confirmar a cotação." proximoPasso="A confirmação fica na etapa Solicitada." acao={{ texto: "Ir para Solicitada", href: hrefAba(d.pedido.id, "solicitado"), tipo: "tertiary" }} />
        </Column>
      ) : null}
    </GradePagina>
  );
}
