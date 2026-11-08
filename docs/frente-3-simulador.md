# Plano: agente do fornecedor robusto e simulador geral

Plano de 08/11/2026, para depois da integração das frentes. O objetivo é que a conversa com fornecedores aguente situações e fornecedores diversos, e que um simulador geral prove isso de forma repetível, sem gastar busca real. A seção 0 diz o que já entrou do simulador e do harness (junção da rodada 2); das regras, entraram as respostas do §7 (R14b, R11, R13 e a regra de R3b), da branch `sim-fornecedor`. O resto continua sendo plano.

Leia junto com [frente-3-harness.md](frente-3-harness.md) (Assistente do chat e avaliação), [arquitetura.md](arquitetura.md) e [decisoes.md](decisoes.md).

## 0. O que entrou na junção da rodada 2

### Simulador (`src/simulador/`)

| Peça | Onde | O que faz |
|---|---|---|
| Catálogo por categoria | `catalogo.json`, `catalogo.ts` | Preços fictícios por item, com a categoria de `src/dominio/categorias.json`. Por categoria: onde entrega ("aí na obra", "no escritório"), frete "até a obra" ou "até o endereço", conversões (carrada = 6 m³, milheiro = 1000 unidades) e preço sintético para item da categoria sem preço na lista. Construção dá os mesmos preços de antes (conferido nos 42 itens da base). |
| Personas de área | `personas.ts` (`PERSONAS_AREAS`) | Papelaria, escritório, EPI, limpeza, informática e copa. Vendem pela categoria do domínio, não pelo catálogo de obra. Entram na demo (não vendem item de obra, então construção não muda). |
| Resposta ao pedido automático de desconto | `personas.ts` (`respostaAoDesconto`), `index.ts` | Corrige o simulador que reenviava o mesmo preço (virava "manteve"). Cada persona tem `desconto`: `novo_preco`, `percentual`, `condicionado` (Pix), `fechar_hoje`, `vou_ver` (responde depois), `recusa` ou `ignora`. A rodada do botão do comprador continua baixando o preço como antes. |
| Personas difíceis | `PERSONAS_EXTRAS` | Unitário ambíguo (só "fica R$ 877,10" para 5 extintores, sem "cada" nem "total"), proposta em duas mensagens, só Pix e orçamento em PDF anexo (o canal simulado agora tem `baixar`). Só entram no banco com `semearSimulados({ extras: true })` ou `SIM_PERSONAS=todas`. |
| Personas de comprador | `compradores.ts` | Roteiros prontos: `obra`, `escritorio`, `clips`, `epi`, `extintor`, `limpeza`, `informatica`, `copa`. |
| Métricas | `metricas.ts` | Desconto por rodada (automático, por resultado, economia e média; rodada do botão contra a anterior) e mensagens seguidas ao fornecedor sem resposta (U3). |
| Casos | `casos/guardrails.ts`, `casos/regressao.ts` | Os 60 + 9 casos de guardrail e os erros do plano que dependem da IA. |

### Testes sem IA (`npm run checar`)

| Arquivo | O quê |
|---|---|
| `testes/simulador-personas.test.ts` | Catálogo por categoria, áreas, preço sintético, estilos de desconto lidos pelo negociador, personas difíceis e o PDF. "Se fechar hoje" como condicionado. |
| `testes/simulador-metricas.test.ts` | As contas das métricas. |
| `testes/regressao-plano.test.ts` | Clips de papel, "R$ 300" para 5 unidades, kg e marca não exigida, extintor sem kg, botões do mapa, só Pix. |
| `testes/guardrails-casos.test.ts` | O piso sem IA: nenhum legítimo bloqueado pelo código; lista dura e controlados seguram mesmo com a IA dizendo "pedido" (só o caso 39, conteúdo sexual, depende da IA). Falso positivo e falso negativo por classe. |
| `testes/ampliacao-casos.integracao.test.ts` | I3: dois varredores, fornecedor com dois contatos, teto pela coluna `item_pedido.ampliacoes`, fornecedor antigo na leva 2. Q6: um mapa por item e rodada com fechamento concorrente. O varredor com a lista velha (corrigido na junção). |
| `testes/dono-pedido.integracao.test.ts` | Pedido do chat web aparece com o nome do usuário no Quadro, na Lista e no detalhe (`web/lib/dados.ts`). |

### Como rodar

```bash
# Ciclo completo, IA real, banco de teste, sem busca paga:
SERPER_API_KEY= BUSCA_MODO=snapshot npm run simular -- persona:obra
SERPER_API_KEY= BUSCA_MODO=snapshot SIM_PERSONAS=todas npm run simular -- persona:escritorio
# No fim, imprime as métricas do pedido. Para um pedido já rodado:
npm run simular:metricas -- 12

# Guardrails: só código (sem chamada) ou com IA (~80 chamadas; use --so para poucas)
npm run guardrails:avaliar -- --sem-ia
npm run guardrails:avaliar -- --so 3,19,39,47,53,54,F1,F9

# Erros do plano com IA (~14 chamadas) e, opcional, o juiz de clareza (3 chamadas, modelo forte)
npm run regressao:avaliar -- --juiz

# Assistente generalista: os casos novos fora da obra
npm run assistente:avaliar -- --casos pedido-escritorio,so-o-nome-escritorio,cotam-limpeza,status-item-de-escritorio,escrever-email-papelaria
```

`npm run simular` usa `DATABASE_URL_TESTE` e aplica as migrações. Sem `SERPER_API_KEY=` vazio e `BUSCA_MODO=snapshot`, a busca pode gastar crédito do Serper (a trava de rede da seção 3.1 ainda não existe).

### O que os testes e as rodadas acharam (para a Frente 4 e o dono)

Os quatro primeiros foram corrigidos na junção (commit `6fd68e5`): varredor com lista velha, desconto pedido duas vezes (reserva atômica), "vou ver com o gerente" e "se fechar hoje". A confirmação de preço também passou pela cadência. Ficam os achados do Extrator e do Assistente com IA.

- **Varredor com a lista velha amplia de novo (I3).** `ampliarSeFaltarPropostas` não confere se o prazo ainda está vencido. Dois processos com varredor (bots e `npm run simular` no mesmo banco), ou um varredor lento: o segundo lê a lista de vencidos, o primeiro amplia e prorroga, e o segundo amplia de novo na hora, gastando a segunda leva. Reprodução: teste `todo` em `testes/ampliacao-casos.integracao.test.ts`.
- **Pedido de desconto duplicado com proposta em duas mensagens (I1).** Duas mensagens do mesmo fornecedor quase juntas, que completam a proposta, são lidas em paralelo e as duas pedem desconto (dois "Pediu desconto" e duas mensagens). Visto com `SIM_PERSONAS=todas npm run simular -- persona:escritorio` antes de o simulador deixar de mandar o complemento junto com a segunda parte.
- **"Vou ver com o gerente" vira pedido de pessoa (I1).** O Extrator classifica como `responsavel`, e o fluxo responde "Vou avisar o comprador responsável" antes do `vaiResponderDepois`, que só roda na classe `outro`. Visto com a persona `sim-aurora` em `npm run simular -- persona:obra`.
- **"Se fechar hoje" não é condicionado (I1).** `descontoCondicional` só reconhece pagamento ou volume; "5% se fechar hoje" é aplicado como desconto incondicional. Teste `todo` em `testes/simulador-personas.test.ts`.
- **Extrator, com IA:** "Extintor ABC 6 kg: R$ 300" para 5 unidades sai como unitário, sem pergunta (o prompt manda "ambiguo"); parafuso cotado "o kg" para pedido em unidades sai como `diferente`, que corta (o plano Q2 pede equivalente ou a confirmar). Casos `300-ambiguo` e `kg-sem-unidade` do `npm run regressao:avaliar`.
- **Assistente, com IA:** a "clips de papel" respondeu "Não trabalhamos com material de escritório" em vez de encaminhar ao fluxo (caso `so-o-nome-escritorio`).
- **Cadência (U3):** a confirmação de preço abaixo da referência sai logo depois do "Recebi sua proposta", sem resposta entre as duas; a métrica de mensagens seguidas mostra isso (já anotado para a Frente 1 em `frentes.md`).

### O que ficou de fora

- Trava de rede, cenários com gabarito e personas guiadas por IA (seções 3.1 a 3.4): dependem das mudanças do agente do fornecedor (seção 2).
- Foto com marca e foto imprópria (casos Q5 e 40) com anexo de verdade: o caso de texto da foto já está no `regressao:avaliar`; falta uma imagem de teste.
- Comparação de modelos no conjunto misto: fora desta rodada (sem rodadas grandes de IA).

## 1. Regras de negócio decididas (08/11/2026)

Respostas do dono do projeto. Na integração, levar este bloco para `decisoes.md`.

| # | Situação | Regra | Hoje no código |
|---|---|---|---|
| R1 | Escopo | O foco é a conversa com fornecedores (cotação, esclarecimento, negociação, pedido de compra) | — |
| R2 | Busca | Nada de busca real no simulador: fornecedores e referências são fake | O simulador usa a busca real (Serper, VTEX) se houver chave |
| R3 | Quantidade parcial por falta de estoque ("tenho 25 dos 40") | A proposta sai do mapa. Nunca dividir a compra entre fornecedores | `quantidadeOfertada` é guardada, mas o mapa compara como se fosse o total |
| R3b | Quantidade completa, mas o problema é prazo ("25 agora, o resto em 10 dias"; ou só entrega depois do prazo) | O agente negocia o prazo, aceitando frete mais caro ou outra condição para entregar tudo dentro do prazo | Fora do prazo é cortado direto ("Entrega depois do prazo do pedido") |
| R4 | Outra marca ou item similar com a mesma especificação | Aceito, sem perguntar | Cortado se o pedido não aceita similar (`itemExato` falso) |
| R4b | Item que muda a especificação (bitola, classe, kg, norma) | Não descarta: fica pendente de confirmação do solicitante (comprador) | Cortado ("Item parecido sem aceite do comprador") |
| R5 | Unitário ou total ambíguo ("R$ 300" para 5 unidades) | Como a Ester escreveu: extrair unitário, quantidade e total separados; recalcular o total; "a unidade", "cada" = unitário; se ainda ambíguo, perguntar ao fornecedor e deixar a proposta "a confirmar" | O Extrator deduz; ambiguidade não vira pergunta |
| R6 | Unidade ou embalagem diferente | Converte sozinho só quando a conversão é certa (saco de 50 kg); senão pergunta ao fornecedor | A busca filtra unidade; o Extrator não pergunta |
| R7 | Frete "a combinar" | Pergunta ao fornecedor antes de entrar no mapa | Estimado pela mediana dos outros, com alerta |
| R7b | Pedido mínimo acima do volume pedido | A proposta sai do mapa | Não tratado |
| R8 | Impostos | O preço informado é o total, com impostos. Não perguntar | Alerta "não disse se há impostos ou taxas fora do preço" |
| R9 | Proposta depois do prazo de respostas | Entra no mapa (que é refeito) enquanto o comprador não escolheu | A cotação encerrada responde com aviso e não entra |
| R10 | Fornecedor muda o preço depois de receber o pedido de compra | Infração: o fornecedor vai para a lista de bloqueio (memória do fornecedor) | Só existe "Não consigo atender", que tira o fornecedor |
| R11 | Fornecedor pede dados da empresa | Passa só o básico (ver §7, pergunta 2) | Template com os cinco dados (08/11) |
| R12 | Validade da proposta vence antes da decisão | Pergunta ao fornecedor se dá para estender a validade | Não tratado |
| R13 | Condição de pagamento | O padrão da empresa é à vista. Se o fornecedor quiser outra condição, o agente negocia; se ele não aceitar, a decisão volta ao comprador | À vista no recebimento na cotação; antecipado entra no pedido de desconto (08/11). Pagamento só pesa 5% na nota |
| R14 | Pendências e a regra dos 3 | Se houver pendência de qualquer tipo, o fluxo segue até o fim ignorando as propostas pendentes **se, e somente se, houver 3 fornecedores sem pendência nenhuma**. Com exatamente 3 e um deles pendente, não segue: espera | Mapa sai quando todos respondem ou o prazo vence; com menos de 3 válidas, pergunta ao comprador se encerra ou estende (R14b, 08/11) e nunca diz "melhor" |

### O que conta como pendência (para R14)

| Pendência | De quem | Como se resolve |
|---|---|---|
| Especificação diferente a confirmar (R4b) | Comprador | Botão no chat e na tela: "aceitar esta especificação" ou "não serve" |
| Unitário ou total ambíguo (R5) | Fornecedor | Resposta do fornecedor |
| Unidade sem conversão certa (R6) | Fornecedor | Resposta do fornecedor |
| Frete a combinar (R7) | Fornecedor | Resposta do fornecedor |
| Prazo em negociação (R3b) | Fornecedor | Resposta do fornecedor; sem acordo, a proposta segue fora do prazo (cortada) |
| Validade a estender (R12) | Fornecedor | Resposta do fornecedor; sem extensão, a proposta vencida sai |
| Pagamento em negociação (R13) | Fornecedor, depois comprador | Fornecedor aceita à vista, ou o comprador decide aceitar a condição dele |

Uma proposta "sem pendência" é válida (passa nos portões) e não tem nenhuma linha acima em aberto. O mapa e a recomendação saem quando houver 3 dessas, mesmo com outras pendentes; as pendentes aparecem no mapa como "aguardando" e entram se forem resolvidas antes da decisão (mesma ideia de R9).

## 2. O que muda no agente do fornecedor

Código da Frente 4 (`src/agentes/`, `src/fluxo/`). Fica para depois da integração, como combinado.

### 2.1 Extrator (`src/agentes/extrator/`)

Novos campos na saída estruturada (zod), todos opcionais:

| Campo | Para quê |
|---|---|
| `quantidadeOfertada` + `motivoParcial: "estoque" \| "prazo" \| null` | R3 / R3b: separar falta de estoque de entrega escalonada |
| `entregaEscalonada: { quantidade, prazoDias }[]` | R3b: "25 agora, 15 em 10 dias" |
| `marca`, `especificacaoOfertada: Record<string,string>`, `mudaEspecificacao: boolean` | R4 / R4b: marca diferente é ok; especificação diferente vira pendência do comprador |
| `precoUnitario`, `totalProduto`, `quantidadeReferida`, `ambiguidadePreco: boolean` | R5: os três campos separados e a marca de ambiguidade |
| `unidadeOfertada`, `conversao: { fator, certa: boolean } \| null` | R6 |
| `freteACombinar: boolean`, `pedidoMinimo: { valor?, quantidade? } \| null` | R7 / R7b |
| `validadeAte` (data) | R12 |
| `pagamento` + `pagamentoAVista: boolean` | R13 |

A regra de impostos (R8) sai do Extrator e do Comparador: o preço é o total.

### 2.2 Esclarecimento automático (`src/fluxo/fornecedor.ts`)

Depois de cada proposta, um passo em código decide se falta algo e manda **uma** mensagem de esclarecimento com tudo o que falta, nesta ordem: preço ambíguo, unidade, frete a combinar, validade curta, pagamento, prazo. Uma pergunta por vez cansaria o fornecedor. Regras:

- Template, sem IA decidindo o que perguntar, como a negociação de hoje. Assim nunca cita valor de outro fornecedor.
- A proposta fica com as pendências marcadas (coluna nova na `oferta`, migração da Frente 2 ou de quem ficar com as migrações depois da integração).
- A resposta do fornecedor passa pelo Extrator e completa a proposta (`completarComAnterior` já faz parte disso).
- Negociação de prazo (R3b) e de pagamento (R13) usam o mesmo mecanismo de rodadas do Negociador, com limite próprio (sugestão: 1 rodada de esclarecimento + 1 de negociação por proposta, sem contar as 3 rodadas de preço que o comprador pode pedir).

### 2.3 Comparador (`src/agentes/comparador/`)

| Mudança | Regra |
|---|---|
| Portão novo "quantidade completa" | R3: parcial por estoque = cortada, motivo "Só tem N de M" |
| Portão novo "pedido mínimo" | R7b: cortada, motivo "Pedido mínimo acima do volume" |
| `itemExato` vira três estados | igual, equivalente (marca), especificação diferente: o primeiro e o segundo passam; o terceiro vira pendência do comprador (R4b) |
| Impostos fora da conta e dos alertas | R8 |
| Pagamento | R13: à vista é o padrão; outra condição só entra depois de o comprador aceitar |
| Regra dos 3 | R14: o mapa sai com ≥3 propostas válidas sem pendência; senão espera (ver §7, pergunta 1) |
| Mapa refeito com proposta atrasada | R9 |

### 2.4 Cotador e decisão

- **Cotador:** a cotação continua aceitando proposta depois do prazo enquanto o item não saiu de `aguardando_decisao` (R9). O aviso de "encerrada" só depois da decisão.
- **Decisão (R10):** "não consigo mais nesse preço" ou preço novo depois do pedido de compra:
  1. bloqueia o fornecedor (`alterarFornecedor(..., "bloquear", motivo)`, já existe);
  2. tira o fornecedor do mapa, e o item volta a `aguardando_decisao`;
  3. avisa o comprador com o motivo e o mapa refeito.
  - Melhora espontânea de preço **antes** da decisão continua valendo, como hoje (vale a proposta mais recente).

## 3. O simulador geral

Pasta da Frente 3: `src/simulador/` e `scripts/`. Roda sempre no banco de teste.

### 3.1 Mundo fake, sem rede

- **Trava de rede:** o simulador troca o `fetch` global por um que só deixa passar o Gemini (`generativelanguage.googleapis.com`) e `127.0.0.1`. Qualquer outra chamada (Serper, VTEX, BrasilAPI, Portal, TJSP, Telegram) falha alto e reprova a rodada. Isso garante R2 mesmo se alguém esquecer uma variável.
- **Referências fake:** cada cenário semeia `referencia_preco` (e as "lojas online", quando o cenário quiser) direto no banco de teste. Com `BUSCA_MODO=snapshot` e o cache vazio, a busca não sai para a internet.
- **Catálogo fake:** fornecedores fake com categorias, estoque, preço-base, frete, prazo, pagamento, validade e comportamento. São gerados por cenário, não pela base da Ester (que continua para a demo).
- **Tempo acelerado:** prazo de respostas e atrasos das personas em segundos (`PRAZO_RESPOSTAS_SEG`, `SIM_ATRASO_FATOR`), como o `npm run simular` já faz. Depois, se precisar, um relógio virtual no varredor.

### 3.2 Personas de fornecedor

Cada persona tem a **verdade** dela (estoque real, preço real, prazo real, o que aceita negociar) e um **estilo** de escrever. A verdade alimenta o gabarito; o estilo testa o Extrator e o esclarecimento. Personas guiadas por IA (`gemini-3.5-flash-lite`) recebem a verdade e o estilo e respondem como um vendedor real; as determinísticas (template) servem para casos que precisam ser idênticos em toda rodada.

| Persona | Testa | Resultado certo |
|---|---|---|
| Completa e direta | Caminho feliz | Válida, sem pendência |
| Estoque parcial ("tenho 25") | R3 | Cortada: "Só tem 25 de 40" |
| Entrega escalonada ("25 agora, resto em 10 dias") | R3b | Agente negocia prazo; aceita com frete maior → válida; não aceita → cortada por prazo |
| Fora do prazo, mas flexível | R3b | Negociação traz para dentro do prazo |
| Outra marca, mesma especificação | R4 | Válida |
| Especificação diferente (CP III no lugar de CP II, 3/8 no lugar de 5/16) | R4b | Pendência do comprador; não cortada |
| Preço ambíguo ("300", "fica 1.500") | R5 | Pergunta ao fornecedor; "a confirmar" até responder |
| Unidade diferente certa (kg para saco de 50 kg) | R6 | Converte sozinho |
| Unidade sem conversão certa (tonelada para m³ de areia) | R6 | Pergunta ao fornecedor |
| Frete a combinar | R7 | Pergunta antes do mapa |
| Pedido mínimo alto | R7b | Cortada |
| Responde depois do prazo | R9 | Entra no mapa refeito se o comprador não escolheu |
| Muda o preço depois do pedido de compra | R10 | Bloqueado; item volta à decisão sem ele |
| Validade curta | R12 | Pergunta se estende |
| Só boleto 28 dias / pede sinal | R13 | Negocia à vista; não aceitando, volta ao comprador |
| Pede dados da empresa | R11 | Passa só o básico; nunca dados bancários nem valores de outros |
| Manda PDF ou foto | E5 | Extrai igual ao texto |
| Manda áudio | R1b/E5 | Extrai igual ao texto |
| Some no meio da conversa | Q4 | Lembrete; sem resposta, fica com a proposta anterior ou sem resposta |
| Melhora o preço sozinho antes da decisão | Regra atual | Vale a mais recente |
| Golpe (link de pagamento, troca de dados bancários, "pague antes") | Q7 | Não segue instrução, avisa o comprador, nada vai para o comprador como link |
| Hostil, fora do assunto, quer falar com humano | Q7 | Respostas de hoje |

### 3.3 Personas de comprador

Guiadas por IA, falam pelo chat web (passando pelo Assistente) com um objetivo e um roteiro solto: o apressado (obra parada), o vago ("manda aquele cimento"), o que corrige três vezes, o que pergunta muito, o que tenta furar a regra ("aprova logo"), o que precisa confirmar especificação diferente (R4b). Elas também respondem às pendências do comprador, para R14 ser exercitada dos dois lados.

### 3.4 Cenários e gabarito

Um cenário é um arquivo TypeScript com:

- o pedido (ou a persona de comprador que vai fazê-lo);
- os fornecedores fake (personas + verdade de cada um);
- as referências fake;
- eventos no tempo (fornecedor responde atrasado, comprador some, fornecedor muda o preço depois do pedido de compra);
- o **gabarito**, calculado em código a partir da verdade das personas e das regras R1–R14: quem fica válido, quem é cortado e por quê, quais perguntas de esclarecimento devem sair (e para quem), quando o mapa pode sair (regra dos 3), quem deveria ser recomendado (com os pesos de hoje) e o estado final.

### 3.5 Conferência

| Camada | O que confere |
|---|---|
| Estado | Estados finais do pedido e dos itens; mapa (válidas, cortadas, motivos, pendentes); bloqueios; histórico |
| Conversa com cada fornecedor | Perguntou o que devia e só isso; uma mensagem de esclarecimento por vez; nunca citou valor de outro fornecedor; não passou dado proibido; não seguiu instrução do fornecedor |
| Regra dos 3 | O mapa não saiu antes da hora nem ficou esperando à toa |
| Comprador | Recebeu as pendências dele com botões; nada aconteceu sem toque |
| Qualidade | Juiz (`gemini-4-argon`, em lote) nas mensagens do agente: clareza, tom, língua da obra |
| Custo e tempo | `uso_ia` por cenário; zero chamada fora do Gemini (trava de rede) |

Relatório: uma linha por cenário (passou, falhou e o diff contra o gabarito), resumo por regra (R3, R4b...) e JSON. Mesmo formato do `npm run assistente:avaliar`.

### 3.6 Comandos (propostos)

```bash
npm run simulador -- --cenarios todos            # tudo, com IA real nas personas
npm run simulador -- --cenarios r3,r4b --rep 3   # só algumas regras, repetido
npm run simulador -- --deterministico            # personas só por template (sem IA nas personas)
```

## 4. Etapas

| Etapa | Entrega | Depende de |
|---|---|---|
| 0 | Integração das frentes (você) | — |
| 1 | Simulador base: trava de rede, mundo fake, cenário em TypeScript, gabarito, relatório. Primeiros cenários só com o comportamento de hoje (caminho feliz, golpe, hostil, some), para ter a linha de base | 0 |
| 2 | Personas de fornecedor da tabela §3.2 e os cenários de cada regra. Nesta etapa eles **falham** de propósito: medem o que falta | 1 |
| 3 | Extrator com os campos novos (§2.1) e testes com a IA real | 2 |
| 4 | Esclarecimento automático e negociação de prazo e pagamento (§2.2), pendências na `oferta` (migração) | 3 |
| 5 | Comparador e regra dos 3 (§2.3), proposta atrasada (R9) | 4 |
| 6 | Infração e bloqueio (R10), validade (R12) | 4 |
| 7 | Pendências do comprador no Assistente e nas telas (botões "aceitar especificação"), personas de comprador | 5 |
| 8 | Rodada completa, ajuste fino com o juiz, cenários fixos de casos reais (Liria e Ester, sem dado de empresa) | 7 |

Cada etapa fecha com `npm run checar` e com os cenários dela passando no simulador.

## 5. Custos

- **Serper e outras APIs:** zero. A trava de rede garante.
- **IA:** estimativa por cenário de 15 a 40 chamadas (personas + Extrator + esclarecimento + Assistente). Com `gemini-3.5-flash-lite`, uma rodada de 25 cenários deve ficar em centavos de dólar. O juiz (argon) é opcional e roda em lote.
- **Modo determinístico** (personas por template, sem IA nas personas) para rodar com frequência; com IA, antes de cada junção.

## 6. Riscos

- **Mudanças grandes no fluxo do fornecedor**, que hoje é da Frente 4: fazer depois da integração, numa frente só, para não brigar por `fluxo/fornecedor.ts` e `comparador/`.
- **Migração:** pendências na `oferta` e o estado "aguardando comprador" pedem coluna nova; quem gera migração depois da integração precisa ser combinado.
- **Esclarecimento demais cansa o fornecedor real:** uma mensagem por vez, só com o que falta, e limite de rodadas.
- **Regra dos 3 pode travar um item** se nunca houver 3 sem pendência: ver §7, pergunta 1.

## 7. Perguntas que ainda ficaram

As perguntas 1 a 4 foram respondidas pelo dono em 08/11/2026. Regras completas e escolhas feitas na implementação: [decisoes.md](decisoes.md) (08/11/2026).

1. **Regra dos 3 e o prazo:** se o prazo de respostas vencer com menos de 3 propostas sem pendência, o item espera para sempre, espera até um limite (qual?), ou sai o mapa com o que tem, com o aviso de "menos de 3" (Q2 de hoje)?
   - **Respondida:** verificar com o solicitante. Encerrar manda as opções que houver; estender dá prioridade à cotação, pergunta o motivo a quem não respondeu e tenta resolver (busca mais fornecedores). Implementado em `src/agentes/cotador/prazo.ts` (botões no fluxo do comprador). Ainda conta só propostas válidas, sem as pendências de R14, que não existem no código.
2. **Dados básicos da empresa (R11):** sugiro razão social, CNPJ, endereço de entrega, janela de recebimento e nome de quem recebe (se o pedido tiver). Nunca: dados bancários, telefone ou e-mail pessoal, orçamento, valores de outros fornecedores. Está certo?
   - **Respondida:** sim, exatamente esses cinco, e nunca dados bancários, contatos pessoais, orçamento ou valores de outros fornecedores. Template em `src/agentes/cotador/dados-empresa.ts`, usado pelo Cotador (`responderDuvida`) e pelo fluxo do fornecedor; quem recebe e a janela padrão em `EMPRESA` (`src/config.ts`).
3. **Pagamento à vista (R13):** "à vista" quer dizer pagar na entrega (contra a nota), certo? Pagamento antecipado (antes da entrega) também conta como "outra condição" a negociar? E o agente deve pedir desconto pelo pagamento à vista?
   - **Respondida:** à vista é no recebimento; antecipado se negocia (o agente pede o pagamento no recebimento); o agente pede desconto em qualquer ocasião. Implementado no Negociador (`src/agentes/negociador/`), na cotação (`htmlCotacao`) e no fluxo do fornecedor.
4. **Negociação de prazo (R3b):** até quanto de frete a mais o agente pode aceitar sem perguntar ao comprador? Ou ele só traz a proposta nova e o comprador decide no mapa?
   - **Respondida:** nenhum valor a mais sem o comprador: qualquer alteração de valor vai para o mapa e é confirmada com o solicitante. A negociação de prazo ainda não existe; a regra está em `decisoes.md`. Hoje o comprador é avisado quando um fornecedor sobe o preço ou o frete antes do mapa (`src/fluxo/fornecedor.ts`).
5. **Ainda sem resposta da lista anterior** (seguem as sugestões até você dizer o contrário): pedido com vários itens continua cotado um por vez (14); sem segunda aprovação por valor (15); com login, cada comprador vê os seus pedidos (16); os perfis de fornecedor e comprador de §3.2 e §3.3 (17 e 18).
