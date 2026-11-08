"use client";
// Peças comuns às telas da conta (Configurações): cabeçalho com abas, aviso de demonstração, campos e confirmação.

import { Button, Column, InlineNotification, Tag } from "@carbon/react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Abas } from "@/components/Abas";
import { CabecalhoPagina, GradePagina } from "@/components/Pagina";
import { AVISO_DEMONSTRACAO, recomecarDemonstracao } from "./demo";
import s from "./conta.module.scss";

const CONTEXTO = {
  visao: "Onde você recebe, onde fatura e quem acessa a conta.",
  enderecos: "O local que recebe e o endereço de faturamento ficam separados.",
  empresas: "As empresas em que você compra e quem acessa cada uma.",
};

/** Selo curto de demonstração, para o cabeçalho e a entrada. */
export function SeloDemonstracao() {
  return (
    <Tag type="warm-gray" size="md" title="Nada desta tela é salvo no servidor">
      {AVISO_DEMONSTRACAO}
    </Tag>
  );
}

/** Cabeçalho comum às três abas: o título fica parado, e só a aba e a frase mudam. */
export function CabecalhoConta({ ativa, lado }: { ativa: keyof typeof CONTEXTO; lado?: ReactNode }) {
  return (
    <CabecalhoPagina
      titulo="Configurações"
      contexto={CONTEXTO[ativa]}
      lado={
        <span className={s.lado}>
          <SeloDemonstracao />
          {lado}
        </span>
      }
      abas={
        <Abas
          ativa={ativa}
          rotulo="Seções de Configurações"
          itens={[
            { id: "visao", rotulo: "Visão geral", href: "/configuracoes" },
            { id: "enderecos", rotulo: "Endereços", href: "/configuracoes/enderecos" },
            { id: "empresas", rotulo: "Empresas", href: "/configuracoes/empresas" },
          ]}
        />
      }
    />
  );
}

/** No topo do corpo, em todo tamanho de tela: deixa claro que a conta ainda é demonstração. */
export function AvisoDemonstracao() {
  return (
    <GradePagina>
      <Column sm={4} md={8} lg={16}>
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={`${AVISO_DEMONSTRACAO}.`}
          subtitle="A sua conta já fica no servidor; empresas e endereços ainda não. O que você mudar aqui fica só neste navegador, com dados fictícios."
          statusIconDescription="Informação"
          className={s.avisoLargo}
        />
        <div className={s.recomecar}>
          <Button kind="ghost" size="sm" onClick={recomecarDemonstracao}>
            Recomeçar a demonstração
          </Button>
        </div>
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
          subtitle={feito.texto ? `${feito.texto} Só neste navegador.` : "Só neste navegador."}
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
