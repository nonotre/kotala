import { redirect } from "next/navigation";

// O quadro agora é a vista padrão do Início.
export default async function PaginaQuadro({ searchParams }: { searchParams: Promise<{ canceladas?: string }> }) {
  const canceladas = (await searchParams).canceladas === "1";
  redirect(canceladas ? "/?canceladas=1" : "/");
}
