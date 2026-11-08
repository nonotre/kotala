// R11 (regra do dono, 08/11/2026): o fornecedor pede dados da empresa. Passa só razão
// social, CNPJ, endereço de entrega, janela de recebimento e nome de quem recebe. Nunca
// dados bancários, contatos pessoais, orçamento ou valores de outros fornecedores. A
// resposta é um template montado em código: a IA não decide o que revelar.
//
// Janela de recebimento e quem recebe: o pedido pode trazer a janela (pedido.janelaRecebimento);
// sem ela, e para quem recebe (o pedido não tem esse campo), valem os padrões de EMPRESA
// (EMPRESA_JANELA_RECEBIMENTO e EMPRESA_RECEBEDOR).

import { EMPRESA } from "../../config.ts";

type PedidoComEntrega = {
  destino: string | null;
  cep: string | null;
  modoEntrega: "entrega" | "retirada" | null;
  janelaRecebimento: string | null;
};

/** Os únicos dados da empresa que podem ir ao fornecedor. */
export function dadosDaEmpresa(p: PedidoComEntrega) {
  const retirada = p.modoEntrega === "retirada";
  const cep = p.cep ?? (p.destino ? null : EMPRESA.cep);
  return {
    razaoSocial: EMPRESA.nome,
    cnpj: EMPRESA.cnpj,
    enderecoEntrega: retirada ? null : `${p.destino ?? EMPRESA.enderecoEntrega}${cep ? `, CEP ${cep}` : ""}`,
    janelaRecebimento: p.janelaRecebimento ?? EMPRESA.janelaRecebimento,
    quemRecebe: EMPRESA.recebedor,
  };
}

/** Pede algum dos dados da empresa que podem passar. */
const PEDE_EMPRESA =
  /dados (da empresa|de voc[eê]s|cadastrais|de cadastro|para (o )?(cadastro|faturamento|faturar|nota|emiss[aã]o))|raz[aã]o social|\bcnpj\b|endere[cç]o|local de entrega|onde (fica|entrega|entregar|[eé] a entrega|vai ser a entrega)|quem (vai )?receb|nome de quem|respons[aá]vel (pelo|por) receb|hor[aá]rio (de|para) (recebimento|entrega|receber|descarga)|janela de (recebimento|entrega)|que horas? (posso|pode|podemos|d[aá] para) entregar|faturar (para|em nome)|em nome de quem|nome (da empresa|para a nota)|(emitir|tirar|fazer) (a )?nota/i;

/** Pede o que nunca passa: dados bancários, contato pessoal, orçamento, valores de outros fornecedores. */
const PEDE_PROIBIDO =
  /dados banc[aá]rios|conta (banc[aá]ria|corrente|para dep[oó]sito)|chave pix|ag[eê]ncia e conta|or[cç]amento (de voc[eê]s|do comprador|dispon[ií]vel|previsto|m[aá]ximo)|qual (o|a) (seu |sua )?(or[cç]amento|verba)|\bverba\b|quanto (voc[eê]s )?(pode|podem|querem|quer|pretende|pretendem) pagar|valor (alvo|m[aá]ximo)|teto (de|do) pre[cç]o|(pre[cç]o|valor|proposta|cota[cç][aã]o)(es)? d[oa]s? (outr|concorr|demais)|quanto (os outros|a concorr|o concorr)|(telefone|celular|whats(app)?|\bzap|e-?mail|contato) (d[oa] (comprador|respons[aá]vel|pessoa|engenheir[oa]|gerente|dono|dona)|pessoal|direto)|(qual|quais|me passa|passa|manda|informa)( o| a| um| seu| sua)? (telefone|celular|whats(app)?|zap)|\bcpf\b|falar direto com/i;

/** Pistas de que a mensagem pede algo (para mensagens que não foram lidas como dúvida). */
const PEDIDO = /\?|\b(qual|quais|me (passa|manda|informa|envia)|pode(m)? (me )?(passar|mandar|informar|enviar)|precis[ao] d|precisamos d|favor (enviar|informar|passar)|gostaria d)/i;

export type PedidoDeDados = { empresa: boolean; proibido: boolean };

/**
 * O que o texto pede, em código. `duvida`: a mensagem já foi lida como pergunta (Extrator);
 * sem isso, só conta se o texto tem cara de pedido ("qual o CNPJ?", "me passa o endereço").
 */
export function lerPedidoDeDados(texto: string, opcoes: { duvida?: boolean } = {}): PedidoDeDados {
  const pede = opcoes.duvida || PEDIDO.test(texto);
  return { empresa: pede && PEDE_EMPRESA.test(texto), proibido: pede && PEDE_PROIBIDO.test(texto) };
}

export const TEXTO_DADO_PROIBIDO =
  "Não passo dados bancários, contatos pessoais, orçamento nem valores de outros fornecedores. A escolha segue o mapa de cotação; mande sua melhor proposta por aqui.";

/** Template com os dados permitidos. Função pura. */
export function textoDadosEmpresa(itemPedidoId: number, p: PedidoComEntrega): string {
  const e = dadosDaEmpresa(p);
  return [
    `Dados da empresa para a cotação ${itemPedidoId}:`,
    `• Razão social: ${e.razaoSocial}`,
    `• CNPJ: ${e.cnpj}`,
    e.enderecoEntrega ? `• Endereço de entrega: ${e.enderecoEntrega}` : "• Entrega: retirada na loja",
    `• Janela de recebimento: ${e.janelaRecebimento}`,
    `• Quem recebe: ${e.quemRecebe}`,
    "Se precisar de outro dado, me diga qual que eu confirmo com o comprador.",
  ].join("\n");
}

/**
 * Resposta por template quando o texto pede dados da empresa ou algo proibido; null quando
 * não pede (a dúvida segue o caminho de sempre).
 */
export function respostaPedidoDeDados(d: { item: { id: number }; pedido: PedidoComEntrega }, texto: string, opcoes: { duvida?: boolean } = {}): string | null {
  const l = lerPedidoDeDados(texto, opcoes);
  if (!l.empresa && !l.proibido) return null;
  return [l.empresa ? textoDadosEmpresa(d.item.id, d.pedido) : "", l.proibido ? TEXTO_DADO_PROIBIDO : ""].filter(Boolean).join("\n");
}
