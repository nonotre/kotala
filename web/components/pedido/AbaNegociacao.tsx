// Compra › Comparando › Negociação: a rodada de negociação em curso (a quem o assistente pediu
// preço melhor e com que números) e como o custo de cada fornecedor mudou de
// uma rodada para outra, pelos mapas guardados.

import { Column } from "@carbon/react";
import Link from "next/link";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { GradePagina } from "@/components/Pagina";
import { Tabela } from "@/components/Tabela";
import type { Linha } from "@/lib/dados";
import type { DadosPedido, ItemDoPedido } from "@/lib/dados-pedido";
import { brl } from "@/lib/formato";
import { Campos, chatDoFornecedor, Fornecedor, IndiceItens, SecaoItem } from "./Item";
import { hrefAba, MAX_RODADAS } from "./textos";
import s from "./pedido.module.scss";

const temNegociacao = (i: ItemDoPedido) => !!i.item.negociacao || i.mapasPorRodada.length > 1 || i.ofertas.some((o) => o.rodada > 1);

function RodadaAtual({ d, i }: { d: DadosPedido; i: ItemDoPedido }) {
  const n = i.item.negociacao;
  if (!n) return null;
  const alvos = n.alvos.map((id) => d.fornecedores[id]).filter((f) => !!f);
  return (
    <Bloco titulo={`Negociação na rodada ${n.rodada}`} descricao={n.motivo}>
      <Campos
        linhas={[
          [
            alvos.length === 1 ? "Fornecedor procurado" : "Fornecedores procurados",
            alvos.length ? (
              <span className={s.marcas}>
                {alvos.map((f) => (
                  <Fornecedor key={f.id} nome={f.nome} simulado={f.simulado} chat={chatDoFornecedor(d, i, f.id)} />
                ))}
              </span>
            ) : (
              `${n.alvos.length}`
            ),
          ],
          ["Melhor custo do mapa", n.melhorCusto !== null ? brl(n.melhorCusto) : null],
          ["Referência de preço", n.referencia !== null ? brl(n.referencia) : null],
          ["Rodada", `${i.item.rodada} de ${MAX_RODADAS}`],
        ]}
      />
      <p className={s.ajuda}>O assistente não cita o valor de outro fornecedor na contraproposta.</p>
    </Bloco>
  );
}

/** Custo de cada fornecedor em cada rodada, a partir do último mapa de cada rodada. */
function ComoOPrecoMudou({ d, i }: { d: DadosPedido; i: ItemDoPedido }) {
  const mapas = i.mapasPorRodada;
  if (!mapas.length) return null;
  const fornecedores = new Map<string, { nome: string; simulado: boolean }>();
  const custo = new Map<string, Linha>();
  for (const m of mapas) {
    for (const l of [...m.comparacao.validas, ...m.comparacao.cortadas]) {
      fornecedores.set(l.oferta.fornecedorId, { nome: l.oferta.fornecedorNome, simulado: l.oferta.simulado });
      custo.set(`${m.rodada}:${l.oferta.fornecedorId}`, l);
    }
  }
  const atual = mapas[mapas.length - 1]!.comparacao;
  const baixaram = atual.validas.filter((l) => l.oferta.produtoAnterior && l.produto !== null && l.oferta.produtoAnterior - l.produto >= 0.01);
  return (
    <Bloco titulo="Como o preço mudou" descricao="Custo total com frete em cada rodada. Fora do mapa aparece entre parênteses.">
      <Tabela
        rotulo={`Custo por rodada do item ${i.item.ordem}`}
        vazio="Nenhum mapa ainda."
        colunas={["Fornecedor", ...mapas.map((m) => `Rodada ${m.rodada}`)]}
        linhas={[...fornecedores.entries()].map(([id, f]) => [
          <Fornecedor key="f" nome={f.nome} simulado={f.simulado} chat={chatDoFornecedor(d, i, id)} />,
          ...mapas.map((m) => {
            const l = custo.get(`${m.rodada}:${id}`);
            return (
              <span key={m.rodada} className={s.numero}>
                {!l ? "—" : l.valida ? brl(l.custo) : `(${brl(l.custo)})`}
              </span>
            );
          }),
        ])}
      />
      {baixaram.length ? (
        <ul className={s.lista}>
          {baixaram.map((l) => (
            <li key={l.oferta.id}>
              {l.oferta.fornecedorNome} baixou o produto de {brl(l.oferta.produtoAnterior)} para {brl(l.produto)}.
            </li>
          ))}
        </ul>
      ) : null}
    </Bloco>
  );
}

export function AbaNegociacao({ d }: { d: DadosPedido }) {
  if (!d.itens.some(temNegociacao)) {
    const decidir = d.itens.find((i) => i.item.estado === "aguardando_decisao" && i.item.rodada < MAX_RODADAS);
    return (
      <GradePagina>
        <Column sm={4} md={8} lg={16}>
          <EstadoVazio
            titulo="Nenhuma negociação nesta cotação."
            proximoPasso={decidir ? "Para negociar, reprove por preço alto na Decisão." : "Uma negociação começa quando você reprova o mapa por preço alto."}
            acao={decidir ? { texto: "Ir para Decisão", href: hrefAba(d.pedido.id, "decisao", decidir.item.id), tipo: "tertiary" } : undefined}
          />
        </Column>
      </GradePagina>
    );
  }
  return (
    <GradePagina>
      <Column sm={4} md={8} lg={16}>
        <IndiceItens itens={d.itens} />
      </Column>
      {d.itens.map((i) => (
        <Column key={i.item.id} sm={4} md={8} lg={16}>
          <SecaoItem i={i}>
            {temNegociacao(i) ? (
              <>
                <RodadaAtual d={d} i={i} />
                <ComoOPrecoMudou d={d} i={i} />
                {i.item.rodada >= MAX_RODADAS ? <p className={s.ajuda}>Já foram {MAX_RODADAS} rodadas: é o limite de negociação para não cansar os fornecedores.</p> : null}
              </>
            ) : (
              <EstadoVazio compacto titulo="Nenhuma negociação neste item." />
            )}
            {i.item.estado === "aguardando_decisao" ? <Link href={hrefAba(d.pedido.id, "decisao", i.item.id)}>Decidir na etapa Pedido</Link> : null}
          </SecaoItem>
        </Column>
      ))}
    </GradePagina>
  );
}
