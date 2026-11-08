import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Casca } from "@/components/Casca";
import { contarAvisos } from "@/lib/avisos";
import { ProvedorTema } from "@/lib/tema";
import { ATRIBUTO_TEMA, SCRIPT_TEMA, TEMA_PADRAO } from "@/lib/tema-base";
import "./globals.scss";

// A contagem do sino vem do banco a cada navegação.
export const dynamic = "force-dynamic";

// Sem título aqui: a casca põe o seu, com <title>, para o da rota não competir com este.
export const metadata: Metadata = { description: "Assistente de cotação de compras da empresa" };

export default async function Raiz({ children }: { children: ReactNode }) {
  const avisos = await contarAvisos().catch(() => 0);
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
          <Casca avisos={avisos}>{children}</Casca>
        </ProvedorTema>
      </body>
    </html>
  );
}
