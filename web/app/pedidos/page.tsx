import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { ListaPedidos, type Filtro } from "@/components/operacao/ListaPedidos";
import { pedidosOperacao } from "@/lib/dados-operacao";

export const dynamic = "force-dynamic";

const FILTROS_VALIDOS: Filtro[] = ["todos", "voce", "andando", "concluidos", "cancelados"];

export default async function Pedidos({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const pedido = (await searchParams).filtro as Filtro | undefined;
  const filtroInicial = pedido && FILTROS_VALIDOS.includes(pedido) ? pedido : "todos";
  const linhas = await pedidosOperacao();
  return (
    <>
      <AtualizaSozinho segundos={3} />
      <ListaPedidos linhas={linhas} filtroInicial={filtroInicial} />
    </>
  );
}
