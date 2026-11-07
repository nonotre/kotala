"use client";
// Ficha do fornecedor: o que ele está fazendo agora, se dá para confiar, o que mandou e o que já foi comprado dele.

import { Column, Link as CarbonLink, preview__IconIndicator as IconIndicator } from "@carbon/react";
import NextLink from "next/link";
import type { ReactNode } from "react";
import { AcoesFornecedor } from "@/components/AcoesFornecedor";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { LinkExterno } from "@/components/LinkExterno";
import { CabecalhoPagina, CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { SeloSimulado } from "@/components/SeloSimulado";
import { Tabela } from "@/components/Tabela";
import type { CotacaoDaFicha, FichaFornecedor as Ficha } from "@/lib/dados-consulta";
import { brl, dataHora, dias, nota, quantidade } from "@/lib/formato";
import { Confianca, ROTULO_CANAL, estadoDoCanal, type Kind } from "./marcas";
import s from "./consulta.module.scss";

const SITUACAO: Record<string, { kind: Kind; rotulo: string }> = {
  aguardando: { kind: "pending", rotulo: "Aguardando resposta" },
  respondeu: { kind: "succeeded", rotulo: "Respondeu" },
  sem_resposta: { kind: "unknown", rotulo: "Sem resposta" },
  parou: { kind: "failed", rotulo: "Pediu para parar" },
  desistiu: { kind: "incomplete", rotulo: "Desistiu" },
  encerrada: { kind: "normal", rotulo: "Encerrada" },
};

const FRETE: Record<string, string> = { informado: "informado", estimado: "estimado", nao_se_aplica: "não se aplica" };

const data = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <dt className={s.rotulo}>{rotulo}</dt>
      <dd className={s.valor}>{children}</dd>
    </div>
  );
}

// ---------- Agora ----------

type Situacao = { kind: Kind; frase: string; apoio?: string; cotacao?: CotacaoDaFicha };

/** Uma frase: o que este fornecedor está fazendo agora. Só com o que o banco tem. */
function lerSituacao(f: Ficha): Situacao {
  if (f.bloqueadoEm) return { kind: "failed", frase: "Bloqueado.", apoio: `${f.motivoBloqueio ?? "Sem motivo registrado"}. Desde ${dataHora(f.bloqueadoEm)}. Não entra nas buscas nem na recompra.` };
  if (f.parouEm) return { kind: "failed", frase: "Pediu para parar.", apoio: `Desde ${dataHora(f.parouEm)}. Nada mais é enviado a este fornecedor, em nenhum canal.` };
  const aberta = f.cotacoes.find((c) => c.estadoItem === "cotando" && c.situacao === "aguardando" && c.rodada === c.rodadaAtual);
  if (aberta) return { kind: "pending", frase: `Recebeu a cotação do pedido ${aberta.pedidoId}. Ainda não respondeu.`, apoio: aberta.enviadaEm ? `Enviada em ${dataHora(aberta.enviadaEm)}.` : undefined, cotacao: aberta };
  const respondendo = f.cotacoes.find((c) => c.estadoItem === "cotando" && c.situacao === "respondeu" && c.rodada === c.rodadaAtual);
  if (respondendo) return { kind: "informative", frase: `Mandou proposta no pedido ${respondendo.pedidoId}.`, apoio: "A cotação ainda está aberta: o mapa sai quando o prazo terminar.", cotacao: respondendo };
  const ultima = f.cotacoes[0];
  if (ultima) {
    if (ultima.escolhido) return { kind: "succeeded", frase: `A proposta dele foi a escolhida no pedido ${ultima.pedidoId}.`, cotacao: ultima };
    const sit = SITUACAO[ultima.situacao];
    return { kind: sit?.kind ?? "normal", frase: `Última cotação, no pedido ${ultima.pedidoId}: ${(sit?.rotulo ?? ultima.situacao).toLowerCase()}.`, cotacao: ultima };
  }
  const canal = estadoDoCanal({ ...f, canais: f.contatos.map((c) => (c.parouEm ? `${c.canal} (parou)` : c.canal)), canaisAtivos: f.contatos.filter((c) => !c.parouEm).length });
  if (canal.peso === 0) return { kind: "not-started", frase: "Não recebeu nenhuma cotação ainda.", apoio: "A próxima chega no canal dele." };
  return { kind: "not-started", frase: "Sem canal: não recebe cotação.", apoio: "Entra como referência de preço. Para cotar com ele, mande o convite." };
}

function Agora({ f }: { f: Ficha }) {
  const sit = lerSituacao(f);
  const c = sit.cotacao;
  return (
    <Bloco
      titulo={c ? `Agora, no pedido ${c.pedidoId}` : "Agora"}
      descricao={c ? `${quantidade(c.quantidade, c.unidade)} de ${c.item}` : undefined}
      acao={
        c ? (
          <CarbonLink as={NextLink} href={`/pedidos/${c.pedidoId}#item-${c.itemId}`}>
            Ver o pedido {c.pedidoId}
          </CarbonLink>
        ) : undefined
      }
    >
      <div className={s.situacao}>
        <span className={s.situacaoIcone}>
          <IconIndicator kind={sit.kind} label="" size={20} />
        </span>
        <div className={s.situacaoTexto}>
          <p className={s.situacaoFrase}>{sit.frase}</p>
          {sit.apoio ? <p className={s.apoioCorpo}>{sit.apoio}</p> : null}
        </div>
      </div>
      <div className={s.acoes}>
        {c?.podeLigar && !f.bloqueadoEm && !f.parouEm ? (
          <CarbonLink as={NextLink} href={`/voz/${c.id}`}>
            Ligar por voz
          </CarbonLink>
        ) : null}
        {!c && !f.contatos.length && !f.simulado ? (
          <CarbonLink as={NextLink} href="/convite">
            Convidar fornecedor
          </CarbonLink>
        ) : null}
      </div>
    </Bloco>
  );
}

// ---------- Cotações ----------

function CelulaProposta({ c }: { c: CotacaoDaFicha }) {
  const p = c.proposta;
  if (!p) return <span className={s.semValor}>—</span>;
  return (
    <span className={s.duasLinhas}>
      {p.custo !== null ? (
        <span className={s.numero}>{brl(p.custo)} com frete</span>
      ) : p.totalProduto !== null ? (
        <span className={s.numero}>{brl(p.totalProduto)} o produto</span>
      ) : (
        <span className={s.numero}>{p.precoUnitario !== null ? `${brl(p.precoUnitario)} por ${c.unidade}` : "Sem preço"}</span>
      )}
      {p.precoUnitario !== null && (p.custo !== null || p.totalProduto !== null) ? <span className={s.apoio}>{brl(p.precoUnitario)} por {c.unidade}</span> : null}
      {p.frete !== null || p.origemFrete ? (
        <span className={s.apoio}>
          Frete {p.frete !== null ? brl(p.frete) : ""}
          {p.origemFrete ? ` ${FRETE[p.origemFrete] ?? p.origemFrete}` : ""}
        </span>
      ) : null}
      <span className={s.apoio}>{p.itemOferecido}</span>
      {c.escolhido ? <IconIndicator kind="succeeded" label="Escolhida" size={16} /> : null}
      {p.valida === false ? <span className={s.alerta}>Fora do mapa: {p.motivos.join("; ")}</span> : null}
    </span>
  );
}

function Cotacoes({ f }: { f: Ficha }) {
  return (
    <Bloco
      titulo="Cotações e propostas"
      descricao={f.cotacoes.length ? `${f.cotacoes.length} ${f.cotacoes.length === 1 ? "cotação enviada" : "cotações enviadas"}, da mais nova à mais antiga.${f.ofertasAvulsas ? ` E ${f.ofertasAvulsas} ${f.ofertasAvulsas === 1 ? "proposta" : "propostas"} sem cotação enviada.` : ""}` : undefined}
    >
      <Tabela
        rotulo="Cotações enviadas a este fornecedor"
        vazio={f.ofertasAvulsas ? `Nenhuma cotação enviada. ${f.ofertasAvulsas} ${f.ofertasAvulsas === 1 ? "proposta veio" : "propostas vieram"} de outra forma.` : "Nenhuma cotação enviada a este fornecedor."}
        colunas={["Pedido", "Item", "Situação", "Proposta", "Prazo e pagamento", "Nota", ""]}
        destaque={f.cotacoes.flatMap((c, i) => (c.escolhido ? [i] : []))}
        linhas={f.cotacoes.map((c) => {
          const sit = SITUACAO[c.situacao] ?? { kind: "normal" as Kind, rotulo: c.situacao };
          return [
            <CarbonLink key="p" as={NextLink} href={`/pedidos/${c.pedidoId}#item-${c.itemId}`}>
              Pedido {c.pedidoId}
            </CarbonLink>,
            <span key="i" className={s.duasLinhas}>
              <span>
                {quantidade(c.quantidade, c.unidade)} de {c.item}
              </span>
              {c.rodada > 1 ? <span className={s.apoio}>Rodada {c.rodada}</span> : null}
            </span>,
            <span key="s" className={s.duasLinhas}>
              <IconIndicator kind={sit.kind} label={sit.rotulo} size={16} />
              {c.enviadaEm ? <span className={s.apoioRecuado}>Enviada {dataHora(c.enviadaEm)}</span> : null}
              {c.respondeuEm ? <span className={s.apoioRecuado}>Respondeu {dataHora(c.respondeuEm)}</span> : null}
            </span>,
            <CelulaProposta key="o" c={c} />,
            c.proposta ? (
              <span key="z" className={s.duasLinhas}>
                <span>{c.proposta.prazoDias !== null ? dias(c.proposta.prazoDias) : "Prazo não informado"}</span>
                {c.proposta.pagamento ? <span className={s.apoio}>{c.proposta.pagamento}</span> : null}
              </span>
            ) : (
              "—"
            ),
            c.proposta?.nota !== null && c.proposta?.nota !== undefined ? <span key="n" className={s.numero}>{nota(c.proposta.nota)}</span> : "—",
            c.podeLigar && !f.bloqueadoEm && !f.parouEm ? (
              <CarbonLink key="v" as={NextLink} href={`/voz/${c.id}`}>
                Ligar por voz
              </CarbonLink>
            ) : null,
          ];
        })}
      />
    </Bloco>
  );
}

// ---------- Compras ----------

function Compras({ f }: { f: Ficha }) {
  return (
    <Bloco titulo="Compras com este fornecedor">
      {f.compras.length === 0 ? (
        <EstadoVazio compacto titulo="Nenhuma compra com este fornecedor." />
      ) : (
        <ul className={s.compras}>
          {f.compras.map((h) => (
            <li key={h.id} className={s.compra}>
              <div className={s.compraTopo}>
                <h3 className={s.compraTitulo}>{h.descricao}</h3>
                <span className={s.apoioCorpo}>{data(h.data)}</span>
                {h.simulado ? <SeloSimulado texto="histórico simulado" /> : null}
                {h.pedidoId ? (
                  <CarbonLink as={NextLink} href={`/pedidos/${h.pedidoId}${h.itemId ? `#item-${h.itemId}` : ""}`}>
                    Pedido {h.pedidoId}
                  </CarbonLink>
                ) : null}
              </div>
              <dl className={s.numeros}>
                <div className={s.destaque}>
                  <dt className={s.rotulo}>Total, com frete</dt>
                  <dd className={s.valor}>{brl(Math.round((h.precoUnitario * h.quantidade + (h.frete ?? 0)) * 100) / 100)}</dd>
                </div>
                <Dado rotulo="Preço">{brl(h.precoUnitario)}</Dado>
                <Dado rotulo="Quantidade">{h.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</Dado>
                <Dado rotulo="Frete">{h.frete !== null ? brl(h.frete) : "Não informado"}</Dado>
                {h.prazoPrometidoDias !== null ? (
                  <Dado rotulo="Prazo prometido">
                    {dias(h.prazoPrometidoDias)}
                    {h.prazoCumprido === null ? "" : h.prazoCumprido ? ", cumprido" : ", não cumprido"}
                  </Dado>
                ) : null}
              </dl>
              {h.experiencia ? <p className={s.texto}>{h.experiencia}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}

// ---------- Verificação e homologação ----------

function Verificacao({ f }: { f: Ficha }) {
  const v = f.verificacao;
  return (
    <Bloco titulo="Verificação e homologação">
      <section className={s.parte} aria-label="Verificação">
        <Confianca simulado={f.simulado} verificacao={v} />
        {f.simulado ? (
          <p className={s.apoioCorpo}>Fornecedor da base fictícia do time: não há o que conferir.</p>
        ) : (
          <>
            {v?.motivos?.length ? (
              <ul className={s.motivos}>
                {v.motivos.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null}
            {v?.alertas?.length ? <p className={s.alerta}>{v.alertas.join("; ")}</p> : null}
            <dl className={s.ficha}>
              <Dado rotulo="CNPJ">{f.cnpj ?? "Não informado"}</Dado>
              <Dado rotulo="CNPJ ativo">{f.verificado ? "Sim" : "Não conferido"}</Dado>
              {v?.razaoSocial ? <Dado rotulo="Razão social">{v.razaoSocial}</Dado> : null}
              {v?.municipio ? (
                <Dado rotulo="Município">
                  {v.municipio}
                  {v.uf ? `, ${v.uf}` : ""}
                </Dado>
              ) : null}
              {v?.fonte ? (
                <Dado rotulo="Conferido em">
                  <span className={s.quebra}>{v.fonte}</span>
                </Dado>
              ) : null}
              {v?.em ? <Dado rotulo="Quando">{dataHora(v.em)}</Dado> : null}
            </dl>
            <p className={s.apoio}>Verificar só confere se a empresa existe e está ativa. Não é aprovação.</p>
          </>
        )}
      </section>
      <section className={s.parte} aria-label="Homologação e bloqueio">
        <IconIndicator kind={f.homologado ? "succeeded" : "not-started"} label={f.homologado ? "Homologado" : "Não homologado"} size={16} />
        <p className={s.texto}>Sua aprovação formal, para as próximas compras.</p>
        {f.bloqueadoEm ? (
          <>
            <IconIndicator kind="failed" label="Bloqueado" size={16} />
            <p className={s.apoioCorpo}>
              {f.motivoBloqueio ?? "Sem motivo registrado"}. Desde {dataHora(f.bloqueadoEm)}.
            </p>
          </>
        ) : null}
        <AcoesFornecedor id={f.id} nome={f.nome} homologado={f.homologado} bloqueado={!!f.bloqueadoEm} />
      </section>
    </Bloco>
  );
}

function Sancoes({ f }: { f: Ficha }) {
  if (f.simulado) return null;
  const sc = f.sancoes;
  return (
    <Bloco titulo="Sanções" descricao="Listas de empresas punidas do Portal da Transparência (CEIS e CNEP), pela raiz do CNPJ.">
      {!f.cnpj ? (
        <EstadoVazio compacto titulo="Sem CNPJ para consultar." />
      ) : !sc ? (
        <EstadoVazio compacto titulo="A base de sanções não está carregada." />
      ) : sc.lista.length === 0 ? (
        <EstadoVazio compacto titulo={`Nenhuma sanção para este CNPJ${sc.base ? ` (base de ${sc.base})` : ""}.`} />
      ) : (
        <Tabela
          rotulo="Sanções do fornecedor"
          tamanho="sm"
          vazio="Nenhuma sanção."
          colunas={["Cadastro", "Categoria", "Órgão", "Vigência", "Unidade"]}
          linhas={sc.lista.map((x) => [x.cadastro, x.categoria ?? "—", `${x.orgao ?? "—"}${x.uf ? `, ${x.uf}` : ""}`, `${x.inicio ?? "?"} a ${x.fim ?? "sem fim"}`, x.mesmaUnidade ? "Esta" : "Outra, mesma empresa"])}
        />
      )}
    </Bloco>
  );
}

function Contato({ f }: { f: Ficha }) {
  return (
    <Bloco titulo="Contato">
      {f.contatos.length ? (
        <ul className={s.listaSimples}>
          {f.contatos.map((c) => (
            <li key={c.id} className={s.duasLinhas}>
              <IconIndicator kind={c.parouEm ? "failed" : "succeeded"} label={`${ROTULO_CANAL[c.canal] ?? c.canal}${c.parouEm ? ": parou" : ""}`} size={16} />
              <span className={s.apoioRecuado}>
                {c.nome ? `${c.nome}. ` : ""}Desde {dataHora(c.desde)}
                {c.avisoPrivacidadeEm ? ". Viu o aviso de privacidade" : ""}
                {c.parouEm ? `. Parou em ${dataHora(c.parouEm)}` : ""}.
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EstadoVazio compacto titulo="Nenhum canal ainda." />
      )}
      <dl className={s.ficha}>
        <Dado rotulo="E-mail">
          <span className={s.quebra}>{f.email ?? "Não informado"}</span>
        </Dado>
        <Dado rotulo="Fonte">{f.fonte?.startsWith("http") ? <LinkExterno href={f.fonte}>{f.fonte.replace(/^https?:\/\//, "")}</LinkExterno> : <span className={s.quebra}>{f.fonte ?? "Não informada"}</span>}</Dado>
        {f.regiao ? <Dado rotulo="Região">{f.regiao}</Dado> : null}
        {f.cep ? <Dado rotulo="CEP">{f.cep}</Dado> : null}
        {f.temConvitePessoal ? <Dado rotulo="Convite">Link pessoal gerado</Dado> : null}
        <Dado rotulo="Na base desde">{dataHora(f.criadoEm)}</Dado>
      </dl>
    </Bloco>
  );
}

// ---------- Tela ----------

export function FichaFornecedor({ f }: { f: Ficha }) {
  const canal = estadoDoCanal({ ...f, canais: f.contatos.map((c) => (c.parouEm ? `${c.canal} (parou)` : c.canal)), canaisAtivos: f.contatos.filter((c) => !c.parouEm).length });
  const v = f.verificacao;
  const contexto = [v?.razaoSocial, v?.municipio ? `${v.municipio}${v.uf ? `, ${v.uf}` : ""}` : f.regiao, f.cnpj ? `CNPJ ${f.cnpj}` : null].filter(Boolean).join(" · ");
  return (
    <Pagina>
      <CabecalhoPagina
        trilha={[{ rotulo: "Fornecedores", href: "/fornecedores" }, { rotulo: f.nome }]}
        titulo={
          <span className={s.titulo}>
            {f.nome}
            {f.simulado ? <SeloSimulado /> : null}
          </span>
        }
        contexto={contexto || undefined}
        lado={<IconIndicator kind={canal.kind} label={canal.peso === 0 ? `${canal.rotulo}: ${canal.apoio}` : canal.rotulo} size={16} />}
      />
      <CorpoPagina>
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Agora f={f} />
          </Column>
        </GradePagina>
        <GradePagina>
          <Column sm={4} md={8} lg={16} xlg={11} className={s.principal}>
            <div>
              <Cotacoes f={f} />
            </div>
            <div>
              <Compras f={f} />
            </div>
          </Column>
          <Column sm={4} md={8} lg={16} xlg={5} className={s.lateral}>
            <div>
              <Verificacao f={f} />
            </div>
            {f.simulado ? null : (
              <div>
                <Sancoes f={f} />
              </div>
            )}
            <div>
              <Contato f={f} />
            </div>
          </Column>
        </GradePagina>
      </CorpoPagina>
    </Pagina>
  );
}
