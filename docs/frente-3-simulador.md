# Plano: agente do fornecedor robusto e simulador geral

Plano de 08/11/2026, para depois da integração das frentes. Nada daqui foi implementado. O objetivo é que a conversa com fornecedores aguente situações e fornecedores diversos, e que um simulador geral prove isso de forma repetível, sem gastar busca real.

Leia junto com [frente-3-harness.md](frente-3-harness.md) (Assistente do chat e avaliação), [arquitetura.md](arquitetura.md) e [decisoes.md](decisoes.md).

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
| R11 | Fornecedor pede dados da empresa | Passa só o básico (ver §7, pergunta 2) | Responde só com os dados do pedido |
| R12 | Validade da proposta vence antes da decisão | Pergunta ao fornecedor se dá para estender a validade | Não tratado |
| R13 | Condição de pagamento | O padrão da empresa é à vista. Se o fornecedor quiser outra condição, o agente negocia; se ele não aceitar, a decisão volta ao comprador | Pagamento só pesa 5% na nota; antecipado com fornecedor novo gera alerta |
| R14 | Pendências e a regra dos 3 | Se houver pendência de qualquer tipo, o fluxo segue até o fim ignorando as propostas pendentes **se, e somente se, houver 3 fornecedores sem pendência nenhuma**. Com exatamente 3 e um deles pendente, não segue: espera | Mapa sai quando todos respondem ou o prazo vence; com menos de 3 válidas, nunca diz "melhor" |

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

1. **Regra dos 3 e o prazo:** se o prazo de respostas vencer com menos de 3 propostas sem pendência, o item espera para sempre, espera até um limite (qual?), ou sai o mapa com o que tem, com o aviso de "menos de 3" (Q2 de hoje)?
2. **Dados básicos da empresa (R11):** sugiro razão social, CNPJ, endereço de entrega, janela de recebimento e nome de quem recebe (se o pedido tiver). Nunca: dados bancários, telefone ou e-mail pessoal, orçamento, valores de outros fornecedores. Está certo?
3. **Pagamento à vista (R13):** "à vista" quer dizer pagar na entrega (contra a nota), certo? Pagamento antecipado (antes da entrega) também conta como "outra condição" a negociar? E o agente deve pedir desconto pelo pagamento à vista?
4. **Negociação de prazo (R3b):** até quanto de frete a mais o agente pode aceitar sem perguntar ao comprador? Ou ele só traz a proposta nova e o comprador decide no mapa?
5. **Ainda sem resposta da lista anterior** (seguem as sugestões até você dizer o contrário): pedido com vários itens continua cotado um por vez (14); sem segunda aprovação por valor (15); com login, cada comprador vê os seus pedidos (16); os perfis de fornecedor e comprador de §3.2 e §3.3 (17 e 18).
