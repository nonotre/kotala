"use client";
// Cabeçalho com navegação; abaixo de telas largas, os links vão para o menu lateral.
import { Header, HeaderGlobalBar, HeaderMenuButton, HeaderMenuItem, HeaderName, HeaderNavigation, HeaderSideNavItems, SideNav, SideNavItems, SkipToContent, Tag } from "@carbon/react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import estilos from "./casca.module.scss";

const LINKS = [
  { href: "/", rotulo: "Quadro" },
  { href: "/pedidos", rotulo: "Pedidos" },
  { href: "/fornecedores", rotulo: "Fornecedores" },
  { href: "/economia", rotulo: "Economia" },
  { href: "/chat", rotulo: "Conversar" },
];

export function Casca() {
  const [aberto, setAberto] = useState(false);
  const caminho = usePathname();
  const ativo = (href: string) => (href === "/" ? caminho === "/" : caminho.startsWith(href));
  const itens = LINKS.map((l) => (
    <HeaderMenuItem key={l.href} href={l.href} isActive={ativo(l.href)} onClick={() => setAberto(false)}>
      {l.rotulo}
    </HeaderMenuItem>
  ));
  return (
    <Header aria-label="Kotala">
      <SkipToContent>Pular para o conteúdo</SkipToContent>
      <HeaderMenuButton aria-label={aberto ? "Fechar menu" : "Abrir menu"} isActive={aberto} onClick={() => setAberto((a) => !a)} aria-expanded={aberto} />
      <HeaderName href="/" prefix="">
        {/* Logo do Kotala, desenhada pela Liria */}
        <span className={estilos.marca}>
          <img src="/logo.svg" alt="Kotala" className={estilos.logo} />
          <span className={estilos.nome}>Cotações</span>
        </span>
      </HeaderName>
      <HeaderNavigation aria-label="Navegação">{itens}</HeaderNavigation>
      <HeaderGlobalBar>
        <div className={estilos.selo}>
          <Tag type="gray" size="sm" title="Fornecedores simulados aparecem marcados como simulados">
            Simulados marcados
          </Tag>
        </div>
      </HeaderGlobalBar>
      <SideNav aria-label="Menu" expanded={aberto} isPersistent={false} onSideNavBlur={() => setAberto(false)}>
        <SideNavItems>
          <HeaderSideNavItems>{itens}</HeaderSideNavItems>
        </SideNavItems>
      </SideNav>
    </Header>
  );
}
