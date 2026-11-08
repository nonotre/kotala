import { Suspense } from "react";
import { Enderecos } from "@/components/conta/Enderecos";
import { dadosDaConta } from "@/lib/contas";

export const dynamic = "force-dynamic";

export default async function Pagina() {
  const conta = await dadosDaConta();
  return (
    // Lê ?novo=1, de "Adicionar local" na visão geral.
    <Suspense>
      <Enderecos conta={conta} />
    </Suspense>
  );
}
