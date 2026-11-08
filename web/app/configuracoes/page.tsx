import { VisaoGeral } from "@/components/conta/VisaoGeral";
import { dadosDaConta } from "@/lib/contas";

export const dynamic = "force-dynamic";

export default async function Pagina() {
  return <VisaoGeral conta={await dadosDaConta()} />;
}
