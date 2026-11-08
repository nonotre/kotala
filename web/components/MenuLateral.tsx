"use client";

import { SideNav, SideNavDivider, SideNavItems, SideNavLink } from "@carbon/react";
import { Analytics, Chat, Dashboard, DeliveryParcel, Home, Logout, Partnership, QrCode, Settings } from "@carbon/react/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sair as sairDaConta } from "./conta/sessao";
import s from "./casca.module.scss";

type Item = { href: string; rotulo: string; icone: typeof Home };

const TRABALHO: Item[] = [
  { href: "/", rotulo: "Início", icone: Home },
  { href: "/quadro", rotulo: "Quadro", icone: Dashboard },
  { href: "/chat", rotulo: "Conversar", icone: Chat },
];

const CONSULTA: Item[] = [
  { href: "/fornecedores", rotulo: "Fornecedores", icone: Partnership },
  { href: "/itens", rotulo: "Itens", icone: DeliveryParcel },
  { href: "/dashboard", rotulo: "Dashboard", icone: Analytics },
  { href: "/convite", rotulo: "Convite", icone: QrCode },
];

function ativo(rota: string, href: string) {
  if (href === "/") return rota === "/";
  // Quadro e Lista são o mesmo item; um pedido é visto a partir do quadro, e a ligação por voz é de um pedido.
  if (href === "/quadro") return rota === "/quadro" || rota === "/pedidos" || rota.startsWith("/pedidos/") || rota.startsWith("/voz/");
  return rota === href || rota.startsWith(`${href}/`);
}

type Props = {
  /** Aberto pelo botão do Header, abaixo de `lg` e no trilho. */
  aberto: boolean;
  aoFechar: () => void;
};

/** Menu principal. Com rótulos a partir de `lg`; dentro de um pedido, trilho de 48 px, porque o mapa precisa da largura. */
export function MenuLateral({ aberto, aoFechar }: Props) {
  const rota = usePathname();
  const noPedido = /^\/pedidos\/[^/]+/.test(rota);

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
        isRail={noPedido}
        isFixedNav={!noPedido}
        expanded={noPedido ? aberto : true}
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
            onClick={() => {
              aoFechar();
              sairDaConta();
            }}
          >
            Sair
          </SideNavLink>
        </SideNavItems>
      </SideNav>
    </>
  );
}
