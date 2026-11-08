import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { AlertasConduta } from "@/components/operacao/AlertasConduta";
import { alertasDeConduta } from "@/lib/dados-conduta";

export const dynamic = "force-dynamic";

/** S: alertas de conduta, para o gestor de compras. Os avisos em si vão ao gestor pelo canal dele. */
export default async function Conduta() {
  return (
    <>
      <AtualizaSozinho segundos={10} />
      <AlertasConduta dados={await alertasDeConduta()} />
    </>
  );
}
