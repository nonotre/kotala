// Detalhes do pedido: número, título, a tabela de itens (cada um com os seus dados)
// e, fora da tabela, o que é do pedido inteiro: quando foi feito, entrega, prazo e urgência.

import { Bloco } from "@/components/Bloco";
import { Tabela } from "@/components/Tabela";
import type { DadosPedido } from "@/lib/dados-pedido";
import { dataHora } from "@/lib/formato";
import { textoPrazo, Urgencia } from "./CabecalhoPedido";
import { Campos } from "./Item";
import { StatusPedido } from "./Status";
import { tituloPedido } from "./textos";
import s from "./pedido.module.scss";

const numero = (q: number | string) => Number(q).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** "bitola: 10 mm", uma por linha. Sem especificação: travessão. */
function Especificacoes({ espec }: { espec: Record<string, string> }) {
  const pares = Object.entries(espec ?? {});
  if (!pares.length) return "—";
  return (
    <span className={s.celulaPilha}>
      {pares.map(([k, v]) => (
        <span key={k}>
          {k}: {v}
        </span>
      ))}
    </span>
  );
}

/** Os itens do pedido em tabela. Serve aos Detalhes e à confirmação do pedido. */
export function TabelaItens({ d, rotulo }: { d: DadosPedido; rotulo: string }) {
  return (
    <Tabela
      rotulo={rotulo}
      vazio={d.pedido.estado === "interpretando" ? "O assistente ainda está lendo a cotação." : "Esta cotação não tem itens."}
      colunas={["Item", "Descrição", "Quantidade", "Unidade", "Categoria", "Especificações", "Aceita equivalente"]}
      linhas={d.itens.map(({ item, categoria }) => [
        <span key="o" className={s.numero}>
          {item.ordem}
        </span>,
        item.descricao,
        <span key="q" className={s.numero}>
          {numero(item.quantidade)}
        </span>,
        item.unidade,
        categoria ?? "—",
        <Especificacoes key="e" espec={item.especificacao} />,
        item.aceitaSimilar ? "Sim" : "Não",
      ])}
    />
  );
}

export function DetalhesPedido({ d }: { d: DadosPedido }) {
  const { pedido: p } = d;
  const retirada = p.modoEntrega === "retirada";
  return (
    <Bloco titulo="Detalhes da cotação">
      <Campos
        linhas={[
          ["Número", String(p.id)],
          ["Título", tituloPedido(d)],
          ["Feita em", dataHora(p.criadoEm)],
          ["Situação", <StatusPedido key="s" estado={p.estado} />],
        ]}
      />
      <div className={s.grupo}>
        <h3 className={s.grupoTitulo}>Itens</h3>
        <TabelaItens d={d} rotulo={`Itens da cotação ${p.id}`} />
      </div>
      <div className={s.grupo}>
        <h3 className={s.grupoTitulo}>Entrega</h3>
        <Campos
          linhas={[
            ["Modo", retirada ? "Retirada na loja" : p.modoEntrega === "entrega" ? "Entrega no endereço" : "Não informado"],
            [retirada ? "Local de retirada" : "Endereço de entrega", p.destino ?? (retirada ? null : "Não informado")],
            ["CEP", p.cep],
            ["Janela de recebimento", p.janelaRecebimento],
            ["Setor", p.setor],
            ["Entregas combinadas", p.entregas],
          ]}
        />
      </div>
      <div className={s.grupo}>
        <h3 className={s.grupoTitulo}>Prazo e urgência</h3>
        <Campos
          linhas={[
            ["Prazo", textoPrazo(p) ?? "Não informado"],
            ["Urgência", p.urgencia !== "normal" ? <Urgencia key="u" urgencia={p.urgencia} /> : "Normal"],
          ]}
        />
      </div>
    </Bloco>
  );
}
