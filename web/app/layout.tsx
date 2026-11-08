import type { Metadata } from "next";
import type { ReactNode } from "react";
import { empresaAtivaDe, listarEmpresas } from "../../src/contas.ts";
import { Casca } from "@/components/Casca";
import type { ContaDoTopo } from "@/components/conta/Guarda";
import { contarAvisos } from "@/lib/avisos";
import { usuarioDaSessao } from "@/lib/sessao-servidor";
import { ProvedorTema } from "@/lib/tema";
import { ATRIBUTO_TEMA, SCRIPT_TEMA, TEMA_PADRAO } from "@/lib/tema-base";
import "./globals.scss";

// A contagem do sino vem do banco a cada navegação.
export const dynamic = "force-dynamic";

// Sem título aqui: a casca põe o seu, com <title>, para o da rota não competir com este.
export const metadata: Metadata = { description: "Assistente de cotação de compras da empresa" };

/** Quem entrou (cookie) e a empresa em uso, para o topo. Sem banco, a casca fica sem o seletor. */
async function contaDoTopo(): Promise<ContaDoTopo> {
  const sessao = await usuarioDaSessao();
  if (!sessao) return { sessao: null, empresas: [], empresaAtiva: null };
  try {
    const [empresaAtiva, empresas] = await Promise.all([empresaAtivaDe(sessao.id), listarEmpresas()]);
    return { sessao, empresas: empresas.map((e) => ({ id: e.id, nome: e.nome })), empresaAtiva };
  } catch {
    return { sessao, empresas: [], empresaAtiva: null };
  }
}

export default async function Raiz({ children }: { children: ReactNode }) {
  const conta = await contaDoTopo();
  // O sino conta os avisos das cotações de quem entrou (dono ou responsável); a Central mostra os de todos com "Todos".
  const avisos = conta.sessao ? await contarAvisos(conta.sessao.id).catch(() => 0) : 0;
  return (
    // O script troca o atributo antes da hidratação, por isso o aviso fica suprimido só neste elemento.
    <html lang="pt-BR" {...{ [ATRIBUTO_TEMA]: TEMA_PADRAO }} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
        <link rel="preload" href="/fontes/IBMPlexSans-Regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fontes/IBMPlexSans-SemiBold.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <ProvedorTema>
          <Casca avisos={avisos} conta={conta}>
            {children}
          </Casca>
        </ProvedorTema>
      </body>
    </html>
  );
}
