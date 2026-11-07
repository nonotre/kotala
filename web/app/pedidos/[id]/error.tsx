"use client";

import { Column } from "@carbon/react";
import { EstadoErro } from "@/components/EstadoErro";
import { GradePagina } from "@/components/Pagina";

/** Uma aba quebrou: título, abas e o que falta agora continuam na tela, e dá para seguir para outra aba. */
export default function ErroDaAba({ retry }: { error: unknown; retry: () => void }) {
  return (
    <GradePagina>
      <Column sm={4} md={8} lg={16}>
        <EstadoErro titulo="Algo deu errado ao mostrar esta aba. Nada se perdeu." texto="Tente de novo, ou abra outra aba do pedido." aoTentar={retry} />
      </Column>
    </GradePagina>
  );
}
