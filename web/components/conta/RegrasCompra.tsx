"use client";
// Regras de compra em vigor, só para ler. Os valores vêm do servidor (lib/regras.ts).

import { Column, Tag } from "@carbon/react";
import { Bloco } from "@/components/Bloco";
import { CorpoPagina, GradePagina, Pagina } from "@/components/Pagina";
import { Tabela } from "@/components/Tabela";
import type { GrupoRegras } from "@/lib/regras";
import { CabecalhoConta } from "./Comum";
import s from "./conta.module.scss";

export function RegrasCompra({ grupos }: { grupos: GrupoRegras[] }) {
  return (
    <Pagina>
      <CabecalhoConta ativa="regras" />
      <CorpoPagina>
        {grupos.map((g) => (
          <GradePagina key={g.titulo}>
            <Column sm={4} md={8} lg={16}>
              <Bloco titulo={g.titulo} descricao={g.descricao} plano>
                <Tabela
                  rotulo={g.titulo}
                  vazio="Nenhuma regra."
                  colunas={["Regra", "Valor", "Como funciona", "Onde muda"]}
                  linhas={g.regras.map((r) => [
                    <span key="n">
                      {r.nome}
                      {r.nova ? (
                        <>
                          {" "}
                          <Tag size="sm" type="teal">
                            Nova
                          </Tag>
                        </>
                      ) : null}
                    </span>,
                    <strong key="v">{r.valor}</strong>,
                    r.explicacao,
                    <span key="o" className={s.apoioLinha}>
                      {r.variavel ? <code>{r.variavel}</code> : "Fixa no código"}
                    </span>,
                  ])}
                />
              </Bloco>
            </Column>
          </GradePagina>
        ))}
      </CorpoPagina>
    </Pagina>
  );
}
