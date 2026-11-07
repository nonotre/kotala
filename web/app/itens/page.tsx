import { BaseItens } from "@/components/consulta/BaseItens";
import { itensDaBase } from "@/lib/dados-consulta";

export const dynamic = "force-dynamic";

/** E6: itens já pedidos, comprados ou cadastrados pelo assistente. */
export default async function Itens({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const { item } = await searchParams;
  const itens = await itensDaBase();
  return <BaseItens itens={itens} itemInicial={item ?? null} />;
}
