import type { Metadata } from "next";
import { Casca } from "@/components/Casca";
import { Content } from "@/components/carbon";
import "./globals.scss";
import estilos from "./layout.module.scss";

export const metadata: Metadata = { title: "Kotala · Cotações", description: "Assistente de cotação de material de obra" };

export default function Raiz({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-tema="claro">
      <body>
        <Casca />
        <Content id="main-content" className={estilos.conteudo}>
          {children}
        </Content>
      </body>
    </html>
  );
}
