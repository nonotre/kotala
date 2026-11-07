// Liga a entrada única (N4) aos fluxos de cada papel e os agentes aos estados.
// A ordem importa: ganchos do mesmo estado rodam na ordem em que foram ligados.

import { ligarBusca } from "../agentes/busca/index.ts";
import { ligarComparador } from "../agentes/comparador/index.ts";
import { ligarCotador } from "../agentes/cotador/index.ts";
import { aoReceber } from "../nucleo/mensagens/index.ts";
import { aoMensagemDoComprador, ligarComprador } from "./comprador.ts";
import { ligarDecisao } from "./decisao.ts";
import { aoMensagemDoFornecedor } from "./fornecedor.ts";

let ligado = false;

export function ligarFluxos() {
  if (ligado) return;
  ligado = true;
  ligarBusca(); // buscando → cotações criadas → cotando
  ligarCotador(); // cotando → envia; comparando → marca sem resposta (antes do mapa)
  ligarComparador(); // comparando → mapa → aguardando_decisao
  ligarDecisao(); // aprovado → pedido de compra
  ligarComprador(); // lembrete de pedido parado em "confirma?"
  aoReceber((m) => (m.contato.papel === "comprador" ? aoMensagemDoComprador(m) : aoMensagemDoFornecedor(m)));
}
