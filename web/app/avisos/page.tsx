import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { CentralAvisos } from "@/components/operacao/CentralAvisos";
import { acontecidosRecentes, avisosComContexto, numerosOperacao } from "@/lib/dados-operacao";
import { usuarioDaSessao } from "@/lib/sessao-servidor";

export const dynamic = "force-dynamic";

// Por padrão, os avisos das cotações de quem entrou (dono ou responsável), como o sino; ?todos=1 mostra os de todos.
export default async function Avisos({ searchParams }: { searchParams: Promise<{ todos?: string }> }) {
  const todos = (await searchParams).todos === "1";
  const u = todos ? null : await usuarioDaSessao();
  const [avisos, acontecidos, numeros] = await Promise.all([avisosComContexto(u?.id ?? null), acontecidosRecentes(7, u?.id ?? null), numerosOperacao()]);
  return (
    <>
      <AtualizaSozinho segundos={3} />
      <CentralAvisos avisos={avisos} acontecidos={acontecidos} temPedidos={numeros.total > 0} todos={todos || !u} />
    </>
  );
}
