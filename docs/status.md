# Estado do projeto

Retrato em 08/11/2026, depois da junção da rodada 2 (as quatro frentes, o dashboard e a Base de Dados; ver [Junção da rodada 2](#junção-da-rodada-2-08112026)). Como cada parte funciona: [arquitetura.md](arquitetura.md). Decisões: [decisoes.md](decisoes.md). Pitch: [pitch.md](pitch.md).

**Resumo:** dos 42 módulos do escopo V1, 35 prontos, 2 parciais e 5 não feitos (todos das fases de complemento e "só se sobrar"). Fases 0 a 2, pitch e todos os diferenciais (Raro, Épico e Lendário) completos. O assistente agora é generalista (compras de uma empresa; construção é só o nicho de exemplo), com guardrails dos dois lados. 316 testes automáticos passando.

## Módulos

### Fase 0 · Fundação (7 de 7)

| Módulo | Situação |
|---|---|
| N1 Modelo de dados, N2 Adaptador de IA, N3 Orquestrador, N4 Entrada única | Pronto |
| R1 Pedido pelo Telegram | Pronto |
| R5 Cadastro do fornecedor | Pronto: link ou QR, e convite por e-mail com link pessoal |
| R10 Quadro | Pronto: as 4 colunas do site, com etiquetas |

### Fase 1 · Ciclo obrigatório (7 prontos, 1 parcial)

| Módulo | Situação |
|---|---|
| R2 Interpretador, R4 Cotador, R6 Extrator, R8 Comparador, R9 Recomendação, R11 Decisão | Pronto |
| R3 Busca | Pronto: lojas VTEX com frete por CEP, Serper e leitura de páginas, sempre com fonte e hora |
| R7 Frete e prazo | Parcial: vale o frete informado, ou estimado pela mediana dos outros; loja online sem frete aparece como "a calcular no site", com total estimado; falta cálculo por distância e frete de lojas fora da VTEX |

### Fase 2 · Nota da banca (11 prontos, 1 parcial)

| Módulo | Situação |
|---|---|
| Q1 Mapa de cotação | Pronto; faltam os cenários "menor custo / mais rápido / conhecido" ("se sobrar tempo" no escopo) |
| Q2 Três propostas válidas | Pronto: com menos de 3, justifica e nunca diz "melhor"; no fim do prazo, ou quando todos já responderam, busca mais fornecedores sozinho (até 2 levas, urgente 1) e o mapa diz quantos consultou |
| Q3 Fornecedor simulado | Pronto: personas por categoria (obra, escritório, EPI, limpeza, informática, copa), estilos de desconto e personas difíceis (unitário ambíguo, duas mensagens, só Pix, orçamento em PDF) |
| Q4 Prazo e lembrete, Q7 Robustez, N5 Raciocínio visível, N6 Reprovação com motivo, R12 Avisos | Pronto |
| Q8 Verificação do fornecedor | Pronto: Receita, CEIS e CNEP (arquivos e API do Portal) e TJSP; o TJSP não pôde ser conferido (manutenção em 07 e 08/11) |
| E5 Proposta em PDF e foto, R1b Pedido por áudio | Pronto |
| E6 Base de itens | Pronto, com botões de variação; falta o autocompletar no chat web |

### Pitch (2 de 2)

| Módulo | Situação |
|---|---|
| Q5 Roteiro e QR, Q6 Explicação das escolhas | Pronto: `docs/pitch.md` e tela Convite |

### Fases 3 e 4 · Diferenciais (4 de 4)

| Módulo | Situação |
|---|---|
| X2 Memória (Raro) | Pronto: recompra em menos de 3 meses, histórico, homologação, lista de bloqueio; falta contrato anual com pedido automático |
| X3 Negociação (Raro) | Pronto: até 3 rodadas pelo botão, sem citar valor de outro fornecedor; e pedido automático de desconto em toda cotação (uma vez por fornecedor e item), com o resultado no mapa |
| X4 Economia (Épico) | Pronto |
| X5 Voz (Lendário) | Pronto e testado com microfone: pelo navegador; ligação telefônica de verdade fica de fora (paga) |

### Fases 5 e 6 · Complementos (3 prontos, 6 não feitos)

| Módulo | Situação |
|---|---|
| E3 Chat web, E1 Convite por e-mail, E7 Anexos do comprador | Pronto |
| X1 WhatsApp simulado | Não feito (o de mais efeito na nota entre os que faltam: é um adaptador de canal novo) |
| E9 Primeiro contato ativo simulado | Não feito |
| R1c Pedido pelo quadro | Não feito; o chat web na tela cobre o mesmo uso |
| E2 Resposta do fornecedor por e-mail | Não feito |
| E8 Endereços de entrega e faturamento | Não feito; há só o endereço padrão da empresa |
| E4 Login e várias empresas | Parcial: login com usuário e senha, chat e cards por pessoa, responsável do pedido e papel de gestor; várias empresas continua fora da demo |

### Além do escopo

Rastreio completo (estado de qualquer pedido em qualquer instante), API do Portal da Transparência na verificação, cadastro automático de item novo, e as regras das anotações da Ester (setor, dúvida do fornecedor repassada ao comprador, cancelamento com motivo, unidades de agregados).

## Testes da Liria e da Ester (07/11/2026)

Anotações em `docs/workspaces/`. Corrigido no código, com testes em `testes/melhorias.test.ts` e `testes/nucleo.integracao.test.ts`:

| Relato | O que mudou | Onde |
|---|---|---|
| Na 3ª correção, o pedido foi cancelado e um item seguiu para cotação com 0 unidades (Liria) | Cancelar o pedido não puxa mais o próximo item da fila. Correção que a IA não entende nunca cancela: mantém o pedido e pede de novo. A IA recebe o "entendimento atual" e aplica só a última correção; a quantidade já dita não se perde. Nenhuma cotação sai sem quantidade | `nucleo/orquestrador/index.ts` (`iniciarProximoDaFila`), `fluxo/comprador.ts`, `agentes/interpretador/index.ts` |
| Mensagem nova virava correção de um pedido parado havia horas; pouco tempo para terminar a solicitação (Liria, Ester) | Janela de 1 h (`JANELA_CONFIRMACAO_MIN`) para completar o pedido; ao fim, um lembrete com os botões. Depois do lembrete sem resposta, mensagem nova abre outro pedido | `fluxo/comprador.ts` (`pedidoPendente`, `lembrarConfirmacoes`) |
| Perguntas de quantidade repetidas (Ester) | A pergunta do sistema só entra se a da IA não falar do mesmo item; a IA não pergunta mais quantidade | `agentes/interpretador/index.ts` (`limpar`) |
| Bot do fornecedor "encerrava" sem cotação aberta (Liria) | A mensagem é guardada no rastro e o bot explica o que acontece; resposta atrasada a uma cotação fechada recebe aviso de encerramento | `fluxo/fornecedor.ts` |
| Cadastro pelo bot não pergunta o que vende (Ester) | Cadastro em etapas: nome, categorias (botões ou texto livre) e CNPJ opcional (dispara a verificação). A busca só manda cotação da categoria do fornecedor real | `fluxo/fornecedor.ts`, `agentes/busca/index.ts` (`candidatos`), coluna `fornecedor.categorias` |
| "Obrigado! Aviso se for escolhida." fechava a negociação e não pedia a validade (Liria) | O fecho convida a melhorar a proposta até o prazo; pede validade, prazo, frete e pagamento que faltem. Proposta incompleta deixa a cotação aberta até o prazo, e a mensagem que completa junta com a anterior | `fluxo/fornecedor.ts` (`completarComAnterior`), `agentes/cotador/index.ts` (`encerrarSeTodosResponderam`) |
| 1 minuto para o fornecedor responder (Liria); ideal 3 a 7 dias (Ester) | Demo: 5 min (`PRAZO_RESPOSTAS_SEG=300`). `PRAZO_MODO=real`: 3 dias, ou 5 acima de `LIMITE_COMPRA_MAIOR`; negociação, 2 dias. Mensagens mostram data e hora quando o prazo passa do dia | `config.ts` (`prazoRespostasMs`), `texto.ts` (`quando`) |
| Lojas da internet não contavam como fornecedor, frete não aparecia, link de anúncio descartado no fim (Liria) | Até 3 lojas online viram proposta do mapa (selo "loja online"), com preço e frete do anúncio e link; prazo, pagamento e validade simulados e marcados. Aprovar uma loja online segue com o link para finalizar e confirmação simulada. Lojas que viraram proposta saem da "referência pública"; o Telegram não mostra mais prévia de link | `agentes/busca/internet.ts` (`ofertasDaInternet`), `agentes/comparador`, `fluxo/decisao.ts` (`comprarNaLojaOnline`), `canais/telegram.ts` |
| "A decisão é sua: nada é comprado sem a sua aprovação." exagerada (Liria) | Frase retirada do mapa e trocada na tela de decisão | `agentes/comparador/index.ts`, `web/components/pedido/AbaDecisao.tsx` |
| "Pedido 11" sem nome (Liria) | Nome legível: "Pedido 11 · Placa de Inox 304 · setor comunicação" na confirmação e no lembrete | `texto.ts` (`nomePedido`) |
| Entregas parciais (Ester) | O pedido guarda o combinado ("metade em 20 dias, o resto em 30") e ele vai na cotação e no pedido de compra | coluna `pedido.entregas` |
| Busca sem resultado deixava o comprador sem resposta | Aviso com o que fazer (outra descrição ou convidar fornecedor) | `agentes/busca/index.ts` |
| Chat web não aceitava imagem | Botão de anexo e colar (Ctrl+V) imagem, PDF ou áudio, até 3 arquivos de 10 MB; passa pelo mesmo caminho do Telegram (R1b) | `web/components/chat/Conversa.tsx`, `src/api-interna.ts` |

Ficou como estava, de propósito: o quadro mantém as 4 colunas do site (requisito, ver `decisoes.md`); "Captando fornecedores" e "Em negociação" são etiquetas, e as canceladas ficam ocultas com opção de mostrar.

O dashboard que a Ester especificou (`docs/workspaces/ester-workspace/interface-dashboard.md` e `dashboard.md`) está pronto em `/dashboard`, com o que ficou da antiga tela de economia; ver a junção abaixo.

## Perfil e login (Frente 2, rodada 2, 08/11/2026)

Cada pessoa entra com usuário e senha e tem o seu chat no navegador; quem não tem conta cria na tela de entrada. Os cards mostram o dono (quem pediu), e todos veem todos. As contas `ester` e `liria` já existem, ligadas ao Telegram delas, e a primeira entrada define a senha. Em Conversar, quem tem Telegram ligado vê o espelho dele, só para ler, com o botão "Continuar no Telegram". Ainda não: empresa e endereços no banco. Ver [perfil-login.md](perfil-login.md).

## Junção da rodada 2 (08/11/2026)

As quatro frentes de [frentes.md](frentes.md), o dashboard e a Base de Dados da Liria foram juntados no `main`, com os pedidos que cada frente anotou para as outras. Migrações novas: `0016` (papel de gestor, responsável e pagamento preferido do pedido, contador de levas e categoria do item) e `0017` (número curto do fornecedor).

| Área | O que entrou |
|---|---|
| Conversa com o comprador (F4) | Interpretador generalista, que lê antes de abrir pedido ("Quer que eu cote X?"); guardrails em 8 classes, com lista dura, controlados, dado pessoal mascarado (também na tabela `mensagem`), insistência e aviso ao gestor; atributos obrigatórios por categoria; marca vista na foto; pagamento preferido lido do pedido |
| Assistente do chat web (F3) | Responde perguntas sobre pedidos, mapas, fornecedores e regras com ferramentas conferidas, links para as telas e botões de ação; os guardrails rodam antes dele; no Telegram, responde as consultas que o Interpretador classifica |
| Conversa com o fornecedor (F4) | Preço unitário ou total, aderência técnica, alertas de conduta, cotação em HTML com checklist, uma pergunta por vez (cadência), desconto automático com reserva atômica, desconto tardio que refaz o mapa, categoria perguntada ao fornecedor real, busca automática com retentativa de envio |
| Mapa e comparador | Alertas de conduta (sem nota e item irregular saem do ranking), "a confirmar", negociação no mapa, busca automática contada, referência de preço só de fornecedores físicos (online vira alerta), frete "a calcular no site", forma de pagamento, mapa atualizado e mapa anterior marcado como substituído |
| Telas | Base de Dados (Fornecedores e Itens com abas), Alertas de conduta com bloqueio, responsável do pedido, dashboard com recorte por comprador, gestores e regras de compra em Configurações, textos sem "obra" |
| Harness (F3) | Simulador geral por categoria, regressão dos erros do plano, os 69 casos de guardrail, casos de ampliação, métricas de desconto e de mensagens sem resposta; `npm run guardrails:avaliar`, `regressao:avaliar`, `assistente:avaliar` |

**Para rodar depois de atualizar:** `npm run db:migrar` (já aplicado no banco principal em 08/11) e `docker compose up -d --build`. Variáveis novas, todas opcionais (ver `.env.exemplo`): `ASSISTENTE`, `IA_MODELOS_CONVERSA*`, `GESTOR_CONTATO_ID` (reserva: o gestor agora é marcado em Configurações), `GUARDRAIL_MODO_DEMO`, `EMPRESA_NICHO`, `MAX_AMPLIACOES`, `MAX_PRORROGACOES`, `EMPRESA_RECEBEDOR`, `EMPRESA_JANELA_RECEBIMENTO`. `src/dados/` fica fora do git: worktree nova copia da pasta principal.

**Decisões que ficaram para o dono, a Ester e o jurídico:**
- Urgência `obra_parada` → `parada` (o banco não mudou; as telas e mensagens já dizem "operação parada" onde dava).
- Lojas online contam para chegar às 3 propostas válidas? Hoje contam; o Q7 já as trata só como alerta de preço.
- Política da empresa (bebida, tabaco, uso pessoal, serviços), os "10 minutos" do solicitante, a cotação esperar a janela do desconto, a lista de produtos controlados.
- As cinco perguntas abertas de [frente-3-simulador.md](frente-3-simulador.md) (seção 7).

**Ainda não feito:** PDF do mapa (exige dependência nova); frete de lojas fora da VTEX; negociador que redige com IA (I2) e memória na conversa (I5); serviços (hoje "ainda cotamos só produtos"); cenários do simulador com gabarito e personas guiadas por IA; comparação de modelos num conjunto misto; o Extrator ainda lê "R$ 300" para 5 unidades como unitário sem perguntar (achado do harness, depende do prompt).

## Para quem vai mexer nas telas

- Código em `web/` (Next 16 e Carbon). Telas em `web/app/`, componentes em `web/components/`, leitura do banco em `web/lib/dados.ts`, ações em `web/lib/acoes.ts` (vão para a API interna dos bots).
- Casca (cabeçalho, menu lateral, sino, tema) em `web/components/Casca.tsx`; peças comuns de página em `Pagina.tsx`, `Bloco.tsx` e `Tabela.tsx`. Cada área tem suas consultas e componentes: `lib/dados-pedido.ts` e `components/pedido/`, `lib/dados-operacao.ts` e `components/operacao/` (início, quadro, lista, avisos), `lib/dados-consulta.ts` e `components/consulta/` (fornecedores, itens, convite, voz), `components/chat/` e `components/conta/` (demonstração). Avisos do sino em `lib/avisos.ts`, tirados do estado dos pedidos.
- Rodar com recarga automática: `npm run telas:dev` (porta 3300; pare o container `telas` antes, porque usa a mesma porta). Conferir tipos: `npm run telas:tipos`.
- Depois de mudar: `docker compose up -d --build telas`.
- A tela fala a língua do comprador: "assistente" (nunca "bot"), sem siglas de módulo, fornecedor simulado sempre com a marca "simulado", aprovação sempre em dois toques.
- Testes de integração (`npm run checar`) limpam o banco de teste: não rode ao mesmo tempo que uma simulação (`npm run simular`) no mesmo banco.
