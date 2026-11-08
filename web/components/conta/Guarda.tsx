"use client";
// Frente 2: proteção das rotas e o nome de quem entrou, para a casca.
// Sem sessão neste navegador, toda rota manda para /login. A checagem é só no navegador, de propósito.

import { HeaderGlobalAction } from "@carbon/react";
import { UserAvatar } from "@carbon/react/icons";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { conferirSessao } from "@/lib/contas";
import { sair, useSessao } from "./sessao";

/** Manda para /login sem sessão; confere uma vez por carga se a conta ainda existe no banco. */
export function useGuardaSessao() {
  const sessao = useSessao();
  const rota = usePathname();
  const router = useRouter();
  const conferida = useRef<string | null>(null);

  useEffect(() => {
    if (sessao === undefined) return;
    if (!sessao) {
      if (rota !== "/login") router.replace("/login");
      return;
    }
    if (conferida.current === sessao.id) return;
    conferida.current = sessao.id;
    conferirSessao(sessao.id)
      .then((ok) => {
        if (!ok) sair();
      })
      .catch(() => {
        // Sem banco, fica com o que o navegador sabe.
      });
  }, [sessao, rota, router]);

  return sessao;
}

/** Botão do topo: mostra quem entrou e leva às configurações da conta. */
export function QuemEntrou() {
  const sessao = useSessao();
  const router = useRouter();
  if (!sessao) return null;
  return (
    <HeaderGlobalAction aria-label={`Entrou como ${sessao.nome} (${sessao.login})`} tooltipAlignment="end" onClick={() => router.push("/configuracoes")}>
      <UserAvatar size={20} />
    </HeaderGlobalAction>
  );
}
