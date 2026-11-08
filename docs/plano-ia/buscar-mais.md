# I3: buscar mais fornecedores sozinho (desenho, sem implementação)

Anexo de [plano-ia.md](../plano-ia.md) (item I3), de 08/11/2026.

Decisão do dono: no fim do prazo de respostas, se não houver pelo menos 3 propostas, buscar mais fornecedores. Prazo de 15 min no teste e de no mínimo 3 dias na vida real. Repete até ter 3 ou acabarem os candidatos.

## 1. Como funciona hoje

**Fim do prazo**
- A busca grava o prazo ao entrar em `cotando`: `src/agentes/busca/index.ts:168-175` (`prazoRespostasEm` e `lembreteEm` = metade).
- O prazo vem de `prazoRespostasMs` (`src/config.ts:32-37`): em demo, `PRAZO_RESPOSTAS_SEG` (300 s por padrão; 900 s para os 15 min); em real, 3 dias (5 se o valor estimado passa de `LIMITE_COMPRA_MAIOR`) e 2 dias na negociação. O valor estimado não é gravado no item: só existe dentro de `buscar()`.
- O varredor roda a cada 5 s (`src/nucleo/orquestrador/index.ts:304-320`). **Primeiro** executa as tarefas registradas com `aoVarrer` (hoje só o lembrete do Cotador), **depois** `varrerPrazos` (`:280-296`), que manda `encerrar_cotacao` aos itens `cotando` com prazo vencido (`cotando -> comparando`, `estados.ts:83`).
- Fechamento antecipado: `encerrarSeTodosResponderam` (`src/agentes/cotador/index.ts:233-266`) fecha quando ninguém está `aguardando`. Proposta incompleta segura o fechamento até o prazo (`:244-257`).
- Ao entrar em `comparando`, `marcarSemResposta` (`cotador:269-293`) marca os `aguardando` como `sem_resposta` e manda "pedido encerrado". Depois o Comparador monta o mapa (`comparador/index.ts:201-295`).

**Menos de 3 propostas hoje**
- `comparar()` (`calculo.ts:233-259,270`) conta só as válidas (portões `calculo.ts:190-196`). Com menos de 3, `podeDizerMelhor=false` e entra um alerta.
- O Comparador grava `justificativaMenosDeTres` (`comparador/index.ts:235-241`, texto fixo "poucos fornecedores responderam a tempo") e o mapa segue.
- Com 0 válidas, o item vai a `sem_proposta` (`:222-233`).
- Não existe disparo automático. O plano diz "na metade do prazo" (`plano-ia.md:235-241`), mas a decisão do dono é "no fim do prazo".

**"Buscar mais" do comprador**
- Botão "Prazo longo: buscar mais fornecedores" (`src/fluxo/decisao.ts:152`), tratado em `:206-213`: `avancarItem(..., "voltar_busca", ...)` com `prazoRespostasEm:null`. A transição é `aguardando_decisao|comparando -> buscando` (`estados.ts:88`).
- `buscar()` (`busca/index.ts:76-80`) soma 1 a `item.rodada`, refaz a busca na internet e as lojas online (`:116-118`), chama `candidatos()` (todos de novo) e corta em `MAX_FORNECEDORES` (`:129-130`, padrão 8, `config.ts:47`).
- Cria cotações da rodada nova para **todos**, inclusive quem já respondeu (`:152-155`). Reinicia o prazo (`:168-175`) e cai em `cotando`, onde `enviarCotacoes` manda a cotação (`cotador:147-173`).
- Consequência: a rodada antiga morre. `cotacaoAbertaDo` (`cotador:205-214`) exige `cotacao.rodada = item.rodada`, então fornecedor da rodada anterior que responde depois não é ligado ao item.
- Por isso o caminho do botão não serve como está para a busca automática. Ele serve de modelo (`candidatos()`, insert em `cotacao`, loop de envio), mas a ampliação automática **não** pode somar rodada.

## 2. Desenho

### 2.1 Momento do disparo
Uma função nova no Cotador, `ampliarSeFaltarPropostas(itemPedidoId)`. Dois pontos de chamada:

1. **Fim do prazo.** Nova tarefa `aoVarrer(ampliarVencidos)` em `ligarCotador()` (`cotador:399-403`). Como as tarefas rodam **antes** de `varrerPrazos` no mesmo tick (`orquestrador:311-312`), quando a ampliação prorroga `prazoRespostasEm` o item deixa de ser selecionado como vencido. **Não precisa mexer em `src/nucleo/orquestrador/`.** Se a tarefa lançar erro, o varredor já a captura (`:311`) e `varrerPrazos` fecha como hoje (falha segura).
2. **Todos responderam antes do prazo.** Dentro de `encerrarSeTodosResponderam`, antes do `avancarItem`. Ninguém está devendo resposta e esperar o prazo seria ocioso. É uma extensão da decisão do dono, a **confirmar**: se ele quiser estritamente "no fim do prazo", basta não chamar aqui, e o fechamento antecipado continua como hoje.

Não há transição de estado nova: o item **fica em `cotando`**. Justificativa: voltar a `buscando` levaria o cartão de volta à coluna "Solicitado" (`COLUNA_DO_ITEM`), exigiria evento novo em `estados.ts` e `buscar()` rodaria recompra e busca na internet de novo. Alternativa B, se o dono preferir ver a etapa no quadro: evento `ampliar_busca` (`cotando -> buscando`), ramo próprio em `buscar()` que pula recompra e internet e filtra os já consultados, e `busca_concluida` de volta. Custa mais código e mexe no diagrama de estados.

**Guardas, na ordem (qualquer uma impede ampliar):**
- `estado = cotando`.
- Não é rodada de negociação: `item.negociacao?.rodada === item.rodada` (senão a rodada de contraproposta, que usa o mesmo estado e o mesmo varredor, dispararia ampliação).
- `ampliacoes < MAX_AMPLIACOES`.
- Contagem de propostas < 3.
- Há candidato novo.

**Claim atômico (corrida entre varredores).** Mesmo padrão de `enviarLembretes` (`cotador:302-307`):
`UPDATE item_pedido SET prazo_respostas_em = <novo>, lembrete_em = <metade>, ampliacoes = ampliacoes + 1 WHERE id = ? AND estado = 'cotando' AND prazo_respostas_em <= now AND ampliacoes < MAX RETURNING id`. Só quem recebe linha continua. A função devolve `"ampliou" | "encerrar" | "pular"`. Quem perde o claim devolve `"pular"` e **não** encerra.

Ordem interna: calcular candidatos (leitura), claim, `insert` em `cotacao` (`onConflictDoNothing`), enviar, registrar, avisar.

### 2.2 O que conta como "proposta"
**Recomendação: proposta válida pelo portão do comparador**, ou seja, `comparar(...).validas.length`, o mesmo número que decide `podeDizerMelhor` (`calculo.ts:270`).

- Contar "qualquer resposta com preço" deixaria passar proposta cortada (sem prazo, fora do prazo do pedido, item parecido sem aceite, não entrega no local, preço retido). O mapa sairia com "menos de 3" mesmo tendo 3 "propostas", e o objetivo de I3 é justamente o mapa poder dizer "melhor". Uma só regra evita divergir do Comparador.
- Proposta **retida** (30% abaixo da referência, `calculo.ts:195`) não conta: ainda não é válida. Risco aceito e pequeno: o fornecedor confirmando depois não reabre a ampliação.
- Contagem por fornecedor (já deduplicado em `carregar`, `comparador/index.ts:43-47`): quem respondeu em rodada de negociação conta uma vez só. Quem desistiu, pediu PARAR ou foi excluído pelo comprador fica de fora, como no mapa.

**Mudança necessária (Frente 1):** exportar do Comparador `contarPropostasValidas(itemPedidoId): Promise<number>`, que reaproveita `carregar` + `comparar` **sem** `verificarVarios` (consulta externa de CNPJ, `comparador/index.ts:61`, cara e desnecessária para só contar; basta um parâmetro `semVerificacao`). A confiança só altera nota, não o portão, então a contagem é a mesma. O Cotador importa essa função (já há dependência Cotador -> Negociador; Comparador -> Cotador não existe, então não há ciclo, mas confirmar na hora).

### 2.3 Lojas online
**Contam**, porque já são ofertas válidas no mapa (`formato = "busca"`, portões passam) e o Comparador as soma em `validas`. Excluí-las só da contagem faria o sistema continuar buscando quando o mapa já pode dizer "melhor". Custo: com 3 lojas online, nunca se amplia, e a negociação com fornecedores reais perde alcance. Se o dono quiser a outra leitura ("só fornecedores que cotaram de verdade"), basta filtrar `online` no `contarPropostasValidas`, via flag em `config.ts`. Marcar como pergunta ao dono.

Na ampliação **não se refaz** `buscarNaInternet` nem `ofertasDaInternet` (`internet.ts:334-347` apaga e recria as ofertas online da rodada; chamada paga e igual à primeira). Candidatos da ampliação vêm só da base com canal ativo (`candidatos()`). Convite por e-mail a fornecedor real não é automático (regra do projeto: nunca mandar e-mail a fornecedor real), então não entra.

### 2.4 Rodadas, prazo e quem ainda responde
- **Teto: 2 ampliações** (3 levas no total: a original e mais 2), constante `MAX_AMPLIACOES = 2` em `src/config.ts` (Frente 1), no espírito do `MAX_RODADAS = 3` da negociação. Pior caso: demo 15+15+15 = 45 min; real 9 dias (3+3+3), longo, mas é o que a regra "mínimo 3 dias por leva" produz. O dono pode baixar para 1 se achar demais. Item urgente (`pedido.urgencia != normal`): pergunta aberta ao dono. A justificativa atual do Comparador já diz que esperar mais custaria mais (`comparador/index.ts:238`); sugiro que urgente tenha no máximo 1 ampliação.
- **`item.rodada` não muda.** Isso dá três efeitos bons de graça: (a) os antigos continuam `aguardando` e `cotacaoAbertaDo` ainda os liga ao item, então **continuam podendo responder** até o novo prazo; (b) o índice único `(item, fornecedor, rodada)` (`schema.ts:226`) dedupa de vez; (c) o `consultados` do mapa (`comparador/index.ts:95-100`) já soma os novos.
- **Prazo reinicia para o item inteiro**: `prazoRespostasEm = agora + prazoRespostasMs(valorEstimado)`, `lembreteEm` na metade. Em demo, 900 s; em real, 3 dias. O `valorEstimado` não está no item: recalcular de `referenciasDoItem(item.id).mediana * quantidade` (leitura que o Comparador já faz) ou passar `null` (3 dias, que é o "mínimo" do dono). Recomendo recalcular, para compra grande não ganhar uma leva mais curta (5 dias) que a original. Não precisa coluna.
- **Fornecedores antigos:** nenhuma mensagem nova a quem está `aguardando`. A prorrogação é silenciosa; o texto que eles receberam diz o prazo antigo, mas a resposta continua valendo. O fim do prazo manda o "encerrado" só no final (`marcarSemResposta`).
- **Bug a corrigir junto:** `enviarLembretes` (`cotador:308-312`) manda lembrete a **todos** os `aguardando` da rodada, sem olhar `cotacao.lembreteEm`. Com o prazo reiniciado, os antigos receberiam um segundo lembrete. Acrescentar `isNull(cotacao.lembreteEm)` no `where`. Mesmo sem I3 isso protege contra repetição.

### 2.5 Dedupe e candidatos
- `candidatos(item)` devolve todos. Filtrar, **antes** do `slice(0, MAX_FORNECEDORES())` (hoje o corte vem antes do filtro de quem já foi consultado, `busca/index.ts:130`): sem `motivoCorte`, fora dos `fornecedorId` com cotação neste item **nesta rodada** (qualquer situação, inclusive `sem_resposta`, `parou`, `desistiu`: já foram consultados) e fora de `item.excluidos` (comprador tirou do mapa; `buscar()` não filtra isso hoje).
- Extrair `candidatosNovos(item): Promise<Candidato[]>` em `busca/index.ts` (exportada) e usá-la na ampliação. O botão do comprador continua com o caminho antigo.
- **Tamanho da leva:** `MAX_FORNECEDORES()` por leva (teto por leva, não cumulativo; se fosse cumulativo, com 8 na primeira não sobraria vaga). Teto absoluto de custo: 8 x 3 = 24 consultas por item. Ajustável por constante, se o dono achar muito.

### 2.6 O que o comprador vê
Aviso do Cotador (`avisarComprador`, `cotador:200`), na ampliação:
> Pedido 12: só 1 proposta válida de 6 consultados até agora. Consultei mais 5 fornecedores de cimento CP II e prorroguei as respostas até <quando>. Quem já respondeu continua valendo.

Quando desiste, **sem aviso separado**: o mapa sai normalmente com a justificativa certa (Comparador, Frente 1). `justificativaMenosDeTres` passa a dizer, por exemplo: "Apenas 2 propostas válidas: consultei 14 fornecedores em 3 levas e não havia mais candidatos" (ou "atingi o limite de 2 buscas extras"). Para isso o Comparador precisa ler `item.ampliacoes` e o total consultado (já existe, `consultados`) e saber o motivo de parada, ver 2.7. O cabeçalho do mapa já mostra "N propostas válidas de M recebidas (K fornecedores consultados)" (`comparador/index.ts:279`), então o número de consultados cresce sozinho.

### 2.7 Quando desiste e manda o mapa
Devolve `"encerrar"`, e o fluxo atual segue (`avancarItem("encerrar_cotacao")`), quando: já há 3 válidas, ou `ampliacoes >= MAX_AMPLIACOES`, ou `candidatosNovos` vazio, ou a negociação está em curso, ou (se adotado) pedido urgente com 1 ampliação feita. Com 0 válidas ao final, o fluxo atual já leva a `sem_proposta` com a mensagem "Nenhum dos N fornecedores consultados mandou proposta" (`comparador/index.ts:230`); acrescentar quantas levas.
Para o Comparador saber **por que** parou sem criar mais estado: guardar no `registrar` do Cotador (log de auditoria, já existe) e, para o texto do mapa, usar só `ampliacoes` (>0 = houve busca extra) e uma consulta barata de `candidatosNovos(...).length` (0 = esgotou). Se a Frente 1 preferir não chamar Busca, o texto pode ser genérico ("consultei mais fornecedores em N levas") e a distinção "esgotou x teto" fica só no registro.

## 3. Mudanças por arquivo e frente

| Arquivo | Mudança | Frente |
|---|---|---|
| `src/agentes/cotador/index.ts` | `ampliarSeFaltarPropostas` (guardas, claim, insert, envio, aviso, registro); `aoVarrer(ampliarVencidos)` em `ligarCotador`; chamada em `encerrarSeTodosResponderam`; extrair o loop de envio de `enviarCotacoes` (`:147-173`) para `enviarPendentes(item)` reaproveitado; filtro `situacao='aguardando'` nos pendentes (hoje `parou`/`sem_resposta` sem `enviadaEm` seriam reenviados na próxima passagem, `:158,169`); `isNull(cotacao.lembreteEm)` em `enviarLembretes` | 4 |
| `src/agentes/busca/index.ts` | `candidatosNovos(item)` exportada (dedupe por cotação da rodada e `excluidos`, filtro antes do slice) | 4 |
| `src/fluxo/decisao.ts` | `buscar`, `reprovar` e `negociar` zeram `ampliacoes` no patch (rodada nova = ciclo novo; `:198-213`, `:165-170`) | 4 |
| `src/texto.ts` | Textos novos do aviso (se ficarem lá) | 4 |
| `src/agentes/comparador/index.ts` | Exportar `contarPropostasValidas(itemPedidoId)` sem verificação externa; `justificativaMenosDeTres` com "consultei mais N em K levas" e motivo da parada | 1 |
| `src/config.ts` | `MAX_AMPLIACOES` (padrão 2); opcional `ONLINE_CONTA_COMO_PROPOSTA` | 1 |
| `src/nucleo/db/schema.ts` + `drizzle/` | **Coluna nova `item_pedido.ampliacoes integer not null default 0`** | 2 (pedido) |
| `src/nucleo/orquestrador/` | Nada | -- |
| `testes/` e harness | Casos da seção 5 | 3 |

**Precisa de coluna?** Sim, uma: `ampliacoes`. Sem ela, o número de levas teria de ser deduzido de agrupamentos de `cotacao.criadoEm` ou de textos do registro, frágil e que quebra com reinício. É um inteiro simples, sem gatilho de auditoria especial além do padrão do `item_pedido`.

**Pedido à Frente 2 (para "Pedidos entre frentes" em `docs/frentes.md`):** migração `item_pedido.ampliacoes integer not null default 0`. Sem outra coluna: prazo, lembrete e cotações já existem; o valor estimado é recalculado.

## 4. Interação com a negociação automática e a cadência

**Negociação automática (I1: pedir desconto a todos, inclusive à mais barata, assim que a proposta válida chega).**
- Fornecedor que entra na ampliação segue exatamente o mesmo caminho: ao chegar a proposta válida dele, a rodada automática de desconto é disparada, sem tratamento especial. A regra "uma automática por fornecedor" é por fornecedor, então os novos recebem a deles e os antigos não recebem outra.
- **O ponto de fechamento é um só** (o prazo do item). A conta de "tem 3 propostas" não espera contraproposta pendente: conta as ofertas existentes. Se o fornecedor ainda não respondeu ao desconto, a proposta anterior dele é a que vale (regra do `carregar`, `comparador/index.ts:15-17`).
- Ordem no fim do prazo: primeiro a ampliação (se faltarem propostas), depois, ao encerrar, o fluxo de sempre. Se I1 pedir uma janela de negociação própria depois do fim do prazo, ela vem **depois** da última ampliação, não entre levas (senão os novos nunca teriam tempo de responder). Isso fica combinado com quem implementar I1: a rodada de negociação (`negociar`, `cotador:76-120`) usa `item.negociacao` e é excluída pela guarda de 2.1.
- Atraso: fornecedor novo que responde no último minuto da leva ganha um pedido de desconto que alonga a janela (2 dias em real, `prazoRespostasMs(null, true)`). Mitigação: para respostas que chegam depois de `prazoRespostasEm - X` a negociação automática pode ser pulada. Decisão do I1, não do I3.
- Negociação manual do comprador: continua só depois do mapa, sem relação com I3. Reprovar e "cotar de novo" zeram `ampliacoes` (`decisao.ts`).

**Uma pergunta por vez ao fornecedor (U3).**
- A ampliação **não manda nada novo a quem já está na cotação** (prorrogação silenciosa; lembrete só a quem ainda não recebeu o da leva anterior). Não cria segunda pergunta pendente.
- Os fornecedores novos recebem a cotação como primeira mensagem (nada pendente), então não há fila.
- A cobrança do que falta numa proposta incompleta e o aviso de preço a confirmar continuam sob a regra da fila do U3. O "encerrado" do fim do prazo passa direto, como a Ester pediu.
- O aviso ao **comprador** não é mensagem ao fornecedor, então não entra na cadência.

## 5. Riscos e testes

### Riscos
1. **Corrida entre timers.** `ampliarVencidos` e `varrerPrazos` rodam em sequência no mesmo processo (a flag `rodando`, `orquestrador:306-308`, impede sobreposição), mas pode haver dois processos (container dos bots e `npm run bots` local). O claim atômico em `UPDATE ... RETURNING` resolve; `"pular"` ao perder.
2. **Corrida com resposta que fecha antecipado.** `encerrarSeTodosResponderam` pode chamar a ampliação no mesmo instante em que o varredor também chama. Mesmo claim; quem perde não encerra.
3. **Mapa enviado duas vezes.** O mapa só sai ao entrar em `comparando` (`mapa_pronto`). Como a ampliação não muda de estado, não gera mapa; o único risco é o `encerrar_cotacao` duplicado, que o orquestrador já trata com `TransicaoConcorrente/Invalida` (`orquestrador:291`, `cotador:263`). Garantir que `"pular"` nunca leve a `encerrar_cotacao`, senão um varredor encerraria antes de a ampliação do outro terminar de gravar.
4. **Falha depois do claim.** Se o envio falhar depois de gravar `ampliacoes`+prazo, o item fica com a prorrogação e cotações `aguardando` sem `enviadaEm`. Mitigação: o filtro `situacao='aguardando'` + `enviadaEm null` já permite reenvio; sugiro que a tarefa do varredor reenvie esses pendentes (barato) e que o fim do prazo encerre normalmente.
5. **Custo de busca.** Cada leva manda até `MAX_FORNECEDORES` mensagens e gera registro; real com fornecedor de verdade gasta a confiança dele (spam). Teto de 2 levas e dedupe limitam; não refazer busca na internet e não chamar IA na contagem (`verificarVarios` fora).
6. **Contagem cara.** `contarPropostasValidas` roda no máximo uma vez por fim de prazo/fechamento antecipado, nunca por resposta recebida.
7. **Item com `excluidos` ou fornecedor que pediu PARAR.** Já filtrado em `candidatos()` (`motivoCorte`) e em `carregar`.
8. **Prazos longos no real.** Até 9 dias; o comprador deve poder cancelar (já pode, `cancelar` vale em `cotando`). O aviso mostra a nova data.
9. **Retenção de preço** (proposta 30% abaixo da referência) não conta como válida; pode ampliar sem necessidade. Aceito; documentar.
10. **Demo.** Com `SIM_ATRASO_FATOR` baixo, todos respondem rápido e a ampliação sai pelo fechamento antecipado quase na hora; com os simulados "sem canal" ela esgota rápido. Combinar nos roteiros da demo.

### Casos de teste (Frente 3; testes em `testes/`, com relógio e banco de teste)
Usar `PRAZO_MODO=demo`, `PRAZO_RESPOSTAS_SEG` curto, e `varrerPrazos`/`aoVarrer` chamados direto com `agora` controlado.
1. **Feliz:** 8 consultados, só 1 válida no prazo, há 5 candidatos novos -> prazo reinicia, 5 `cotacao` novas na mesma rodada, aviso "consultei mais 5", item segue `cotando`; as 2 válidas novas chegam -> mapa com 3, `podeDizerMelhor=true`.
2. **Sem pendência:** 2 consultados, ambos responderam com 1 válida -> ampliação imediata (fechamento antecipado); idem com `encerrarSeTodosResponderam` chamado duas vezes -> uma só ampliação.
3. **Já tem 3 válidas** no prazo -> nenhum envio, vai para `comparando`.
4. **Só respostas cortadas** (sem prazo, fora do prazo do pedido, item parecido) somando 3 "com preço" e 0 válidas -> amplia (prova que conta válidas, não preço).
5. **Proposta retida** não conta; quando confirmada no mapa o fluxo normal segue.
6. **Lojas online:** 3 lojas online + 0 fornecedores -> não amplia (se a opção for contar). Com a flag desligada, amplia. Internet **não** é consultada de novo (contador de chamadas a `buscarNaInternet`/`ofertasDaInternet` = 1).
7. **Dedupe:** fornecedor já consultado (inclusive `sem_resposta`, `parou`, `desistiu`) e excluído pelo comprador nunca recebe cotação de novo; zero duplicatas por `(item, fornecedor, rodada)`.
8. **Esgotou candidatos:** nenhum novo -> `encerrar_cotacao`, mapa com a justificativa "não havia mais fornecedores".
9. **Teto:** com candidatos sobrando, depois de `MAX_AMPLIACOES` levas encerra, `ampliacoes = 2`, justificativa de teto.
10. **Fornecedor antigo responde na leva 2** (proposta aceita e ligada à rodada certa) e **depois do prazo final** (recebe "encerrado" e a resposta não entra).
11. **Lembrete:** antigo que já recebeu lembrete não recebe outro na leva 2; novos recebem na metade do prazo novo.
12. **Cadência:** nenhuma mensagem ao fornecedor antigo no ato da ampliação; novos recebem uma única mensagem (a cotação).
13. **Corrida:** duas chamadas simultâneas de `ampliarVencidos`/`varrerPrazos` -> uma ampliação, um mapa, `ampliacoes = 1`.
14. **Falha injetada** no envio depois do claim -> o prazo vence mesmo assim e o mapa sai com o que há.
15. **Negociação:** durante rodada de negociação (`item.negociacao.rodada = item.rodada`), fim do prazo **não** amplia; fornecedor novo da ampliação recebe a negociação automática uma única vez, nunca citando valor de outro; mapa final com "Negociado: baixou de X para Y" para quem respondeu.
16. **Reprovar / cotar de novo / buscar do comprador** zera `ampliacoes` e abre rodada nova com todos (caminho antigo intacto).
17. **Real:** `PRAZO_MODO=real` -> novo prazo = 3 dias (5 para compra acima de `LIMITE_COMPRA_MAIOR`), conferindo o valor recalculado da referência.
18. **Urgente** (se adotado o limite): no máximo 1 ampliação.

## Perguntas ao dono (as que mudam o desenho)
1. Ampliar também quando todos já responderam antes do prazo? (recomendo sim)
2. Lojas online contam como proposta? (recomendo sim, igual ao Comparador)
3. Teto de 2 levas extras e 8 fornecedores por leva servem? Urgente com no máximo 1?
