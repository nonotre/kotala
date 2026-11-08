import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { avisosQuePedemAcao, dadosDoQuadro } from "@/components/operacao/dados-quadro";
import { InicioQuadro } from "@/components/operacao/InicioQuadro";
import type { Filtro } from "@/components/operacao/ListaPedidos";
import { pedidosOperacao } from "@/lib/dados-operacao";
import { usuarioDaSessao } from "@/lib/sessao-servidor";

export const dynamic = "force-dynamic";

// Repetido aqui: o FILTROS da lista mora num módulo de cliente, que a tela de servidor não lê.
const FILTROS_VALIDOS: Filtro[] = ["todos", "voce", "andando", "concluidos", "cancelados"];

type Busca = { vista?: string; filtro?: string; canceladas?: string; meus?: string };

// O Início é a tela de trabalho: as cotações em quadro (padrão) ou em lista (as conversas ficam em /chat).
// Na URL: ?vista=lista, ?filtro= (da lista), ?canceladas=1 (do quadro) e ?meus=1 ("Só os meus", nas duas).
// O painel antigo (Inicio.tsx) está fora da rota.
export default async function PaginaInicio({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const vista = busca.vista === "lista" ? "lista" : "quadro";
  const filtro = busca.filtro as Filtro | undefined;
  const filtroInicial = filtro && FILTROS_VALIDOS.includes(filtro) ? filtro : "todos";
  const mostrarCanceladas = busca.canceladas === "1";
  // "Só os meus": a pessoa vem da sessão do cookie, nunca do endereço.
  const meus = busca.meus === "1";
  const donoId = meus ? ((await usuarioDaSessao())?.id ?? null) : null;

  // Só vem a base da vista aberta; o "Precisa de você" vem nas duas.
  const [quadro, linhas, avisosDaLista] = await Promise.all([
    vista === "quadro" ? dadosDoQuadro(mostrarCanceladas, donoId) : undefined,
    vista === "lista" ? pedidosOperacao(donoId) : undefined,
    vista === "lista" ? avisosQuePedemAcao(donoId) : undefined,
  ]);

  return (
    <>
      <AtualizaSozinho segundos={3} />
      <InicioQuadro
        vista={vista}
        filtroInicial={filtroInicial}
        mostrarCanceladas={mostrarCanceladas}
        meus={meus}
        avisos={quadro?.avisos ?? avisosDaLista ?? []}
        quadro={quadro}
        linhas={linhas}
      />
    </>
  );
}
