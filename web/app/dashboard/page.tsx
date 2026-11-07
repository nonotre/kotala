import { CabecalhoPagina, Pagina } from "@/components/Pagina";

// Painel ainda sem conteúdo: só o lugar no menu e o cabeçalho.
export default function Dashboard() {
  return (
    <Pagina>
      <CabecalhoPagina titulo="Dashboard" />
    </Pagina>
  );
}
