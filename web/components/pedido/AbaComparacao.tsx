// Aba Comparação: o mapa de cotação calculado em código (uma coluna por proposta
// válida), a recomendação do assistente com os pesos, de onde vem a nota e o que
// ficou fora da comparação.

import { Column, InlineNotification, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tile } from "@carbon/react";
import { CheckmarkFilled } from "@carbon/react/icons";
import type { ReactNode } from "react";
import { ROTULO_CRITERIO, type Criterio } from "../../../src/agentes/comparador/calculo.ts";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { GradePagina } from "@/components/Pagina";
import { SeloIA } from "@/components/SeloIA";
import { Tabela } from "@/components/Tabela";
import type { Linha } from "@/lib/dados";
import type { DadosPedido, ItemDoPedido } from "@/lib/dados-pedido";
import { brl, nota } from "@/lib/formato";
import { BotaoLink } from "./BotaoLink";
import { chatDoFornecedor, Fornecedor, IndiceItens, SecaoItem, textoDias } from "./Item";
import { Status } from "./Status";
import { hrefAba } from "./textos";
import s from "./pedido.module.scss";

const CRITERIOS: Criterio[] = ["preco", "prazo", "confianca", "aderencia", "pagamento"];

type Verificacao = { nivel?: string; pontos?: number } | null | undefined;

const textoFrete = (l: Linha) => (l.origemFrete === "nao_se_aplica" ? "Retirada" : `${brl(l.frete)} (${l.origemFrete})`);

const confianca = (l: Linha, v: Verificacao) => (l.oferta.simulado ? "simulado" : v?.nivel ? `${v.nivel} (${v.pontos})` : "—");

const negociado = (l: Linha) => !!l.oferta.produtoAnterior && l.produto !== null && l.oferta.produtoAnterior - l.produto >= 0.01;

function Melhor({ texto }: { texto: string }) {
  return (
    <span className={s.melhor}>
      <CheckmarkFilled size={16} aria-hidden="true" />
      {texto}
    </span>
  );
}

/** O mapa: linhas são os critérios, colunas são as propostas válidas. A recomendada vem primeiro. */
function Mapa({ d, i }: { d: DadosPedido; i: ItemDoPedido }) {
  const c = i.mapa!.comparacao;
  const comparaveis = c.validas.length >= 3;
  const menorPrazo = Math.min(...c.validas.map((l) => l.oferta.prazoDias ?? Infinity));
  const linhas: [string, (l: Linha) => ReactNode][] = [
    [
      "Custo total",
      (l) => (
        <>
          <span className={s.custo}>{brl(l.custo)}</span>
          {comparaveis && c.maisBarata?.oferta.id === l.oferta.id ? <Melhor texto="mais barata" /> : null}
          {negociado(l) ? <span className={s.ajudaCelula}>Negociado: produto era {brl(l.oferta.produtoAnterior)}</span> : null}
        </>
      ),
    ],
    ["Produto", (l) => brl(l.produto)],
    ["Frete", textoFrete],
    [
      "Entrega",
      (l) => (
        <>
          {textoDias(l.oferta.prazoDias)}
          {comparaveis && l.oferta.prazoDias !== null && l.oferta.prazoDias === menorPrazo ? <Melhor texto="mais rápida" /> : null}
        </>
      ),
    ],
    ["Pagamento", (l) => l.oferta.pagamento ?? "—"],
    ["Confiança", (l) => confianca(l, i.verificacoes[l.oferta.fornecedorId] as Verificacao)],
    ["Nota", (l) => <span className={s.custo}>{nota(l.nota)}</span>],
    ["Item oferecido", (l) => (l.oferta.itemExato ? "O pedido" : `Equivalente: ${l.oferta.itemOferecido}`)],
    [
      "Alertas",
      (l) =>
        l.alertas.length ? (
          <span className={s.alerta}>
            <Status tipo="caution-minor" rotulo={`Atenção: ${l.alertas.join("; ")}`} />
          </span>
        ) : (
          "—"
        ),
    ],
  ];
  return (
    <div className={s.mapaRolagem}>
      <Table size="md" aria-label={`Mapa de cotação do item ${i.item.ordem}`} className={s.mapa}>
        <TableHead>
          <TableRow>
            <TableHeader>
              <span className={s.somenteLeitor}>Critério</span>
            </TableHeader>
            {c.validas.map((l, n) => (
              <TableHeader key={l.oferta.id} className={n === 0 ? s.colunaRecomendada : undefined}>
                <Fornecedor nome={l.oferta.fornecedorNome} simulado={l.oferta.simulado} online={l.oferta.online} chat={chatDoFornecedor(d, i, l.oferta.fornecedorId)} />
                {n === 0 ? <span className={s.rotuloRecomendada}>{c.podeDizerMelhor ? "Recomendada" : "Na frente"}</span> : null}
              </TableHeader>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {linhas.map(([rotulo, celula]) => (
            <TableRow key={rotulo}>
              <TableCell className={s.criterio}>{rotulo}</TableCell>
              {c.validas.map((l, n) => (
                <TableCell key={l.oferta.id} className={n === 0 ? s.colunaRecomendada : undefined}>
                  {celula(l)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** A recomendação do assistente: o texto vem da IA, os números vêm do código. */
function Recomendacao({ d, i }: { d: DadosPedido; i: ItemDoPedido }) {
  const { item, mapa } = i;
  const c = mapa!.comparacao;
  const v = c.vencedora;
  const excluidos = item.excluidos.map((id) => d.fornecedores[id]?.nome).filter(Boolean);
  return (
    <Tile
      className={s.recomendacao}
      decorator={
        <SeloIA titulo="O texto é do assistente; as contas são do código.">
          A nota soma os critérios com os pesos abaixo. O assistente só redige a justificativa, sem números novos.
        </SeloIA>
      }
    >
      <p className={s.recomendacaoRotulo}>Recomendação do assistente</p>
      {v ? (
        <>
          <p className={s.recomendacaoFrase}>
            {c.podeDizerMelhor ? "Recomendo" : "Na frente"}: <Fornecedor nome={v.oferta.fornecedorNome} simulado={v.oferta.simulado} online={v.oferta.online} />
          </p>
          <p className={s.custoGrande}>{brl(v.custo)}</p>
          <p className={s.ajuda}>Custo total com frete{v.oferta.prazoDias !== null ? `, entrega em ${textoDias(v.oferta.prazoDias)}` : ""}.</p>
          {c.aMaisQueAMaisBarata > 0 ? <p className={s.texto}>Custa {brl(c.aMaisQueAMaisBarata)} a mais que a mais barata.</p> : null}
        </>
      ) : null}
      <p className={s.texto}>{mapa!.recomendacao}</p>
      <p className={s.ajuda}>
        Pesos: preço {c.pesos.preco}, prazo {c.pesos.prazo}, confiança {c.pesos.confianca}, aderência {c.pesos.aderencia}, pagamento {c.pesos.pagamento}
        {c.urgente ? " (prazo em dobro: pedido urgente)" : ""}.
      </p>
      {item.justificativaMenosDeTres ? <p className={s.ajuda}>{item.justificativaMenosDeTres}</p> : null}
      {item.negociacao && item.negociacao.rodada === item.rodada ? (
        <p className={s.ajuda}>
          Negociação na rodada {item.rodada}: {item.negociacao.motivo}
        </p>
      ) : null}
      {item.excluidos.length ? (
        <p className={s.ajuda}>
          {item.excluidos.length === 1 ? "1 fornecedor foi tirado" : `${item.excluidos.length} fornecedores foram tirados`} deste mapa por você{excluidos.length ? `: ${excluidos.join(", ")}` : ""}.
        </p>
      ) : null}
      {item.estado === "aguardando_decisao" && v ? (
        <div className={s.acoes}>
          <BotaoLink href={hrefAba(d.pedido.id, "decisao", item.id)} kind="primary">
            Ir para Decisão
          </BotaoLink>
        </div>
      ) : null}
    </Tile>
  );
}

function DeOndeVemANota({ d, i }: { d: DadosPedido; i: ItemDoPedido }) {
  const c = i.mapa!.comparacao;
  const comCriterios = c.validas.filter((l) => l.criterios);
  if (!comCriterios.length) return null;
  return (
    <Bloco titulo="De onde vem a nota" descricao="Cada critério vai de 0 a 100 e pesa o que diz o cabeçalho. A nota é a média ponderada.">
      <Tabela
        rotulo={`Critérios da nota do item ${i.item.ordem}`}
        tamanho="sm"
        vazio="Sem critérios."
        destaque={[0]}
        colunas={["Fornecedor", ...CRITERIOS.map((k) => `${ROTULO_CRITERIO[k]} (${c.pesos[k]})`), "Nota"]}
        linhas={comCriterios.map((l) => [
          <Fornecedor key="f" nome={l.oferta.fornecedorNome} simulado={l.oferta.simulado} online={l.oferta.online} chat={chatDoFornecedor(d, i, l.oferta.fornecedorId)} />,
          ...CRITERIOS.map((k) => (
            <span key={k} className={s.numero}>
              {nota(l.criterios![k])}
            </span>
          )),
          <strong key="n" className={s.numero}>
            {nota(l.nota)}
          </strong>,
        ])}
      />
    </Bloco>
  );
}

function ForaDaComparacao({ d, i }: { d: DadosPedido; i: ItemDoPedido }) {
  const c = i.mapa!.comparacao;
  if (!c.cortadas.length) return null;
  return (
    <Bloco titulo="Fora da comparação" descricao="Propostas que não passaram nas regras do mapa, com o motivo.">
      <Tabela
        rotulo={`Propostas fora do mapa do item ${i.item.ordem}`}
        vazio="Nenhuma proposta cortada."
        apagadas={c.cortadas.map((_, n) => n)}
        colunas={["Fornecedor", "Custo", "Motivo"]}
        linhas={c.cortadas.map((l) => [<Fornecedor key="f" nome={l.oferta.fornecedorNome} simulado={l.oferta.simulado} online={l.oferta.online} chat={chatDoFornecedor(d, i, l.oferta.fornecedorId)} />, brl(l.custo), l.motivos.join("; ")])}
      />
    </Bloco>
  );
}

function vazioDoItem(i: ItemDoPedido): string {
  if (i.item.estado === "comparando") return "O assistente está montando o mapa.";
  if (i.item.estado === "cotando") return "O mapa aparece quando as propostas chegarem.";
  if (i.item.estado === "aguardando_recompra") return "Compra repetida: sem mapa até você escolher no Resumo.";
  if (i.item.estado === "cancelado") return "Item cancelado sem mapa.";
  if (i.item.estado === "sem_proposta") return "Nenhuma proposta chegou para montar o mapa.";
  return "Ainda não há mapa para este item.";
}

export function AbaComparacao({ d }: { d: DadosPedido }) {
  return (
    <GradePagina>
      <Column sm={4} md={8} lg={16}>
        <IndiceItens itens={d.itens} />
      </Column>
      {d.itens.map((i) => {
        const c = i.mapa?.comparacao;
        return (
          <Column key={i.item.id} sm={4} md={8} lg={16}>
            <SecaoItem i={i}>
              {c ? (
                <div className={s.divisao}>
                  <Bloco titulo={`Mapa de cotação${i.mapa!.rodada > 1 ? `, rodada ${i.mapa!.rodada}` : ""}: ${c.validas.length} ${c.validas.length === 1 ? "proposta válida" : "propostas válidas"}`}>
                    {c.alertasGerais.length ? <InlineNotification kind="warning" lowContrast hideCloseButton title="Atenção:" subtitle={c.alertasGerais.join("; ")} statusIconDescription="Aviso" /> : null}
                    {c.validas.length ? <Mapa d={d} i={i} /> : <EstadoVazio compacto titulo="Nenhuma proposta válida neste mapa." />}
                  </Bloco>
                  <div className={s.painelPreso}>
                    <Recomendacao d={d} i={i} />
                  </div>
                  <div className={s.inteira}>
                    <DeOndeVemANota d={d} i={i} />
                  </div>
                  <div className={s.inteira}>
                    <ForaDaComparacao d={d} i={i} />
                  </div>
                </div>
              ) : (
                <EstadoVazio compacto titulo={vazioDoItem(i)} />
              )}
            </SecaoItem>
          </Column>
        );
      })}
    </GradePagina>
  );
}
