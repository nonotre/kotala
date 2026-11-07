import { ListaFornecedores, type Filtro } from "@/components/consulta/ListaFornecedores";
import { fornecedoresDaLista } from "@/lib/dados-consulta";

export const dynamic = "force-dynamic";

const FILTROS: Filtro[] = ["todos", "com-canal", "sem-canal", "verificados", "homologados", "bloqueados"];

/** Q8 e X2: fornecedores com o julgamento de confiança, a homologação e a lista de bloqueio. */
export default async function Fornecedores({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const { filtro } = await searchParams;
  const lista = await fornecedoresDaLista();
  return <ListaFornecedores fornecedores={lista} filtroInicial={FILTROS.find((f) => f === filtro) ?? "todos"} />;
}
