"use client";
// Peças comuns às telas da conta (Configurações): cabeçalho com abas, campos, confirmação e formato do CEP.
// Empresas e locais de entrega moram no banco (Bloco 4); as ações estão em lib/contas.ts.

import { Column, InlineNotification } from "@carbon/react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Abas } from "@/components/Abas";
import { CabecalhoPagina, GradePagina } from "@/components/Pagina";
import type { ContaCompleta } from "@/lib/contas";
import s from "./conta.module.scss";

const CONTEXTO = {
  visao: "Onde você recebe, onde fatura e quem acessa a conta.",
  enderecos: "O local que recebe e o endereço de faturamento ficam separados.",
  empresas: "As empresas em que você compra e quem trabalha em cada uma.",
  regras: "As regras de compra em vigor, para consulta. Mudam no .env do servidor.",
};

/** Cabeçalho comum às abas: o título fica parado, e só a aba e a frase mudam. */
export function CabecalhoConta({ ativa, lado }: { ativa: keyof typeof CONTEXTO; lado?: ReactNode }) {
  return (
    <CabecalhoPagina
      titulo="Configurações"
      contexto={CONTEXTO[ativa]}
      lado={lado ? <span className={s.lado}>{lado}</span> : undefined}
      abas={
        <Abas
          ativa={ativa}
          rotulo="Seções de Configurações"
          itens={[
            { id: "visao", rotulo: "Visão geral", href: "/configuracoes" },
            { id: "enderecos", rotulo: "Endereços", href: "/configuracoes/enderecos" },
            { id: "empresas", rotulo: "Empresas", href: "/configuracoes/empresas" },
            { id: "regras", rotulo: "Regras de compra", href: "/configuracoes/regras" },
          ]}
        />
      }
    />
  );
}

/** Erro de uma ação (o servidor recusou ou caiu), no topo do corpo, como a confirmação. */
export function AvisoErro({ erro, aoFechar }: { erro: string | null; aoFechar: () => void }) {
  if (!erro) return null;
  return (
    <GradePagina>
      <Column sm={4} md={8} lg={16}>
        <InlineNotification kind="error" lowContrast title={erro} statusIconDescription="Erro" onCloseButtonClick={aoFechar} className={s.avisoLargo} />
      </Column>
    </GradePagina>
  );
}

/** Rótulo em cima, valor embaixo. Dentro de um `dl`. */
export function Campo({ rotulo, largo = false, children }: { rotulo: string; largo?: boolean; children: ReactNode }) {
  return (
    <div className={largo ? `${s.campo} ${s.campoLargo}` : s.campo}>
      <dt className={s.campoRotulo}>{rotulo}</dt>
      <dd className={s.campoValor}>{children}</dd>
    </div>
  );
}

// ---------- Confirmação de uma ação ----------

export type Feito = { chave: number; titulo: string; texto?: string };

/** A confirmação da ação. A chave faz cada ação aparecer de novo, mesmo com o mesmo texto. */
export function useFeito() {
  const contador = useRef(0);
  const [feito, setFeito] = useState<Feito | null>(null);
  const confirmar = useCallback((titulo: string, texto?: string) => {
    contador.current += 1;
    setFeito({ chave: contador.current, titulo, texto });
  }, []);
  const limpar = useCallback(() => setFeito(null), []);
  return { feito, confirmar, limpar };
}

/** No topo do corpo: não cobre o título, a lista nem a ação principal. Fica até fechar ou até a próxima ação. */
export function AvisoFeito({ feito, aoFechar }: { feito: Feito | null; aoFechar: () => void }) {
  if (!feito) return null;
  return (
    <GradePagina>
      <Column sm={4} md={8} lg={16}>
        <InlineNotification
          key={feito.chave}
          kind="success"
          lowContrast
          title={feito.titulo}
          subtitle={feito.texto}
          statusIconDescription="Feito"
          onCloseButtonClick={aoFechar}
          className={s.avisoLargo}
        />
      </Column>
    </GradePagina>
  );
}

export function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

// ---------- A empresa em uso ----------

/** A empresa ativa de quem entrou, os locais dela e quem trabalha nela. */
export function daEmpresaAtiva(conta: ContaCompleta) {
  const empresa = conta.empresas.find((e) => e.id === conta.empresaAtiva) ?? conta.empresas[0]!;
  return {
    empresa,
    locais: conta.locais.filter((l) => l.empresaId === empresa.id),
    pessoas: conta.pessoas.filter((p) => p.empresaId === empresa.id),
  };
}

/** Campo opcional vazio: diz que falta, em vez de deixar o espaço em branco. */
export const ouAConfirmar = (v: string | null | undefined, texto = "A confirmar") => v || texto;

// ---------- Formato ----------

/** 8 números, com o hífen. */
export function formatarCep(texto: string): string {
  const n = texto.replace(/\D/g, "").slice(0, 8);
  return n.length > 5 ? `${n.slice(0, 5)}-${n.slice(5)}` : n;
}

export function cepValido(cep: string): boolean {
  return /^\d{5}-\d{3}$/.test(cep);
}
