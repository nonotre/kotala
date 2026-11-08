import { ListaFornecedores, type Filtro } from "@/components/consulta/ListaFornecedores";
import { categoriasDaBase, fornecedoresDaLista } from "@/lib/dados-consulta";

export const dynamic = "force-dynamic";

const FILTROS: Filtro[] = ["todos", "com-canal", "sem-canal", "verificados", "homologados", "bloqueados"];

type Busca = { filtro?: string; busca?: string; categoria?: string };

/** Base de Dados, aba Fornecedores (Q8 e X2): confiança, homologação e lista de bloqueio. */
export default async function Fornecedores({ searchParams }: { searchParams: Promise<Busca> }) {
  const { filtro, busca, categoria } = await searchParams;
  const [lista, categorias] = await Promise.all([fornecedoresDaLista(), categoriasDaBase()]);
  return (
    <ListaFornecedores
      fornecedores={lista}
      categorias={categorias}
      filtroInicial={FILTROS.find((f) => f === filtro) ?? "todos"}
      filtrosIniciais={{ busca: busca ?? "", categoria: categoria ?? "" }}
    />
  );
}
