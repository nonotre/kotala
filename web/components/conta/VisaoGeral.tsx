"use client";

import { Column, Link as CarbonLink, preview__IconIndicator as IconIndicator } from "@carbon/react";
import { ArrowRight } from "@carbon/react/icons";
import NextLink from "next/link";
import { Bloco } from "@/components/Bloco";
import { EstadoVazio } from "@/components/EstadoVazio";
import { CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { AvisoDemonstracao, CabecalhoConta, Campo, plural } from "./Comum";
import { useConta } from "./demo";
import { Gestores } from "./Gestores";
import { SuaConta } from "./SuaConta";
import s from "./conta.module.scss";

/** Visão geral: o que mais pesa na cotação é onde a compra chega. O resto é consulta. */
export function VisaoGeral() {
  const { empresa, locais, convites } = useConta();
  const padrao = locais.find((l) => l.padrao) ?? locais[0];
  const pessoas = empresa.usuarios.length + convites.length;

  return (
    <Pagina>
      <CabecalhoConta ativa="visao" />
      <CorpoPagina>
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <SuaConta />
          </Column>
        </GradePagina>
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Gestores />
          </Column>
        </GradePagina>
        <AvisoDemonstracao />
        <GradePagina>
          <Column sm={4} md={8} lg={16}>
            <Bloco
              titulo="Onde as suas compras chegam"
              descricao="Os fornecedores cotam e calculam o frete até este local."
              acao={
                padrao ? (
                  <CarbonLink as={NextLink} href="/configuracoes/enderecos" renderIcon={ArrowRight}>
                    {locais.length === 1 ? "Ver o local" : `Ver os ${locais.length} locais`}
                  </CarbonLink>
                ) : undefined
              }
            >
              {padrao ? (
                <>
                  <div className={s.destaque}>
                    <h3 className={s.destaqueNome}>{padrao.apelido}</h3>
                    <IconIndicator kind="succeeded" label="Local padrão" size={16} />
                  </div>
                  <dl className={s.camposQuatro}>
                    <Campo rotulo="Endereço">{padrao.endereco}</Campo>
                    <Campo rotulo="CEP">{padrao.cep}</Campo>
                    <Campo rotulo="Janela de recebimento">{padrao.janela || "A confirmar"}</Campo>
                    <Campo rotulo="Restrição de acesso">{padrao.restricao}</Campo>
                  </dl>
                </>
              ) : (
                <EstadoVazio
                  tamanho="sm"
                  headingAs="h3"
                  titulo="Nenhum local de entrega ainda."
                  proximoPasso={`Cadastre onde ${empresa.nome} recebe. O frete é calculado até o CEP dele.`}
                  acao={{ texto: "Adicionar local", href: "/configuracoes/enderecos?novo=1", tipo: "tertiary" }}
                />
              )}
            </Bloco>
          </Column>
        </GradePagina>

        <GradePagina className={s.gradeIgual}>
          <Column sm={4} md={4} lg={8}>
            <Bloco titulo="Faturamento" descricao="Fica separado do local que recebe e não entra na conta do frete.">
              <dl className={s.campos}>
                <Campo rotulo="Razão social" largo>{empresa.faturamento.razaoSocial}</Campo>
                <Campo rotulo="Endereço" largo>{empresa.faturamento.endereco}</Campo>
                <Campo rotulo="CEP">{empresa.faturamento.cep}</Campo>
                <Campo rotulo="CNPJ (fictício)">{empresa.cnpj}</Campo>
              </dl>
            </Bloco>
          </Column>
          <Column sm={4} md={4} lg={8}>
            <Bloco
              titulo="Empresa e acesso"
              descricao="Em qual empresa você compra e quem mais acessa."
              acao={
                <CarbonLink as={NextLink} href="/configuracoes/empresas" renderIcon={ArrowRight}>
                  Ver empresas
                </CarbonLink>
              }
            >
              <dl className={s.campos}>
                <Campo rotulo="Empresa em uso" largo>{empresa.nome}</Campo>
                <Campo rotulo="Quem acessa" largo>{plural(pessoas, "pessoa", "pessoas")}</Campo>
              </dl>
            </Bloco>
          </Column>
        </GradePagina>
      </CorpoPagina>
    </Pagina>
  );
}
