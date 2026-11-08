import { Empresas } from "@/components/conta/Empresas";
import { dadosDaConta } from "@/lib/contas";

export const dynamic = "force-dynamic";

export default async function Pagina() {
  return <Empresas conta={await dadosDaConta()} />;
}
