# Telegram simulado do fornecedor e regras de 08/11

Branch `sim-fornecedor`, a partir do `main` (`f93ef4a`). Pasta da worktree: `../kotala-sim`. Banco de teste: `kotala_teste_sim` (e `kotala_teste_sim2` para rodar duas suítes ao mesmo tempo).

## 1. Pedido

> Em qualquer etapa de uma cotação em andamento, um botão pequeno deixa o usuário simular ser o fornecedor naquele ponto. Os fornecedores são fake e não têm Telegram, então é uma janela simulada onde a gente vira o fornecedor. Todos esses chats existem independente de alguém entrar neles. Cada chat tem um id na URL e abre numa aba extra com título "Telegram simulado" e algo como "Você é o fornecedor".

E incorporar as respostas do dono às perguntas de `frente-3-simulador.md` §7 (abaixo, §4).

## 2. Escopo: Telegram simulado

| # | O quê | Onde |
|---|---|---|
| T1 | O chat é a conversa que já existe no banco: tabela `mensagem` do contato do fornecedor simulado no canal `simulado` (endereço = chave da persona). Nada novo precisa ser criado para ele existir: toda cotação, lembrete, negociação e resposta automática da persona já fica gravada | `src/simulador/`, `src/nucleo/mensagens/` (sem mudança) |
| T2 | URL `/telegram-simulado/<id>`, em que `<id>` é o `contato.id` (uuid) do fornecedor simulado. `?item=<itemPedidoId>` destaca as mensagens daquela cotação. Lista de todos os chats em `/telegram-simulado` | `web/app/telegram-simulado/` |
| T3 | Página fora da casca do site, com cara de Telegram, título da aba "Telegram simulado · <fornecedor>", faixa fixa "Você é o fornecedor <nome>. Nada aqui vai para um Telegram de verdade." | idem |
| T4 | Mensagens com botões (pedido de compra, cotação) mostram os botões; tocar num botão manda o `dado` como se fosse o fornecedor | idem + API interna |
| T5 | Campo de texto para escrever como o fornecedor. A mensagem entra pela mesma `receber()` que a persona automática usa (`canal: "simulado"`, `endereco: chave`) | `src/api-interna.ts` (rota nova) |
| T6 | Assumir o chat: quando o usuário escreve ou toca num botão, a persona automática para de responder naquele chat. Botão "Devolver ao automático" para voltar. Respostas automáticas já agendadas são canceladas ao assumir | `src/simulador/index.ts` |
| T7 | Atualiza sozinho (consulta periódica), para ver as mensagens do sistema chegando | `web/app/telegram-simulado/` |
| T8 | Botão pequeno "Ser o fornecedor" ao lado de cada fornecedor simulado nas abas do pedido (Cotações, Negociação, Comparação, Decisão), abrindo o chat em aba nova (`target="_blank"`) já com `?item=` | `web/components/pedido/` |

Fora do escopo: fornecedor real (Telegram de verdade, e-mail); envio pelo espelho do Telegram do comprador, que continua só leitura.

## 3. Escopo: regras de 08/11 (respostas do §7)

| # | Regra | O que entra nesta branch |
|---|---|---|
| R14b | Prazo vence com menos de 3 propostas: pergunta ao solicitante. "Encerrar" manda as opções que houver para ele escolher. "Estender" prorroga, dá prioridade à cotação, verifica o motivo da falta de proposta (pergunta a quem não respondeu) e tenta resolver (busca mais fornecedores) | Cotador e fluxo do comprador |
| R11 | Fornecedor pede dados da empresa: passa só razão social, CNPJ, endereço de entrega, janela de recebimento e nome de quem recebe. Nunca dados bancários, contatos pessoais, orçamento ou valores de outros fornecedores | Fluxo do fornecedor (template, sem IA decidindo) |
| R13 | "À vista" = pagamento no recebimento. Pagamento antecipado é condição a negociar. O agente pede desconto em qualquer ocasião | Negociador e textos ao fornecedor |
| R3b | Qualquer alteração de valor numa proposta (frete maior para cumprir o prazo, preço novo) vai para o mapa e é confirmada com o solicitante; o agente nunca aceita sozinho | Regra anotada em `decisoes.md`; a negociação de prazo (R3b) ainda não existe no código |

## 4. Respostas do dono (08/11/2026)

1. **Prazo vencido com menos de 3 propostas sem pendência:** verificar com o solicitante. Se ele pedir para encerrar por causa do prazo, recebe as opções que houver até o momento para escolher. Se pedir para estender, dar prioridade à cotação, verificar o motivo da falta de proposta e tentar resolver.
2. **Dados básicos:** razão social, CNPJ, endereço de entrega, janela de recebimento e nome de quem recebe. Nunca dados bancários, contatos pessoais, orçamento ou valores de outros fornecedores.
3. **À vista:** no recebimento. Pagamento antecipado deve ser negociado. O agente pede desconto em qualquer ocasião.
4. **Frete a mais na negociação de prazo:** confirmar com o comprador. Qualquer alteração de valor na proposta vai para o mapa e é confirmada com o solicitante.

## 5. O que entrou

| Parte | Onde |
|---|---|
| Assumir o chat: estado no `evento` (`dados.tipo = "sim_assumido"`, último vale, sem evento = automático); respostas agendadas canceladas ao assumir e conferidas no banco na hora do disparo | `src/simulador/index.ts` (`chatAssumido`, `assumirChat`) |
| Rotas `POST /simulado/mensagem` `{contatoId, texto?, botao?}` (assume e entra pela `receber()`) e `POST /simulado/automatico` `{contatoId, ligado}` | `src/api-interna.ts` |
| Chat `/telegram-simulado/<contato.id>?item=<id>`, lista `/telegram-simulado`, 404 "Chat não encontrado", atualiza a cada 3 s (lista a cada 5 s) | `web/app/telegram-simulado/`, `web/lib/dados-simulado.ts` |
| Fora da casca do site por checagem de rota, como o `/login` | `web/components/Casca.tsx` (2 linhas) |
| Link "Ser o fornecedor" nos fornecedores simulados de Cotações, Negociação, Comparação e Decisão, em aba nova, enquanto o item não está em estado final | `web/components/pedido/`, `web/lib/dados-pedido.ts` (`chatsSimulados`) |
| R14b: pergunta ao comprador com "Encerrar e ver as opções" / "Estender o prazo" (`item:<id>:prazo_encerrar\|prazo_estender`) | `src/agentes/cotador/prazo.ts`, `cotador/index.ts`, uma linha em `fluxo/comprador.ts` |
| R11: resposta por template com os cinco dados; dado proibido recebe recusa fixa | `src/agentes/cotador/dados-empresa.ts`, `EMPRESA` em `src/config.ts` |
| R13: `PAGAMENTO_PADRAO` à vista no recebimento; antecipado vira alavanca de negociação; desconto pedido também com proposta incompleta, pedido de pessoa e pouco prazo | `src/agentes/negociador/index.ts` |
| R3b: proposta nova mais cara (produto ou frete) avisa o comprador e registra `alteracao_valor` | `src/fluxo/fornecedor.ts` |
| Regras em `decisoes.md` (seção 08/11) e §7 de `frente-3-simulador.md` respondido | `docs/` |

Testes novos: `testes/telegram-simulado.integracao.test.ts`, `testes/prazo-sem-propostas.integracao.test.ts`, `testes/dados-empresa.test.ts`. `npm run checar` e `npm run telas:tipos` passam (268 testes).

## 6. Pendências para a junção

### Decisões tomadas sem o dono (confirmar)

**Telegram simulado**
- Escrever ou tocar num botão assume o chat sozinho; ao devolver ao automático, a persona não recupera o que chegou enquanto estava assumida e só reage às próximas mensagens. O estado antigo dela (`perguntou`, `esperandoLembrete`, `completou`) não é limpo ao assumir.
- O botão tocado não é conferido contra os botões oferecidos (até 256 caracteres); quem decide se ainda vale é o fluxo, como no Telegram. Todos os botões do histórico ficam clicáveis.
- Os eventos "Usuário assumiu o chat simulado" e "Chat simulado devolvido ao automático" aparecem no rastro do fornecedor. Filtrar `dados.tipo = 'sim_assumido'` nas telas, se incomodar.
- A página continua atrás do login do site.
- O link aparece também nos estados aprovado e pedido enviado (para o fornecedor confirmar o pedido de compra). Ficou de fora de "Recomendo: X" e de "Rodadas anteriores". Em Comparação pode estar em lugares demais.
- O destaque de `?item=` é heurístico: as respostas do fornecedor não gravam `itemPedidoId`, então contam como da cotação as que vêm logo depois de uma mensagem do sistema daquele item.
- Toque em botão aparece como "(tocou num botão)", porque a mensagem é gravada com texto vazio.

**R14b (prazo com menos de 3)**
- O Cotador não busca mais fornecedores sozinho no fim do prazo: primeiro pergunta ao comprador. A busca (I3) roda quando ele escolhe estender.
- Sem resposta do comprador em metade do prazo de respostas (`ESPERA_RESPOSTA_PRAZO_FRACAO`), encerra. Enquanto espera, o prazo do item é empurrado e os fornecedores ainda podem mandar proposta.
- A pergunta vale também quando todos responderam antes do prazo. Sem ninguém devendo resposta e sem candidato novo, encerra sem perguntar. A rodada de negociação pedida pelo botão do comprador fecha sem perguntar.
- No máximo 2 prorrogações por rodada (`MAX_PRORROGACOES`).
- "Prioridade" no código: a busca automática volta a rodar a cada vencimento enquanto houver levas (também em pedido urgente, com o teto normal); recusa ou explicação de quem não cotou é repassada ao comprador; o evento leva `prioridade: true` (`prioridadeDoItem` para as telas).
- A pergunta do motivo a quem não respondeu sai como `tipo: "lembrete"` e conta como o lembrete dele.

**R11, R13, R3b**
- Quem recebe é um setor neutro ("Equipe de recebimento") e a janela é "dias úteis, das 8h às 17h", até a empresa dizer os dela (`EMPRESA_RECEBEDOR`, `EMPRESA_JANELA_RECEBIMENTO`). A detecção do pedido de dados é por regex. Inscrição estadual e e-mail para a nota não estão na lista: vão para a IA, que leva ao comprador.
- O desconto continua sem ser pedido quando a mensagem do fornecedor tem alerta (todos os alertas de hoje são de integridade), quando o preço está a confirmar ou a proposta vai ser cortada. "Qualquer ocasião" virou uma vez por fornecedor e item, não a cada mensagem.
- R3b: não havia caminho em que o agente aceitasse sozinho mudança de valor depois do mapa. Antes do mapa, proposta mais cara substituía a anterior em silêncio; agora avisa o comprador.

### Não feito

- Botões do prazo só por botão: "pode estender" por texto não é entendido (cabe ao Assistente ou ao fluxo do comprador).
- Regra dos 3 "sem pendência" (R14 completa): as pendências da proposta ainda não existem no código; conta só propostas válidas.
- Negociação de prazo (R3b) não existe; a regra de confirmar qualquer valor novo com o solicitante está só em `decisoes.md`.
- Comparador: o mapa não marca preço que subiu, e "poucos fornecedores responderam a tempo" não distingue o comprador que pediu para encerrar.
- Telas não mostram os botões do prazo nem a prioridade (podem chamar `/acoes/botao` com `item:<id>:prazo_encerrar|prazo_estender`).
- Índice para a consulta de `sim_assumido` em `evento.dados` (precisa de migração; hoje o volume não pede).
- Teste de ponta a ponta com a IA real e com os bots no ar. R11 e R3b dentro da conversa real dependem do Extrator e não foram testados assim.

### Conflitos prováveis

- `src/agentes/cotador/index.ts`: `ampliarVencidos` virou `verificarVencidos`, `ampliarSeFaltarPropostas` embrulha `ampliarBusca`, mudou o começo de `responderDuvida` e de `encerrarSeTodosResponderam`.
- `src/agentes/negociador/index.ts`: `deveNegociar` perdeu `faltam`/`pedidoContato` e `escolherAlavancas` perdeu `prazoPagamentoDias`; saíram `PRAZO_PAGAMENTO_PADRAO` e `NEGOCIACAO_RESTANTE_MIN` de `src/config.ts` (ainda citadas em `docs/frentes.md` e `docs/plano-ia/negociacao.md`). Quem usar esses nomes quebra no `tsc`.
- `src/fluxo/fornecedor.ts`: bloco da proposta, ramos de recusa e "outro".
- `src/simulador/index.ts` e `src/api-interna.ts` (só acréscimos): conflitam com a Frente 3 se ela mexeu no simulador.
- `web/components/Casca.tsx` e as abas do pedido: da Frente 1.
- `testes/ampliar-busca.integracao.test.ts`: o último teste agora espera a pergunta ao comprador.
- `.env.exemplo`: bloco novo no fim (`EMPRESA_JANELA_RECEBIMENTO`, `EMPRESA_RECEBEDOR`, `MAX_PRORROGACOES`).

### Para testar ao vivo

O container `bots` roda o `main`: as rotas novas só existem depois da junção (ou subindo os bots desta worktree com outra `API_INTERNA_PORTA` e outro par de bots). Telas desta worktree: `cd web && npx next dev -p 3350`.
