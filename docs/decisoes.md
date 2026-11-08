# Decisões do projeto

Registro curto das decisões que mudam o escopo ou o desenho. A mais nova fica no topo.

## 08/11/2026 · Prazo sem 3 propostas, dados da empresa, pagamento e alteração de valor

**Situação:** R14b, R11 e R13 implementados na branch `sim-fornecedor`; R3b anotada (a negociação de prazo ainda não existe). Respostas do dono às perguntas 1 a 4 de [frente-3-simulador.md](frente-3-simulador.md#7-perguntas-que-ainda-ficaram).

**R14b · Prazo vencido com menos de 3 propostas válidas.** Regra do dono: "Deve ser verificado com o solicitante. Caso ele peça para encerrar por conta de prazo, são enviadas as opções que tem até o momento para ele escolher. Caso ele peça para estender, dar prioridade à cotação, verificar o motivo da falta de proposta e tentar solucionar."

- O Cotador pergunta ao comprador, uma vez por prazo, com os botões "Encerrar e ver as opções" e "Estender o prazo" (`item:<id>:prazo_encerrar` e `item:<id>:prazo_estender`). Valem no Telegram, no chat web e nas telas, que entram pela mesma `receber()`.
- A busca automática de mais fornecedores (I3) não roda mais sozinha no fim do prazo: só depois que o comprador pede para estender.
- **Encerrar:** o fechamento de sempre. O mapa sai com o que houver, com o aviso de "menos de 3"; sem proposta válida, o item fica sem proposta.
- **Estender:** um prazo de respostas novo, prioridade à cotação, pergunta curta e neutra a quem não respondeu ("aconteceu algum impedimento?") e busca de mais fornecedores (I3).
- **Prioridade**, no código: a busca automática volta a rodar sozinha a cada vencimento enquanto houver levas e fornecedores novos, sem perguntar de novo, com o teto normal mesmo em pedido urgente; o que os fornecedores sem proposta respondem (recusa, explicação) vai ao comprador; o evento da resposta leva `prioridade: true`.
- **Decidido na implementação, a confirmar:**
  - sem resposta do comprador em metade do prazo de respostas (`ESPERA_RESPOSTA_PRAZO_FRACAO`), encerra com o que houver, porque estender é pedido dele;
  - a pergunta vale também quando todos responderam antes do prazo com menos de 3 válidas (ninguém mais vai responder; a escolha é a mesma);
  - até 2 prorrogações por rodada (`MAX_PRORROGACOES`); depois, encerra com aviso;
  - sem fornecedor devendo resposta e sem fornecedor novo para consultar, encerra sem perguntar, porque estender não mudaria nada;
  - a rodada de negociação do botão continua fechando no prazo, sem perguntar;
  - a pergunta do motivo vai direto, como o lembrete (é sobre a mesma cotação), e conta como o lembrete daquele fornecedor.
- Estado sem migração: eventos com `dados.tipo` `prazo_pergunta` e `prazo_resposta`. Enquanto espera o comprador, o prazo do item fica no fim da espera, e os fornecedores ainda podem mandar proposta. Código: `src/agentes/cotador/prazo.ts`.

**R11 · Dados da empresa.** Quando o fornecedor pede, passa só razão social, CNPJ, endereço de entrega, janela de recebimento e nome de quem recebe. Nunca dados bancários, contatos pessoais, orçamento ou valores de outros fornecedores.

- A resposta é um template montado em código (`src/agentes/cotador/dados-empresa.ts`): a IA não decide o que revelar. Pedido de dado proibido recebe uma recusa fixa e não vai ao comprador.
- Vale na dúvida do fornecedor e também quando o pedido vem junto de uma proposta ("segue o preço; qual o CNPJ?").
- A resposta por IA às outras dúvidas só recebe os dados do pedido e esses cinco: o que não está lá ela não tem como passar.
- O pedido não tem campo de quem recebe, e a janela é opcional: entraram em `EMPRESA` (`src/config.ts`) com as variáveis `EMPRESA_RECEBEDOR` (padrão "Equipe de recebimento") e `EMPRESA_JANELA_RECEBIMENTO` (padrão "dias úteis, das 8h às 17h"). A razão social é `EMPRESA_NOME`.

**R13 · Pagamento e desconto.** "À vista" quer dizer no recebimento. Pagamento antecipado é condição a negociar. "O agente pede desconto em QUALQUER OCASIÃO."

- A cotação diz o padrão: "Pagamento: à vista, no recebimento da mercadoria (contra a nota fiscal)", ou a forma que o comprador pediu no pedido.
- Proposta com pagamento antecipado (antecipado, sinal, entrada, no pedido): o pedido de desconto pede também o pagamento no recebimento.
- Sem antecipado, a alavanca de pagamento pede desconto pelo padrão à vista no recebimento. Sai a pergunta por prazo maior no boleto (`PRAZO_PAGAMENTO_PADRAO` deixou de existir).
- Dizer o padrão da empresa pode; prometer pagamento continua barrado pelo validador.
- "Qualquer ocasião": o pedido de desconto passa a sair também com proposta incompleta (na mesma mensagem que pede o que falta), quando o fornecedor pediu para falar com uma pessoa e com pouco prazo restante (`NEGOCIACAO_RESTANTE_MIN` deixou de existir; a janela só não passa do prazo).
- **Por bom senso, continua sem pedir:** mensagem com alerta (todos os alertas de hoje são de integridade: comissão, combinação de preço, pagamento por fora, pedido de dado sigiloso, link suspeito); preço que ainda não se sabe qual é (a confirmar); proposta que o comparador vai cortar (item diferente sem aceite, entrega depois do prazo); uma vez por fornecedor e item, porque a rodada do botão e a nova rodada já pedem preço melhor no próprio texto.
- Nunca cita valor de outro fornecedor (regra de 07/11, abaixo).

**R3b · Alteração de valor.** "Qualquer alteração de valor na proposta deve ser colocada no mapa e confirmada com o solicitante." O agente nunca aceita sozinho frete maior para cumprir o prazo nem preço novo.

- A negociação de prazo (entrega escalonada, frete maior para entregar no prazo) ainda não existe no código. Quando existir, a proposta nova vai para o mapa como proposta do fornecedor e só vale se o comprador a aprovar.
- Hoje, nenhum caminho aceita sozinho uma mudança de valor depois do mapa: proposta que chega depois do fechamento recebe "a cotação já foi encerrada"; a confirmação de um preço retido abaixo da referência só refaz o mapa, e o comprador decide; o pedido de compra repete o valor aprovado.
- Antes do mapa, vale a proposta mais recente do fornecedor (regra de antes). Faltava o comprador saber quando ela sobe: agora, preço ou frete maior que na proposta anterior gera aviso ao comprador e registro (`alteracao_valor`). O mapa ainda não marca a subida (fica com quem cuida do Comparador).

## 08/11/2026 · Cotação, proposta e pedido

**Situação:** em andamento (Frente 1, só os textos das telas).

O produto da solução é a **cotação**; o **pedido** é só a etapa final, gerado pela cotação depois da aprovação. O que até aqui se chamou "pedido" passa a se chamar cotação.

- **Cotação:** o que o comprador pede e o processo inteiro (solicitada, propostas, comparação, pedido). Quadro e lista do Início são duas vistas das cotações. Mesmo número: "Pedido 14" vira "Cotação 14".
- **Solicitação de proposta / proposta:** o que vai a cada fornecedor e o que ele responde (antes chamado de "cotação" ao fornecedor).
- **Mapa de cotações:** a comparação das propostas.
- **Pedido:** o que a cotação aprovada gera para o fornecedor vencedor (antes "pedido de compra"). Uma cotação fecha com um único fornecedor, mesmo com vários itens. O dashboard de economia olha só os pedidos.

Escopo desta rodada: textos das telas. Ficam para depois: as mensagens do bot (Frente 4), e rotas, código e banco (depois da junção das frentes, para não gerar conflito em todo arquivo). Pendência de backend: hoje cada item é decidido sozinho e pode fechar com fornecedor diferente (`src/fluxo/decisao.ts`), o que contraria a regra de um fornecedor por cotação.

## 07/11/2026 · Regras da área de compras (anotações da Ester)

**Situação:** implementado em parte.

Feito:

- **Setor:** toda solicitação é discriminada por setor; se o comprador não disser, a confirmação pergunta.
- **Dúvida do fornecedor que o pedido não responde:** vai ao comprador, e a próxima mensagem dele (até 30 minutos) é repassada ao fornecedor.
- **Cancelamento com justificativa:** cancelar pedido ou item pergunta o motivo, que fica gravado.
- **Unidades de agregados:** areia, brita e pedra em m³, t, kg, saco ou L; carrada ou caminhão geram pergunta pelo volume, para não haver dúvida sobre o que comprar.
- **Quadro:** as 4 colunas do site continuam fixas (requisito); as etapas sugeridas viram etiquetas ("Captando fornecedores", "Em negociação") e as canceladas ficam ocultas, com opção de mostrar.
- **Códigos e confirmação de ambiguidades:** a base de itens dá código ao item e pergunta a variação quando há mais de uma.

- **Lista de bloqueio e homologação:** na tela de fornecedores; bloquear exige motivo e tira o fornecedor da busca e da recompra; homologar soma pontos na confiança.

- **Item novo é cadastrado:** na confirmação do pedido, com código próprio no catálogo.

Para depois: entregas parciais (uma parte em 20 dias, outra em 30) e campos extras do fornecedor (filial ou sede, atendente).

## 07/11/2026 · Negociação sem citar valor de outro fornecedor

**Situação:** implementado.

A Ester apontou, nas anotações dela, que valores de cotação e dados de pagamento são sensíveis e que o assistente não pode citar o valor de outros fornecedores para conseguir desconto. A contraproposta agora só pede melhora (preço, frete ou prazo de entrega), oferece combinar a forma de pagamento e, quando houver, cita a referência pública da internet, que não é proposta de ninguém. O melhor custo recebido fica só no registro e no mapa do comprador.

## 07/11/2026 · Logo nas telas

A logo do coala feita pela Liria entra no cabeçalho das telas (`web/public/logo.svg`, sem o fundo branco) e o coala, recortado, vira o ícone da aba.

## 07/11/2026 · Busca e verificação com fontes públicas

**Situação:** implementado.

- **Empresa fictícia em São Paulo** (CEP 01310-100), porque as lojas online testadas não entregam no interior. Sem destino no pedido, vale o endereço padrão da empresa.
- **Busca real com referência pública.** Preço da internet entra como referência com fonte e hora, não como proposta. Lojas encontradas viram fornecedores conhecidos, mas não são contatadas.
- **Créditos do Serper protegidos:** 2 consultas por item, cache de 24 h, teto de 300 no app, testes nunca gastam.
- **Verificação do fornecedor (Q8)** com Receita (BrasilAPI), sanções do CEIS e do CNEP (dados abertos do Portal da Transparência) e TJSP (e-SAJ). Só falência e recuperação judicial pesam no TJSP; quantidade de processos não.
- **TJSP indisponível no fim de semana do hackathon** (manutenção em 07 e 08/11). A leitura não pôde ser conferida; fonte fora do ar não tira pontos.
- **API do Portal da Transparência:** o dono vai criar a chave. Encaixe planejado em [arquitetura.md](arquitetura.md#portal-da-transparência-pela-api-próximo-passo).

## 07/11/2026 · Fornecedor sem cadastro: vem da busca e é convidado por e-mail

**Situação:** decidido, implementação adiada (seguir com os outros módulos antes).

O fornecedor não faz cadastro no bot. A busca (R3) já identifica quem ele é (nome, CNPJ, e-mail, fonte) e o registra no banco. O primeiro contato é por e-mail.

Fluxo previsto:

1. A busca registra o fornecedor com os dados encontrados.
2. O agente manda um e-mail com o pedido de cotação e um link pessoal para o bot do fornecedor: `t.me/<bot_fornecedor>?start=<código do fornecedor>`.
3. Ao tocar no link, o bot liga a conversa ao fornecedor já conhecido, sem perguntar o nome, e mostra a cotação.
4. Responder pelo próprio e-mail fica para depois (E2).

Restrições e pontos em aberto:

- O Telegram não deixa o bot iniciar conversa: o fornecedor precisa abrir o bot uma vez, por isso o link no e-mail.
- Muda a regra anterior de não contatar fornecedor que não autorizou. Por e-mail comercial o risco é menor que por WhatsApp (regra da Meta), mas a LGPD vale.
- Na demo: perguntar à organização se fornecedores reais podem receber e-mail. Se não, usar endereços do time e manter os simulados para volume.
- Fornecedor sem e-mail encontrado (lojas grandes costumam ter só formulário) entra só como preço de referência, com a fonte.
- O link genérico com pergunta do nome continua como reserva, para a banca virar fornecedor pelo QR no pitch.
- Para o envio: conta Gmail com senha de app (nodemailer).
