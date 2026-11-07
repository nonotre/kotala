import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { CentralAvisos } from "@/components/operacao/CentralAvisos";
import { acontecidosRecentes, avisosComContexto, numerosOperacao } from "@/lib/dados-operacao";

export const dynamic = "force-dynamic";

export default async function Avisos() {
  const [avisos, acontecidos, numeros] = await Promise.all([avisosComContexto(), acontecidosRecentes(), numerosOperacao()]);
  return (
    <>
      <AtualizaSozinho segundos={3} />
      <CentralAvisos avisos={avisos} acontecidos={acontecidos} temPedidos={numeros.total > 0} />
    </>
  );
}
