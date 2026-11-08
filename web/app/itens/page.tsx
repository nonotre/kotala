import { BaseItens } from "@/components/consulta/BaseItens";
import { categoriasDaBase, itensDaBase } from "@/lib/dados-consulta";

export const dynamic = "force-dynamic";

type Busca = { item?: string; busca?: string; categoria?: string };

/** Base de Dados, aba Itens (E6): itens já pedidos, comprados ou cadastrados pelo assistente. */
export default async function Itens({ searchParams }: { searchParams: Promise<Busca> }) {
  const { item, busca, categoria } = await searchParams;
  const [itens, categorias] = await Promise.all([itensDaBase(), categoriasDaBase()]);
  return <BaseItens itens={itens} categorias={categorias} itemInicial={item ?? null} filtrosIniciais={{ busca: busca ?? "", categoria: categoria ?? "" }} />;
}
