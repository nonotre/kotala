import { redirect } from "next/navigation";

type Busca = { vista?: string; filtro?: string; canceladas?: string };

// O quadro e a lista das cotações agora são vistas do Início. Leva junto o que a vista guardava no endereço.
export default async function PaginaPedidos({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const p = new URLSearchParams();
  // O quadro é o padrão do Início: só a lista precisa ir no endereço.
  if (busca.vista === "lista") p.set("vista", "lista");
  if (busca.filtro) p.set("filtro", busca.filtro);
  if (busca.canceladas === "1") p.set("canceladas", "1");
  const q = p.toString();
  redirect(q ? `/?${q}` : "/");
}
