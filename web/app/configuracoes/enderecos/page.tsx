import { Suspense } from "react";
import { Enderecos } from "@/components/conta/Enderecos";

export default function Pagina() {
  return (
    // Lê ?novo=1, de "Adicionar local" na visão geral.
    <Suspense>
      <Enderecos />
    </Suspense>
  );
}
