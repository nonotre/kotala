import { AtualizaSozinho } from "@/components/AtualizaSozinho";
import { Inicio, type Informativo } from "@/components/operacao/Inicio";
import { acontecidosRecentes, avisosComContexto, heroiDoAviso, numerosOperacao, pedeAcao, pedidosOperacao, registroDoPedido } from "@/lib/dados-operacao";

export const dynamic = "force-dynamic";

/** Quantos avisos que só informam o Início mostra. O resto fica em /avisos. */
const ULTIMOS = 4;

export default async function PaginaInicio() {
  const [avisos, pedidos, numeros, acontecidos] = await Promise.all([avisosComContexto(), pedidosOperacao(), numerosOperacao(), acontecidosRecentes()]);

  // A primeira tarefa (obra parada, urgente, depois a mais nova) vira o destaque.
  const tarefas = avisos.filter((a) => pedeAcao(a.tipo));
  const heroi = tarefas[0] ? await heroiDoAviso(tarefas[0]) : null;
  const linhaHeroi = heroi ? (pedidos.find((p) => p.id === heroi.aviso.pedidoId) ?? null) : null;
  const andamento = pedidos.filter((p) => p.grupo === "andando");

  // O registro fala do pedido do destaque; sem ele, do último que andou.
  const foco = heroi?.aviso.pedidoId ?? [...andamento].sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm))[0]?.id ?? pedidos[0]?.id ?? null;
  const registro = foco ? { pedidoId: foco, itens: await registroDoPedido(foco) } : null;

  // Só o que informa: o que pede ação já está no destaque e em Precisa de você.
  const informativos: Informativo[] = [
    ...avisos.filter((a) => !pedeAcao(a.tipo)).map((a) => ({ chave: a.chave, pedidoId: a.pedidoId, texto: a.titulo, canal: a.canal, em: a.em, href: a.href })),
    ...acontecidos.map((a) => ({ chave: a.chave, pedidoId: a.pedidoId, texto: `${a.texto} ${a.item}.`, canal: a.canal, em: a.em, href: a.href })),
  ]
    .sort((a, b) => b.em.localeCompare(a.em))
    .slice(0, ULTIMOS);

  return (
    <>
      <AtualizaSozinho segundos={3} />
      <Inicio tarefas={tarefas} heroi={heroi} linhaHeroi={linhaHeroi} andamento={andamento} numeros={numeros} registro={registro} informativos={informativos} />
    </>
  );
}
