"use client";

import { ContentSwitcher, Switch } from "@carbon/react";
import { useRouter } from "next/navigation";
import type { AbaPedido } from "./textos";
import s from "./pedido.module.scss";

/**
 * Segundo nível dentro de uma parte do pedido (Resumo e Histórico; Busca e Cotações; Comparação e Negociação).
 * Seleção manual: as setas só movem o foco, e Enter ou espaço abre a tela. Sem isso, cada seta viraria navegação.
 */
export function TrocaVista({ rotulo, itens, ativa }: { rotulo: string; itens: AbaPedido[]; ativa: string }) {
  const router = useRouter();
  const visiveis = itens.filter((a) => !a.oculta || a.id === ativa);
  // Uma tela só, ou endereço que não é de nenhuma delas (página não encontrada): sem alternador.
  if (visiveis.length < 2 || !visiveis.some((a) => a.id === ativa)) return null;
  return (
    <div className={s.trocaVista}>
      <ContentSwitcher
        size="md"
        selectionMode="manual"
        aria-label={rotulo}
        selectedIndex={visiveis.findIndex((a) => a.id === ativa)}
        onChange={({ name }) => {
          const a = visiveis.find((x) => x.id === name);
          if (a && a.id !== ativa) router.push(a.href);
        }}
      >
        {visiveis.map((a) => (
          <Switch key={a.id} name={a.id} text={a.rotulo} />
        ))}
      </ContentSwitcher>
    </div>
  );
}
