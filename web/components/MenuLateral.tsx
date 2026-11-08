"use client";

import { SideNav, SideNavDivider, SideNavItems, SideNavLink } from "@carbon/react";
import { Analytics, Chat, DataBase, Home, Logout, QrCode, Security, Settings } from "@carbon/react/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sair as sairDaConta } from "./conta/sessao";
import s from "./casca.module.scss";

type Item = { href: string; rotulo: string; icone: typeof Home };

// O trabalho: as cotações no Início (quadro e lista) e as conversas com o assistente em Conversar.
const TRABALHO: Item[] = [
  { href: "/", rotulo: "Início", icone: Home },
  { href: "/chat", rotulo: "Conversar", icone: Chat },
];

const CONSULTA: Item[] = [
  { href: "/fornecedores", rotulo: "Base de Dados", icone: DataBase },
  { href: "/conduta", rotulo: "Alertas de conduta", icone: Security },
  { href: "/dashboard", rotulo: "Dashboard", icone: Analytics },
  { href: "/convite", rotulo: "Convite", icone: QrCode },
];

/** Endereços antigos que redirecionam para o Início. */
const ANTIGOS_DO_INICIO = ["/pedidos", "/quadro"];

function ativo(rota: string, href: string) {
  // Uma cotação é aberta a partir do Início, e a ligação por voz é de uma cotação.
  if (href === "/") return rota === "/" || ANTIGOS_DO_INICIO.includes(rota) || rota.startsWith("/pedidos/") || rota.startsWith("/voz/");
  // Base de Dados: as abas Fornecedores e Itens, e a ficha de cada fornecedor.
  if (href === "/fornecedores") return rota === "/fornecedores" || rota.startsWith("/fornecedores/") || rota === "/itens";
  if (href === "/chat") return rota === "/chat" || rota === "/conversas";
  return rota === href || rota.startsWith(`${href}/`);
}

type Props = {
  /** Aberto como sobreposição, pelo botão do Header: abaixo de `lg`, ou no trilho do pedido. */
  aberto: boolean;
  /** Com rótulos. A partir de `lg` fora do pedido, vale a escolha do usuário; senão, é o mesmo que `aberto`. */
  expandido: boolean;
  aoFechar: () => void;
};

/** Menu principal. Sempre um trilho de 48 px que se expande (rótulos, 16 rem): fixo a partir de `lg`, sobreposição nos demais casos. */
export function MenuLateral({ aberto, expandido, aoFechar }: Props) {
  const rota = usePathname();

  const item = (l: Item) => {
    const marcado = ativo(rota, l.href);
    return (
      <SideNavLink key={l.href} as={Link} href={l.href} renderIcon={l.icone} isActive={marcado} aria-current={marcado ? "page" : undefined} onClick={aoFechar}>
        {l.rotulo}
      </SideNavLink>
    );
  };

  return (
    <>
      {aberto ? <div className={s.veu} aria-hidden="true" onClick={aoFechar} /> : null}
      <SideNav
        aria-label="Menu principal"
        isRail
        expanded={expandido}
        onOverlayClick={aoFechar}
        className={`cds--g100 ${s.menu} ${aberto ? "" : s.recolhido}`}
      >
        <SideNavItems className={s.itensMenu}>
          {TRABALHO.map(item)}
          <SideNavDivider />
          {CONSULTA.map(item)}
          <SideNavDivider className={s.contaNoFim} />
          {item({ href: "/configuracoes", rotulo: "Configurações", icone: Settings })}
          <SideNavLink
            as={Link}
            href="/login"
            renderIcon={Logout}
            onClick={(e: { preventDefault: () => void }) => {
              // A ida a /login espera o servidor apagar a sessão (senão o proxy volta ao Início).
              e.preventDefault();
              aoFechar();
              void sairDaConta();
            }}
          >
            Sair
          </SideNavLink>
        </SideNavItems>
      </SideNav>
    </>
  );
}
