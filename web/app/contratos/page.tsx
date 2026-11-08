import { dadosContratos } from "@/components/contratos/dados";
import { TelaContratos } from "@/components/contratos/TelaContratos";

export const dynamic = "force-dynamic";

/** X2: contratos anuais (listar, criar, encerrar). */
export default async function Contratos() {
  return <TelaContratos dados={await dadosContratos()} />;
}
