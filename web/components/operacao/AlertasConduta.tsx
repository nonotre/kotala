"use client";
// Alertas de conduta: o que os guardrails barraram do lado do comprador e os sinais de risco
// lidos nas respostas dos fornecedores, com o bloqueio do fornecedor na própria linha.

import { Column, Link as CarbonLink, Tag } from "@carbon/react";
import NextLink from "next/link";
import { AcoesFornecedor } from "@/components/AcoesFornecedor";
import { Bloco } from "@/components/Bloco";
import { CabecalhoPagina, CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { SeloSimulado } from "@/components/SeloSimulado";
import { Tabela } from "@/components/Tabela";
import type { CasoComprador, Conduta } from "@/lib/dados-conduta";
import { dataHora } from "@/lib/formato";
import s from "./conduta.module.scss";

type Cor = "red" | "magenta" | "purple" | "blue" | "gray" | "cool-gray";

/** Classes do guardrail (src/agentes/guardrail) e marcadores do rastro. */
const CLASSE: Record<string, { texto: string; cor: Cor }> = {
  proibido: { texto: "Item proibido", cor: "red" },
  controlado: { texto: "Produto controlado", cor: "red" },
  condicao_irregular: { texto: "Condição irregular", cor: "magenta" },
  saida_barrada: { texto: "Mensagem barrada antes do fornecedor", cor: "magenta" },
  injecao: { texto: "Tentou mudar as regras", cor: "magenta" },
  ofensa: { texto: "Mensagem hostil", cor: "purple" },
  fora_do_escopo: { texto: "Fora do escopo", cor: "cool-gray" },
  ambiguo: { texto: "Pedido ambíguo", cor: "cool-gray" },
  consulta: { texto: "Consulta", cor: "gray" },
  pedido: { texto: "Pedido", cor: "gray" },
  resposta_fixa: { texto: "Resposta fixa", cor: "purple" },
  aviso_gestor: { texto: "Aviso ao gestor", cor: "blue" },
};

/** Alertas do Extrator (ALERTAS em src/agentes/extrator/index.ts). */
const ALERTA: Record<string, { texto: string; cor: Cor }> = {
  sem_nota: { texto: "Sem nota fiscal", cor: "red" },
  item_irregular: { texto: "Item irregular", cor: "red" },
  propina: { texto: "Propina ou comissão", cor: "red" },
  combinacao_preco: { texto: "Combinação de preço", cor: "red" },
  pagamento_por_fora: { texto: "Pagamento por fora", cor: "red" },
  pede_dados: { texto: "Pede dados sigilosos", cor: "magenta" },
  produto_controlado: { texto: "Produto controlado", cor: "red" },
  link_suspeito: { texto: "Link suspeito", cor: "magenta" },
};

const rotulo = <T extends string>(mapa: Record<string, { texto: string; cor: Cor }>, chave: T) => mapa[chave] ?? { texto: chave.replace(/_/g, " "), cor: "gray" as Cor };

const linkPedido = (id: number | null) =>
  id ? (
    <CarbonLink as={NextLink} href={`/pedidos/${id}`}>
      Cotação {id}
    </CarbonLink>
  ) : (
    <span className={s.apoio}>Sem pedido</span>
  );

function situacaoDoCaso(c: CasoComprador) {
  if (c.classe !== "aviso_gestor") return c.motivo;
  return c.enviado ? "Mensagem enviada ao gestor." : c.motivo;
}

export function AlertasConduta({ dados }: { dados: Conduta }) {
  const graves = dados.fornecedor.filter((a) => rotulo(ALERTA, a.alerta).cor === "red" && !a.bloqueado).length;
  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Alertas de conduta"
        contexto={`Solicitações barradas pelos guardrails e fornecedores com sinal de risco na resposta.${graves ? ` ${graves === 1 ? "1 alerta grave" : `${graves} alertas graves`} de fornecedor ainda não bloqueado.` : ""}`}
      />
      <CorpoPagina>
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco
              titulo="Fornecedores"
              descricao="Lido nas respostas: venda sem nota, item irregular, propina, combinação de preço, pagamento por fora, pedido de dados, produto controlado e link suspeito. Bloquear tira o fornecedor das próximas buscas e da recompra; as cotações em andamento continuam."
              plano
            >
              <Tabela
                rotulo="Alertas de fornecedor"
                vazio="Nenhum alerta de fornecedor até agora."
                colunas={["Quando", "Fornecedor", "Alerta", "Cotação e item", "Ação"]}
                linhas={dados.fornecedor.map((a) => {
                  const r = rotulo(ALERTA, a.alerta);
                  return [
                    <span key="q" className={s.quando}>
                      {dataHora(a.em)}
                    </span>,
                    <span key="f">
                      <CarbonLink as={NextLink} href={`/fornecedores/${a.fornecedorId}`}>
                        {a.fornecedor}
                      </CarbonLink>
                      {a.simulado ? <SeloSimulado /> : null}
                      {a.bloqueado ? <span className={s.apoio}>Bloqueado{a.motivoBloqueio ? `: ${a.motivoBloqueio}` : ""}</span> : null}
                    </span>,
                    <span key="a">
                      <Tag size="sm" type={r.cor}>
                        {r.texto}
                      </Tag>
                      {a.texto ? <span className={s.trecho}>&ldquo;{a.texto}&rdquo;</span> : null}
                    </span>,
                    <span key="p">
                      {linkPedido(a.pedidoId)}
                      {a.item ? <span className={s.apoio}>{a.item}</span> : null}
                    </span>,
                    <AcoesFornecedor key="b" id={a.fornecedorId} nome={a.fornecedor} homologado={a.homologado} bloqueado={a.bloqueado} soBloqueio />,
                  ];
                })}
              />
            </Bloco>
          </Column>
        </GradePagina>
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco
              titulo="Compradores"
              descricao="O que os guardrails barraram ou desviaram nas mensagens de quem compra: item proibido ou controlado, condição irregular, tentativa de mudar as regras, mensagem hostil, pedido fora do escopo. Dado pessoal aparece mascarado."
              plano
            >
              <Tabela
                rotulo="Casos dos guardrails"
                vazio="Nenhum caso dos guardrails até agora."
                colunas={["Quando", "Quem", "Caso", "O que o assistente fez", "Cotação"]}
                linhas={dados.comprador.map((c) => {
                  const r = rotulo(CLASSE, c.classe);
                  return [
                    <span key="q" className={s.quando}>
                      {dataHora(c.em)}
                    </span>,
                    c.quem ?? <span className={s.apoio}>Sem nome</span>,
                    <span key="c" className={s.etiquetas}>
                      <Tag size="sm" type={r.cor}>
                        {r.texto}
                      </Tag>
                      {c.subtipo ? <span className={s.apoio}>{c.subtipo.replace(/_/g, " ")}</span> : null}
                    </span>,
                    <span key="o">
                      {c.acao}
                      <span className={s.apoio}>{situacaoDoCaso(c)}</span>
                      {c.trecho ? <span className={s.trecho}>&ldquo;{c.trecho}&rdquo;</span> : null}
                    </span>,
                    linkPedido(c.pedidoId),
                  ];
                })}
              />
            </Bloco>
          </Column>
        </GradePagina>
      </CorpoPagina>
    </Pagina>
  );
}
