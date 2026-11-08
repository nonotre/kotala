// Compra › Cotando › Busca: quem a busca achou e recebeu a cotação, em todas as rodadas, e o
// preço público coletado na internet, que serve só de referência.

import { Column } from "@carbon/react";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { LegendaOutraGuia, LinkExterno } from "@/components/LinkExterno";
import { GradePagina } from "@/components/Pagina";
import { Tabela } from "@/components/Tabela";
import type { DadosPedido, ItemDoPedido } from "@/lib/dados-pedido";
import { brl, dataHora, dias } from "@/lib/formato";
import { Fornecedor, IndiceItens, SecaoItem } from "./Item";
import { Status } from "./Status";
import { hrefAba } from "./textos";
import s from "./pedido.module.scss";

const ehLink = (t: string | null) => !!t && /^https?:\/\//.test(t);

/** Uma linha por fornecedor, com as rodadas em que foi consultado. */
function QuemRecebeu({ i }: { i: ItemDoPedido }) {
  const porFornecedor = new Map<string, { c: ItemDoPedido["cotacoesTodas"][number]; rodadas: number[] }>();
  for (const c of i.cotacoesTodas) {
    const atual = porFornecedor.get(c.cotacao.fornecedorId);
    if (atual) atual.rodadas.push(c.cotacao.rodada);
    else porFornecedor.set(c.cotacao.fornecedorId, { c, rodadas: [c.cotacao.rodada] });
  }
  const linhas = [...porFornecedor.values()];
  if (!linhas.length) return null;
  return (
    <Bloco titulo="Quem recebeu a solicitação de proposta" descricao={`${linhas.length === 1 ? "1 fornecedor" : `${linhas.length} fornecedores`} encontrados para este item.`}>
      <Tabela
        rotulo={`Fornecedores do item ${i.item.ordem}`}
        vazio="Ninguém recebeu a solicitação de proposta."
        colunas={["Fornecedor", "Verificação", "Região", "Fonte", "Rodadas"]}
        linhas={linhas.map(({ c, rodadas }) => [
          <Fornecedor key="f" nome={c.nome} simulado={c.origem === "simulado"} />,
          <span key="v" className={s.marcas}>
            {c.verificado ? <Status tipo="succeeded" rotulo="Verificado" /> : <Status tipo="not-started" rotulo="Não verificado" />}
            {c.homologado ? <Status tipo="succeeded" rotulo="Homologado" /> : null}
          </span>,
          c.regiao ?? "—",
          ehLink(c.fonte) ? (
            <LinkExterno key="l" href={c.fonte!}>
              Fonte
            </LinkExterno>
          ) : (
            (c.fonte ?? "—")
          ),
          rodadas.join(", "),
        ])}
      />
    </Bloco>
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
          r.entregaNoCep && r.frete ? `${brl(r.frete)}${r.fretePrazoDias !== null ? ` em ${dias(r.fretePrazoDias)}` : ""}` : (r.regiaoDoPreco ?? "—"),
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
                <QuemRecebeu i={i} />
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
