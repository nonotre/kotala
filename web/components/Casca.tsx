"use client";
// Casca do app: Header e menu em zona escura nos dois temas. As telas só trazem o conteúdo.

import { Content, Header, HeaderGlobalAction, HeaderGlobalBar, HeaderMenuButton, HeaderName, SkipToContent, Tag } from "@carbon/react";
import { Asleep, Light, Notification } from "@carbon/react/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTema } from "@/lib/tema";
import { MenuLateral } from "./MenuLateral";
import s from "./casca.module.scss";

const NOME_PRODUTO = "Kotala";
/** O `lg` do Carbon: a partir daí, o menu não é mais sobreposição: alterna entre expandido e trilho. */
const A_PARTIR_DE_LG = "(min-width: 66rem)";
/** Onde o navegador guarda a escolha do menu (fora do pedido, a partir de `lg`). */
const CHAVE_MENU = "kotala-menu";

const NOMES_ABA: Record<string, string> = { busca: "Busca", cotacoes: "Propostas", comparacao: "Mapa de cotações", negociacao: "Negociação", decisao: "Decisão", historico: "Histórico", solicitado: "Solicitada", compra: "Compra" };

const NOMES_ROTA: Record<string, string> = {
  "/": "Início",
  "/fornecedores": "Fornecedores",
  "/itens": "Itens",
  "/economia": "Economia",
  "/dashboard": "Dashboard",
  "/avisos": "Avisos",
  "/convite": "Convite",
  "/configuracoes": "Configurações",
  "/configuracoes/enderecos": "Endereços",
  "/configuracoes/empresas": "Empresas",
  "/login": "Entrar",
};

/** Título da guia, com pedido e aba. */
function tituloDaRota(rota: string): string {
  const pedido = rota.match(/^\/pedidos\/(\d+)(?:\/([a-z]+))?/);
  if (pedido) return [`Cotação ${pedido[1]}`, NOMES_ABA[pedido[2] ?? ""]].filter(Boolean).join(", ");
  if (rota.startsWith("/fornecedores/")) return "Ficha do fornecedor";
  if (rota.startsWith("/voz/")) return "Ligação por voz";
  return NOMES_ROTA[rota] ?? NOME_PRODUTO;
}

function Sino({ n }: { n: number }) {
  const router = useRouter();
  const aqui = usePathname() === "/avisos";
  const rotulo = n === 0 ? "Avisos" : n === 1 ? "1 aviso precisa de você" : `${n} avisos precisam de você`;
  return (
    <HeaderGlobalAction aria-label={rotulo} isActive={aqui} aria-current={aqui ? "page" : undefined} onClick={() => router.push("/avisos")}>
      <span className={s.sino}>
        <Notification size={20} />
        {n ? (
          <span className={s.sinoConta} aria-hidden="true">
            {n > 99 ? "99+" : n}
          </span>
        ) : null}
      </span>
    </HeaderGlobalAction>
  );
}

function TrocaTema() {
  const { escuro, alternarTema } = useTema();
  return (
    <HeaderGlobalAction aria-label={escuro ? "Usar tema claro" : "Usar tema escuro"} onClick={alternarTema}>
      {escuro ? <Light size={20} /> : <Asleep size={20} />}
    </HeaderGlobalAction>
  );
}

export function Casca({ children, avisos }: { children: ReactNode; avisos: number }) {
  const rota = usePathname();
  // Menu aberto como sobreposição (abaixo de `lg`, ou o trilho expandido no pedido). Não vale para o menu fixo.
  const [aberto, setAberto] = useState(false);
  // Escolha do usuário a partir de `lg`, fora do pedido: trilho de ícones em vez do menu com rótulos.
  const [trilho, setTrilho] = useState(false);
  // Começa em `true`, como o HTML do servidor: o CSS cuida do celular, e o efeito corrige no cliente.
  const [largo, setLargo] = useState(true);
  const noPedido = /^\/pedidos\/[^/]+/.test(rota);
  const rotaAnterior = useRef(rota);

  useEffect(() => {
    setAberto(false);
    // Troca de rota leva o foco ao conteúdo. Na primeira carga, fica onde o navegador pôs.
    // Compara a rota, e não a vez do efeito: em desenvolvimento, o StrictMode roda o efeito duas vezes.
    if (rotaAnterior.current === rota) return;
    rotaAnterior.current = rota;
    document.getElementById("conteudo")?.focus({ preventScroll: true });
  }, [rota]);

  useEffect(() => {
    // Sem armazenamento (janela privada, dados bloqueados), fica o padrão: expandido. Um quadro de pulo na carga é aceito.
    try {
      if (window.localStorage.getItem(CHAVE_MENU) === "trilho") setTrilho(true);
    } catch {}
  }, []);

  useEffect(() => {
    const largura = window.matchMedia(A_PARTIR_DE_LG);
    setLargo(largura.matches);
    // Ao cruzar lg, o menu muda de forma: a sobreposição aberta não pode ficar para trás.
    const aoCruzar = () => {
      setLargo(largura.matches);
      setAberto(false);
    };
    largura.addEventListener("change", aoCruzar);
    return () => largura.removeEventListener("change", aoCruzar);
  }, []);

  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setAberto(false);
      document.querySelector<HTMLElement>("[data-botao-menu]")?.focus();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  // Sobreposição: abaixo de lg, e no pedido (o trilho expandido empresta a largura, o mapa não se mexe).
  // Fora disso, a partir de lg, o menu é fixo e o conteúdo acompanha a largura dele.
  const sobreposicao = !largo || noPedido;
  const expandido = sobreposicao ? aberto : !trilho;

  const alternarMenu = () => {
    if (sobreposicao) {
      setAberto(!aberto);
      return;
    }
    setTrilho(!trilho);
    try {
      window.localStorage.setItem(CHAVE_MENU, trilho ? "expandido" : "trilho");
    } catch {}
  };

  const titulo = <title>{`${tituloDaRota(rota)} · ${NOME_PRODUTO}`}</title>;

  // A entrada fica fora da casca: sem menu, sem sino.
  if (rota === "/login") {
    return (
      <>
        {titulo}
        <main id="conteudo" className={s.conteudoLogin}>
          {children}
        </main>
      </>
    );
  }

  return (
    <>
      {titulo}
      <Header aria-label={NOME_PRODUTO} className="cds--g100">
        <SkipToContent href="#conteudo">Pular para o conteúdo</SkipToContent>
        <HeaderMenuButton aria-label={expandido ? "Fechar menu" : "Abrir menu"} aria-expanded={expandido} isActive={expandido} isCollapsible onClick={alternarMenu} data-botao-menu="" />
        <HeaderName as={Link} href="/" prefix="">
          {/* Logo do Kotala, desenhada pela Liria; a versão branca vai sobre a casca escura. */}
          <span className={s.marca}>
            <img src="/logo-branco.svg" alt="Kotala" className={s.logo} />
          </span>
        </HeaderName>
        <HeaderGlobalBar>
          <div className={s.seloFicticio}>
            <Tag type="outline" size="sm" title="Fornecedores simulados aparecem marcados como simulados">
              Simulados marcados
            </Tag>
          </div>
          <Sino n={avisos} />
          <TrocaTema />
        </HeaderGlobalBar>
      </Header>
      <MenuLateral aberto={aberto} expandido={expandido} aoFechar={() => setAberto(false)} />
      {/* Só a sobreposição aberta cobre o conteúdo (e então o teclado também não passa por trás); o menu fixo não cobre. */}
      <Content id="conteudo" tabIndex={-1} inert={sobreposicao && aberto} className={`${s.conteudo} ${noPedido || trilho ? s.comTrilho : s.comMenu}`}>
        {children}
      </Content>
    </>
  );
}
