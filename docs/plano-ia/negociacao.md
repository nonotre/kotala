# Negociação automática e cadência: desenho (I1, U3, I2)

Anexo de [plano-ia.md](../plano-ia.md) (itens I1, I2 e U3), de 08/11/2026. Escopo: só desenho, nada implementado. Base: `docs/plano-ia.md` (I1, I2, U3, decisões de 08/11), `docs/decisoes.md`, `Analise_chat.md` da Ester e o código lido em `main`.

## Resumo das recomendações

1. **Dispara ao receber cada proposta completa**, dentro do prazo aberto, e o pedido de desconto **vai dentro da mensagem de "Recebi sua proposta"** que já existe. Não gera mensagem extra e respeita a cadência por construção.
2. **Uma rodada automática por fornecedor e item**, sem mudar `item.rodada`. Mais rodadas só pelo botão do comprador (já existe, até `MAX_RODADAS`).
3. **Antes/depois** guardado em `oferta.extraido.negociacao` (jsonb que já existe), sem migração. O comparador lê isso para preencher o `produtoAnterior`, e o dashboard de economia passa a funcionar sem mudança.
4. **A fila é calculada, não armazenada.** "Pergunta pendente" sai de `mensagem` (última entrada do contato) mais o estado das tabelas `cotacao` e `oferta`. Sem migração e sem perder nada num reinício.
5. **Fechar a cotação passa a esperar o pedido de desconto aberto** (até uma janela curta). Hoje fecharia na hora em que o último fornecedor responde, e cortaria a negociação.
6. **I2 (texto por IA) fica para depois.** O validador de valores em R$ entra já, valendo para o texto montado em código.

---

## 1. Como é hoje

### Negociador (`src/agentes/negociador/index.ts`)

- Só nasce do botão "Preço alto: negociar" (`src/fluxo/decisao.ts:151`, ação em `:159-171`), que chama `planejarNegociacao` e dispara o evento `negociar` (aguardando_decisao para cotando).
- Limite de rodadas: `MAX_RODADAS = 3` (`negociador:13`), conferido em `:31` e no botão (`decisao.ts:151`).
- Exclui lojas online (`:35-37`).
- Exclui a mais barata (`:50-55`: `filter(oferta.id !== maisBarata.oferta.id)`), escolhe até `MAX_ALVOS = 3` (`:15`) por nota. Só abre exceção quando há uma única proposta válida (`:41-49`).
- Texto fixo (`textoNegociacao`, `:65-83`): "Consegue melhorar a condição? Pode ser no preço, no frete ou no prazo de entrega", cita a referência pública **sempre que existe** (`:76-78`), oferece "combinar a forma de pagamento" de forma vaga (`:79`) e avisa que a proposta continua valendo (`:80`).
- Nunca cita o `melhorCusto`: ele só vai para o registro (`:20`, comentário). Essa regra já é cumprida, mas sem teste automático de texto.

### Cotador (`src/agentes/cotador/index.ts`)

- Envio da rodada de negociação em `enviarCotacoes` (`:74-120`): cria linhas de `cotacao` na nova rodada (`:84-87`), usa `prazoRespostasMs(null, true)` (`:78`; demo = `PRAZO_RESPOSTAS_SEG`, real = 2 dias, `config.ts:32-34`) e manda `tipo: "negociacao"` (`:101`).
- Quem não responde mantém a proposta anterior: o comparador pega a mais recente de cada fornecedor até a rodada atual (`comparador/index.ts:30-45`).
- `encerrarSeTodosResponderam` (`:233-266`): fecha assim que nenhuma `cotacao` está `aguardando` (`:236-241`). A única espera existente é por proposta incompleta (`:244-257`). **Não conhece negociação em aberto.**
- Lembrete na metade do prazo só para `aguardando` (`:295-330`, `FRACAO_LEMBRETE = 0.5`, `config.ts:45`).
- Ao entrar em `comparando`, `marcarSemResposta` marca `sem_resposta` e manda `TEXTO_ENCERRADO` a quem não respondeu (`:269-293`).
- `cotacaoAbertaDo` (`:205-214`) liga a resposta à cotação mais recente em `cotando` com situação `aguardando` ou `respondeu`. Por isso a resposta a um pedido de desconto dentro da mesma rodada **já chegaria** ao fluxo certo.

### Resposta do fornecedor (`src/fluxo/fornecedor.ts`)

- `processarResposta` (`:355`): extrai, e se já existe oferta da mesma cotação e rodada, `completarComAnterior` (`:519-543`, chamada em `:418-424`) junta a mensagem nova com a anterior quando ela só traz complemento.
- Caso `proposta` (`:426-496`): **apaga a oferta da rodada e insere outra** (`:428-452`), e grava `extraido: { ...e, modelo }` (`:453`). Ou seja, uma segunda proposta na mesma rodada **destrói o "antes"**. É o problema central do registro.
- Mensagens de fecho e "faltam": lista `faltam` (`:457-461`: prazo, frete, pagamento, validade) e uma única mensagem de resposta (`:476-488`), com `tipo: completar_proposta` quando faltam coisas, senão `proposta_recebida`. O texto já convida a "melhorar alguma condição (preço, frete, prazo ou pagamento)" (`:481`), mas **sem pedir desconto ativamente**.
- `default` (`:511-513`): mensagem sem preço recebe "Não encontrei preço na sua mensagem. Pode mandar o preço unitário...". Num contexto de negociação isso é errado (ver riscos).
- `recusa` (`:498-503`) marca a cotação como `encerrada`: se "não consigo desconto" for lido como recusa, **perde-se a proposta** (ver riscos).
- Resposta depois do fechamento: "A cotação X já foi encerrada. Guardei sua mensagem" (`:129-136`). Uma resposta tardia a um pedido de desconto cai aqui e é perdida.

### Decisão (`src/fluxo/decisao.ts`)

- Botão de negociar: `:151` (só se `rodada < MAX_RODADAS`), ação `:159-171`; passa `{ rodada, negociacao: plano, prazoRespostasEm: null, lembreteEm: null }`.
- Pedido de compra e "não venceu": `TEXTO_NAO_VENCEU` (`:23`, envio `:285`), `tipo: pedido_compra` (`:257`).

### Comparador (`src/agentes/comparador/`)

- `produtoAnterior` (`calculo.ts:52-53`) vem de `comparador/index.ts:87-90`: o produto da proposta do mesmo fornecedor numa **rodada menor** (`anterior`, `:51`). Dentro da mesma rodada não existe.
- O mapa mostra "Negociado: o produto baixou de A para B" (`comparador/index.ts:115-117`).
- O dashboard de economia (`web/lib/dados-dashboard.ts:100-103`) soma só `max(0, produtoAnterior - produto)` da proposta escolhida. Conta **só o produto**, não o frete.
- `precoConfirmado` (`calculo.ts:49`, usado no portão `:195`) e `confirmacaoPedidaEm` fazem o Comparador mandar `confirmar_preco` (`comparador/index.ts:324-332`) **depois** do fechamento, em `comparando`.

### Memória (`src/agentes/memoria/index.ts`)

- `acharRecompra` (`:63`) olha `historicoCompra` dos últimos 90 dias (`DIAS_RECOMPRA`, `:13`). Para a negociação serve o **histórico do fornecedor** (já vendeu antes, quando, a que preço), que é dado dele e não de concorrente.

### Tabela `mensagem` (`src/nucleo/db/schema.ts:285-313`)

- Colunas: `canal`, `direcao` (entrada/saída), `contatoId`, `pedidoId`, `itemPedidoId`, `texto`, `anexos`, `botoes`, `idExterno`, `situacao` (`recebida|enviada|bloqueada_parar|falhou`), `erro`, `criadoEm`.
- **Não guarda o `tipo` da mensagem** (`TipoEnvio`, `mensagens/index.ts:35`). Só dá para saber *quando* houve a última entrada e a última saída. O *que* era a pergunta tem de vir do estado das outras tabelas (seção 3).

---

## 2. Desenho da negociação automática

### 2.1 Quando dispara

Opções:

| Opção | Demo (15 min) | Vida real (3+ dias) | Problemas |
|---|---|---|---|
| A. Ao receber cada proposta completa | O pedido sai em segundos, sobra quase todo o prazo | Fornecedor tem dias para pensar | Precisa tratar a proposta que chega tarde |
| B. Na metade do prazo (junto com o lembrete) | Aos 7,5 min, mas o fornecedor lento só responde perto do fim; fecha apertado | 36 h de espera sem fazer nada; sobra 36 h | Mensagem extra; reabre conversa já encerrada |
| C. Só no fim do prazo, numa rodada nova | Dobra o tempo da demo | Mais 2 dias (`config.ts:34`) | Atrasa tudo; é o que o botão já faz |

**Recomendação: A.** Motivos:

- O pedido de desconto entra na mensagem de recebimento (`fornecedor.ts:476-488`), então **não há mensagem a mais**. Cumpre a regra da Ester de uma mensagem por vez de graça.
- Aproveita o prazo inteiro, nos dois cenários. A janela do fornecedor para responder o desconto é proporcional ao prazo (abaixo).
- Cada fornecedor negocia no seu ritmo, sem esperar o mais lento.

Condições para disparar (todas em código, na função `deveNegociar(cotacao, oferta, item)`):

1. A proposta acabou de ser gravada, tem preço (`precoUnitario` ou `totalProduto`) e **não faltou nada** (`faltam` vazio). Se faltou algo, a mensagem pede o que falta (`completar_proposta`) e **o desconto espera** a proposta completar. Quando o fornecedor completar, o mesmo ponto do código roda de novo e inclui o pedido.
2. A cotação desse fornecedor **ainda não tem** `extraido.negociacao.pedidaEm` e nenhuma oferta anterior do mesmo fornecedor **neste item** (qualquer rodada) tem a marca: **uma rodada automática por fornecedor por item**.
3. O item está `cotando` e **restam pelo menos 10% do prazo** (`prazoRespostasEm - agora >= 0,10 * prazo`). Abaixo disso, não pede: o comprador usa o botão se quiser.
4. Não negociar propostas que já se sabe que serão cortadas pelos portões do comparador: item não exato sem `aceitaSimilar` e prazo de entrega maior que `prazoMaxDias`. Vale checar com as mesmas regras de `calculo.ts:190-196` (função pura, sem custo).
5. Não negociar com quem pediu falar com uma pessoa (`e.pedidoContato`, `fornecedor.ts:469`) nem com fornecedor que parou (o `enviar` já bloqueia).
6. Lojas online nunca entram: a negociação só nasce dentro de `processarResposta`, e loja online não tem `cotacao` nem contato. Mesma regra que o `negociador:35-37` já tem.

A proposta mais barata **entra**, como decidido. O texto não pode depender da posição do fornecedor no ranking: a mesma mensagem vale para o mais barato e o mais caro, e a mensagem nunca diz a posição.

### 2.2 Janela de resposta e fechamento

- `janelaAte = min(prazoRespostasEm, agora + ESPERA)`, com `ESPERA = 25% do prazo de respostas` (config nova, `NEGOCIACAO_ESPERA_FRACAO = 0.25`, Frente 1). Demo de 15 min: 3 min e 45 s. Real com 3 dias: 18 h. Real com 5 dias: 30 h.
- Marca em `oferta.extraido.negociacao = { pedidaEm, janelaAte, antes, rodadaAuto: 1, alavancas: [...] }`.
- **`encerrarSeTodosResponderam` (`cotador:233-266`) ganha uma segunda espera**, igual à das propostas incompletas (`:244-257`): se existe oferta da rodada com `negociacao.pedidaEm` sem `respondidaEm` e `janelaAte > agora`, não fecha. Quando a janela vence, quem fecha é o varredor (`aoVarrer`, tarefa nova que chama `encerrarSeTodosResponderam` para itens `cotando` cujas janelas todas já passaram). Sem isso, o item ficaria parado até o prazo inteiro.
- Efeito aceito: na demo a cotação deixa de fechar no segundo em que o último fornecedor responde e passa a esperar até uns 4 min. Isso é pedido da Ester ("negociar sempre"); vale avisar no pitch.
- Lembrete (`cotador:295-330`) **não** se aplica a negociação: um pedido, sem insistir.

### 2.3 Quantas rodadas

- **Automática: 1 por fornecedor e item**, na mesma rodada do item (`item.rodada` não muda, nenhuma linha nova em `cotacao`, nenhuma troca de estado).
- **Pelo comprador:** botão existente, com `MAX_RODADAS = 3` (rodada 1 já contém a automática, então restam 2 pelo botão). Ajustes:
  - o botão passa a **incluir a mais barata** (`negociador:50-55`), pela mesma decisão I1;
  - exclui quem manteve a proposta na rodada automática? **Não**: o comprador pediu de novo, vale perguntar; mas o texto muda ("uma última rodada: qual o melhor preço que consegue fechar?") para não repetir a frase;
  - quem **recusou claramente** ("já está no limite") fica de fora (marca `negociacao.resultado = "manteve_firme"`).
- A negociação do botão continua criando rodada nova (`reprovar`/`negociar` em `cotador:74-145`). O "antes" do economia é sempre a **primeira proposta** do fornecedor no item (seção 2.6).

### 2.4 Texto e alavancas

Frase-base da Ester, mantida: **"Por gentileza, conseguiria desconto na cotação?"**

Estrutura da mensagem (cai dentro do recebimento, sem repetir "Recebi" duas vezes):

```
Recebi sua proposta para a cotação 12 (50 sacos de cimento CP II). Obrigado!
Por gentileza, conseguiria desconto na cotação?
{até 2 alavancas}
Se não for possível, sem problema: a proposta continua valendo.
Respondo ao comprador até {janelaAte}.
```

As alavancas são escolhidas **em código**, só quando verdadeiras, no máximo 2 por mensagem, nesta prioridade:

| Alavanca | Condição | Frase |
|---|---|---|
| Recompra | fornecedor tem `historicoCompra` (X2, `memoria`) | "Já compramos com vocês antes e queremos manter a parceria." Sem citar preço antigo. |
| Volume | sempre que há quantidade (o dado é do próprio pedido) | "Se a compra for fechada com vocês, a quantidade é de 50 sacos de uma vez: há desconto por volume?" Condicional ("se fechar com vocês"), sem prometer compra: quem decide é o comprador. |
| Prazo de pagamento | `prazoPagamentoDias` ausente ou menor que o padrão | "Há desconto para pagamento à vista, ou prazo maior no boleto?" Em forma de **pergunta ao fornecedor**, sem prometer pagar antecipado (isso hoje é a frase vaga de `negociador:79`). |
| Frete | proposta tem `frete > 0` (valor do próprio fornecedor) | "O frete de R$ 60,00 pode ser reduzido ou incluído no preço?" |
| Entrega em partes | `pedido.entregas` preenchido (já aceito pelo comprador, `cotador:60`) | "Aceitamos entrega em partes, se ajudar." |

Referência pública:

- Só entra quando o **preço unitário do próprio fornecedor está acima** da mediana (`referenciasDoItem`). Se está abaixo ou igual, **não citar**: chamar atenção para um preço mais alto só induz o fornecedor a subir.
- Redação: "Para referência, o preço publicado na internet para este item está em R$ X por unidade." Continua sendo o único valor de fora permitido.

Regras proibidas no texto (testadas, seção 2.7): valor de outro fornecedor; palavras "concorrente", "outro fornecedor", "mais barato", "mais caro", "melhor oferta"; posição no ranking; promessa de compra ("vamos fechar"); prazo de pagamento prometido ("pagamos à vista").

### 2.5 Lojas online e quem não responde

- **Lojas online** (`oferta.formato = "busca"`): nunca recebem nada. Aparecem no mapa com o preço do anúncio, sem "desconto pedido". No botão do comprador continuam excluídas (`negociador:35-37`).
- **Fornecedor não responde ao pedido de desconto:** a proposta **continua valendo, sem aviso extra e sem lembrete**. Ao fechar, `marcarSemResposta` (`cotador:269-293`) ganha um passo: ofertas com `negociacao.pedidaEm` e sem `respondidaEm` viram `negociacao.resultado = "sem_resposta"` e geram um registro do Negociador ("N fornecedores não responderam ao pedido de desconto; mantida a proposta"). Quem já respondeu a proposta **não** recebe `TEXTO_ENCERRADO` (a `cotacao` está `respondeu`).
- **Resposta que não é desconto:**
  - "não consigo", "já está no limite": `resultado = "manteve"`, resposta curta "Combinado, mantenho a proposta como está. Obrigado!", sem pergunta.
  - "vou ver com o gerente": **sem resposta** do sistema, janela continua aberta (não cobra preço).
  - dúvida: `responderDuvida` (`cotador:339`), como hoje.
- **Desconto condicionado** ("3% se for à vista"): não é aplicado ao preço. Vai para o texto de `pagamento`, e o mapa mostra um alerta ao comprador: "Oferece 3% de desconto para pagamento à vista (não aplicado no total)". Quem decide é o comprador.
- **Preço subiu** depois do pedido (acontece): vale o que o fornecedor mandou por último (é a regra de hoje), mas o mapa alerta ("o preço subiu de A para B depois do pedido de desconto"), para o comprador não ser enganado pelo "Negociado".

### 2.6 Registro antes/depois (economia), sem migração

Hoje o "antes" existe só entre rodadas (`comparador/index.ts:51`). Para a rodada automática, que acontece **dentro** da rodada 1, o plano:

1. **Ao enviar o pedido de desconto**, em `oferta.extraido` (jsonb, já existe, `schema.ts:270`) grava-se `negociacao: { pedidaEm, janelaAte, antes: { precoUnitario, totalProduto, frete, prazoDias, pagamento, prazoPagamentoDias, impostosValor }, alavancas }`. É um `update` na oferta, sem coluna nova.
2. **Em `processarResposta`**, antes do `delete`+`insert` (`fornecedor.ts:428-452`), lê-se `anterior.extraido.negociacao`. Se existe, o novo `extraido` ganha `negociacao: { ...marca, respondidaEm, resultado }`, onde `resultado` é `"desconto"` (preço ou frete baixou), `"manteve"`, `"subiu"` ou `"condicional"`. Isso vale também quando o fornecedor manda duas mensagens: a marca com o `antes` é carregada de oferta em oferta.
3. **`completarComAnterior`** (`fornecedor.ts:519-543`) precisa preservar o `extraido.negociacao` quando junta mensagens (hoje só junta campos de proposta).
4. **Comparador** (Frente 1): `produtoAnterior` (`comparador/index.ts:87-90`) passa a ser a **proposta inicial do fornecedor no item**:
   - percorrer as ofertas do fornecedor em ordem de rodada e criação; se a mais antiga tem `extraido.negociacao.antes`, usar o produto desse `antes`; senão, o produto da própria oferta mais antiga;
   - só retorna valor se for diferente da proposta atual (hoje já exige `>= 0.01`, `:115`).
   Com isso o **dashboard de economia (`dados-dashboard.ts:100-103`) funciona sem mudança**, porque lê `produtoAnterior` do mapa. Acumula o que veio da rodada automática e das rodadas do botão.
5. **Registro de auditoria**: um `registrar` do Negociador por resposta ("Baixou o produto de R$ A para R$ B", `dados: { antes, depois, descontoProduto, descontoFrete, resultado }`). É o que o harness (Frente 3) lê para métricas.

Limitação aceita: o dashboard hoje soma **só o produto** (`dados-dashboard.ts:100-103`). Desconto de frete aparece no mapa, mas não no saving. Se a Ester quiser contar o frete, é pedido para a Frente 1 usar `custo` (produto + frete + impostos) nos dois lados.

Como a IA nunca calcula (`calculo.ts:1-2`): se o fornecedor responder "faço 5% a menos", **o código** calcula o novo preço (anterior x 0,95). O Extrator ganha dois campos novos (`descontoPercentual`, `descontoValor`) e recebe a proposta anterior no contexto; `completarComAnterior` aplica a conta. Desconto sem preço novo só é aplicado se ficar claro que é incondicional.

### 2.7 O que o comprador vê no mapa

Na linha do fornecedor (`linhaMapa`, `comparador/index.ts:106-120`), no lugar de "Negociado: o produto baixou de A para B":

- **Baixou:** `Desconto obtido: R$ 120,00 (de R$ 2.400,00 para R$ 2.280,00)`. Se o frete também baixou: `... e o frete caiu de R$ 90,00 para R$ 60,00`.
- **Pedido e mantido:** `Pedi desconto: manteve a proposta.`
- **Sem resposta:** `Pedi desconto: não respondeu, vale a proposta original.`
- **Subiu:** em "Atenção": `o preço subiu de A para B depois do pedido de desconto`.
- **Condicional:** em "Atenção": `oferece 3% de desconto para pagamento à vista (não aplicado ao total)`.

No cabeçalho do mapa, uma linha: `Pedi desconto a 4 fornecedores: 2 baixaram (R$ 310,00 no total, na menor proposta de cada), 1 manteve, 1 não respondeu.` O número é a soma dos descontos **da proposta que o comprador aprovar** na tela de economia, e o total geral só como informação.

Aviso ao comprador no momento do envio: **nenhum**. O aviso de "Pedi cotação a N fornecedores" (`cotador:189-193`) já existe, e mais uma mensagem ao comprador por fornecedor é ruído.

### 2.8 Regras em código (invariantes)

1. `textoNegociacao` e qualquer texto novo passam por `validarTextoNegociacao(texto, permitidos)`, que extrai todo `R\$\s?[\d.,]+` do texto e exige que cada valor esteja em `permitidos = { referência pública (se citada), valores da própria proposta do fornecedor (preço, total, frete) }`. Falhou, **não envia** e usa o template mínimo ("Por gentileza, conseguiria desconto na cotação?") com `registrar` do problema.
2. `plano.melhorCusto` **não entra** no tipo que o texto recebe. Hoje o `Pick<PlanoNegociacao, "melhorCusto" | "referencia">` (`negociador:68`) deixa o valor passar para a função de texto; trocar por um tipo só com `referencia`. Assim o compilador impede o vazamento.
3. Lista de palavras proibidas (seção 2.4) conferida no mesmo validador.
4. Máximo de 1 pedido automático por fornecedor e item (condição 2 da seção 2.1), conferido contra as marcas em `oferta.extraido.negociacao`, inclusive de rodadas anteriores.
5. Só vale para `cotacao` ligada a fornecedor com contato ativo.

---

## 3. Fila de cadência (uma pergunta por vez)

### 3.1 Regra

Ao mandar uma pergunta a um fornecedor, **esperar a resposta antes de mandar outra**, salvo avisos de encerramento (cancelamento, fim de prazo).

### 3.2 Como saber se há pergunta pendente sem migração

A tabela `mensagem` diz **quando** foi a última entrada e a última saída do contato. Não diz **o que** a saída era (não há `tipo`, `schema.ts:285-313`). Por isso:

> **Pergunta pendente(contato)** = existe alguma "pergunta aberta" cujo horário de envio é **maior** que a `criadoEm` da última mensagem de **entrada** daquele contato (`direcao = 'entrada'`, `situacao = 'recebida'`).

As "perguntas abertas" saem do estado, sem texto e sem coluna:

| Pergunta | Onde está o horário de envio | Está respondida quando |
|---|---|---|
| Pedido de cotação (inicial ou rodada de negociação do botão) | `cotacao.enviadaEm`, com `situacao = 'aguardando'` | a `cotacao` vira `respondeu` (ou chega qualquer entrada depois) |
| Pedido de desconto automático | `oferta.extraido.negociacao.pedidaEm`, sem `respondidaEm` e com `janelaAte > agora` | `respondidaEm` gravado, ou a janela vence |
| Cobrança do que falta (`completar_proposta`) | marca `oferta.extraido.pergunta = { tipo: "completar", em }` gravada junto com o envio | chega entrada depois de `em` |
| Confirmação de preço retido (`confirmar_preco`) | `oferta.confirmacaoPedidaEm` (`comparador/index.ts:332-335`), com `precoConfirmado = false` | `precoConfirmado` ou entrada depois |
| Pedido de compra | `item.estado = 'pedido_enviado'` (`decisao.ts:257`) | `fornecedor_confirmou` |

Detalhes:

- **Escopo da fila: por contato**, não por item. A resposta do fornecedor já é ligada só à cotação mais recente (`cotacaoAbertaDo`, `cotador:205-214`), então duas perguntas abertas a um mesmo contato seriam ambíguas de qualquer jeito. O plano U3 falava "por fornecedor e item"; por contato é mais simples e mais seguro.
- **Validade da pendência:** pergunta pendente por mais de `ESPERA_MAX = 25% do prazo` (a mesma fração da janela de negociação) é considerada **vencida**, para que um fornecedor mudo não trave a fila para sempre.
- A função fica em `src/agentes/cotador/cadencia.ts` (nova, Frente 4): `perguntaPendente(contatoId): Promise<{ tipo, desde } | null>`. Só lê `mensagem`, `cotacao`, `oferta`, `itemPedido`.
- **Atalho para o futuro** (pedido opcional à Frente 2, **não necessário agora**): `mensagem.tipo text` e `mensagem.espera_resposta boolean` deixariam a função com uma consulta só. A função foi pensada para trocar a implementação sem mudar quem a chama.

### 3.3 O que entra na fila, o que passa direto

**Passa direto** (nunca espera, nunca é segurado):

| Tipo | Por quê |
|---|---|
| `encerrada` (`TEXTO_ENCERRADO`, `cotador:24`, `:281`) | fim de prazo: exceção da Ester |
| cancelamento do pedido ou do item | exceção da Ester (hoje avisa pelo mesmo caminho de `encerrada`/`nao_venceu`) |
| `nao_venceu` (`TEXTO_NAO_VENCEU`, `decisao.ts:23`, `:285`) | aviso de encerramento da cotação para quem perdeu |
| `resposta` (resposta à dúvida do fornecedor, repasse do comprador, `cotador:376`, `:426`) | é resposta, não pergunta |
| `proposta_recebida` sem pergunta nova | é resposta ao que ele acabou de mandar |
| `lembrete` | repete **a mesma** pergunta do pedido de cotação; só vai para quem está `aguardando` |
| `pedido_compra` (`decisao.ts:257`) | ação do comprador, é a razão de tudo; passar direto e **combinar com a Ester** (não está na lista de exceções dela) |

**Entra na fila** (só sai quando não há pergunta pendente): pedido de desconto da rodada do botão (nova rodada de `negociacao`), cobrança do que falta (`completar_proposta`), `confirmar_preco`, pergunta de categoria (U5), qualquer pergunta nova.

### 3.4 Como a fila funciona sem armazená-la

A fila **é calculada** a partir do estado, no mesmo estilo que o código já usa (`cotacao` com `enviadaEm` nulo é "para enviar", `cotador:147-151`):

1. Cada ponto que hoje chama `enviar(...)` com uma pergunta passa a chamar `pedirAoFornecedor(contatoId, pergunta)` (em `cadencia.ts`), onde `pergunta` é `{ tipo, linhas, marcar }`.
2. `pedirAoFornecedor` consulta `perguntaPendente(contatoId)`:
   - **sem pendência:** junta esta pergunta com todas as outras **prontas** do mesmo contato (itens abaixo) numa **única mensagem**, envia, e executa os `marcar` (grava `enviadaEm`, `negociacao.pedidaEm`, `confirmacaoPedidaEm` etc.);
   - **com pendência:** **não envia e não grava marca**. A pergunta continua "pronta" no estado (por exemplo, `confirmacaoPedidaEm` nulo, `negociacao.pedidaEm` ausente).
3. **Quem libera a fila:**
   - fim de `processarResposta` (a resposta do fornecedor acabou de chegar): chama `despacharPerguntas(contatoId)`;
   - o varredor (`aoVarrer`, a cada 5 s, `orquestrador/index.ts:300-318`): para contatos sem pendência e com pergunta pronta, chama `despacharPerguntas`. É a rede de segurança (reinício do servidor, pendência vencida);
4. `despacharPerguntas(contatoId)` descobre o que está pronto olhando só o estado:
   - cotação com `enviadaEm` nulo (rodada do botão);
   - oferta completa de rodada aberta sem `negociacao.pedidaEm` e que passa em `deveNegociar` (seção 2.1);
   - oferta com campos faltando e sem `pergunta` recente;
   - oferta retida com `confirmacaoPedidaEm` nulo (aqui o Comparador, Frente 1, só **marca** que precisa de confirmação; ver seção 5).

Isso resolve o caso mais comum sem fila: o pedido de desconto automático **nasce junto** da mensagem de recebimento (resposta ao fornecedor, sem pergunta pendente). A fila só aparece quando duas perguntas competem: por exemplo, a proposta chegou incompleta (cobra o que falta) e, quando ele responde, a mesma mensagem de recebimento já traz o pedido de desconto.

### 3.5 Como juntar mensagens pendentes numa só

Formato único, com lista numerada, no máximo 3 itens (acima disso, o resto espera a próxima resposta):

```
Sobre a cotação 12 (50 sacos de cimento CP II):
1. Para completar a proposta, informe também: prazo de entrega; validade.
2. Por gentileza, conseguiria desconto na cotação? O frete de R$ 60,00 pode ser reduzido?
Responda por aqui, do seu jeito.
```

Regras da junção:

- Ordem de prioridade: **completar a proposta** > **confirmar preço** > **desconto** > **categoria**. A categoria (U5) só entra sozinha, depois da primeira resposta.
- Pergunta a respeito de **itens diferentes** do mesmo contato não se junta: uma por item, na ordem de criação (a pendente é por contato, então a segunda espera).
- O validador de valores em R$ (seção 2.8) roda **na mensagem final**, depois da junção.
- Se o fornecedor responder só a parte da lista, o que ficou sem resposta **não é cobrado de novo** (a marca `pedidaEm` já foi gravada). Para os faltantes de proposta isso não vale: o `faltam` é recalculado a cada proposta (`fornecedor.ts:457-461`), então continua sendo cobrado enquanto faltar e a cotação estiver aberta.

---

## 4. Texto redigido por IA com validador (I2): agora ou depois?

**Depois**, com duas partes que entram agora.

Motivos para esperar:

1. O requisito da Ester é a frase "Por gentileza, conseguiria desconto na cotação?" e a negociação em toda cotação. Um template com alavancas escolhidas em código cobre isso.
2. A IA só ajudaria em variar o tom e escolher alavanca, e **não há medição** de que isso melhore o desconto. A decisão do plano (I2) já diz que só entra se o harness mostrar ganho.
3. Risco novo para um ganho pequeno: o modelo pode citar valor errado, prometer compra, ou revelar posição no ranking. O validador reduz, mas não zera.
4. Custo e latência: uma chamada do papel forte por proposta, dentro do caminho de resposta do fornecedor (`processarResposta`).

Entra agora, porque serve aos dois caminhos:

- `montarNegociacao(contexto): { texto, alavancas, permitidos }` com o contexto limitado (nome, item, alavancas verdadeiras, referência pública, valores do próprio fornecedor). O template é a primeira implementação.
- `validarTextoNegociacao(texto, permitidos)` (seção 2.8). Hoje seria um teste de invariante do template; amanhã é o validador do I2.

Critério para ligar o I2 (Frente 3 mede): rodar as personas "dá desconto só quando pedem" e "dá desconto depois de insistir" com o template e com a IA, **pelo menos 20 execuções por braço**; o I2 entra se o desconto médio subir de forma clara **e** o validador não derrubar mais que ~5% dos textos para o template. O texto da IA usa o papel "forte" e sempre cai para o template se o validador falhar, se a IA demorar ou se a chamada der erro.

---

## 5. Mudanças por arquivo e frente dona

Frentes pelo `docs/frentes.md`: **4** = `src/agentes/` menos comparador, `src/fluxo/`, `src/texto.ts`; **1** = comparador e regras em `src/config.ts`; **2** = migrações; **3** = harness (`src/simulador/`, testes).

### Frente 4 (IA e conversa)

| Arquivo | Mudança |
|---|---|
| `src/agentes/negociador/index.ts` | **Mudar:** (a) `textoNegociacao` vira montagem com alavancas (seção 2.4), recebe só `referencia` (não `melhorCusto`); (b) novo `deveNegociar(...)` (seção 2.1) e `planoAutomatico(...)`; (c) `planejarNegociacao` (botão) deixa de excluir a mais barata e usa texto de "última rodada"; (d) `validarTextoNegociacao`; (e) constante de palavras proibidas. |
| `src/agentes/cotador/cadencia.ts` | **Novo:** `perguntaPendente`, `pedirAoFornecedor`, `despacharPerguntas`, `juntarPerguntas` (seção 3). Tarefa do varredor. |
| `src/agentes/cotador/index.ts` | `encerrarSeTodosResponderam` espera janelas de desconto abertas (`:233-266`). `marcarSemResposta` registra "não respondeu ao desconto" (`:269-293`). `enviarCotacoes` (rodada do botão, `:74-120`) passa pela cadência. `enviarLembretes` só para `aguardando` (já é). Registra `aoVarrer(liberarJanelasDeDesconto)`. |
| `src/agentes/extrator/index.ts` | Aceitar contexto de negociação em aberto: "não consigo/mantenho" não é `recusa`; campos novos `descontoPercentual`, `descontoValor`, `condicional` (desconto só à vista); recebe a proposta anterior. A conta é feita em código. |
| `src/fluxo/fornecedor.ts` | `processarResposta`: (a) montar a mensagem de recebimento com o pedido de desconto e as alavancas, usando o ponto `:476-488`; (b) gravar `extraido.negociacao` ao pedir, carregar e fechar ao receber (`:428-453`); (c) no ramo `default` (`:511-513`) e no `recusa` (`:498-503`), tratar contexto de negociação aberta (silêncio ou "mantenho a proposta"); (d) `completarComAnterior` (`:519-543`) preserva `extraido.negociacao` e aplica `descontoPercentual`; (e) ao fim, `despacharPerguntas(contatoId)`. |
| `src/fluxo/decisao.ts` | Botão de negociar (`:151`, `:159-171`): usar a nova versão de `planejarNegociacao` (inclui a mais barata). Texto do botão pode ficar. `pedido_compra` e `nao_venceu` marcados como "passa direto". |
| `src/nucleo/mensagens/index.ts` | **Sem mudança** (a Frente 4 só lê `mensagem` pelo `db`). O `TipoEnvio` pode ganhar `negociacao_auto` se a Frente 3 quiser distinguir no simulador; é acréscimo pequeno e deve ser anotado. |
| `src/texto.ts` | Funções de frase (valor em R$, "até {hora}", lista de pendências) se o texto crescer. |

### Frente 1 (regras e comparador)

| Arquivo | Mudança |
|---|---|
| `src/agentes/comparador/index.ts` | `produtoAnterior` = produto da **proposta inicial do fornecedor no item** (`extraido.negociacao.antes` quando houver; senão a oferta mais antiga) (`:51`, `:87-90`). `linhaMapa` (`:115-117`) com "Desconto obtido: R$ X", "manteve", "não respondeu", alertas de "subiu" e "condicional". Cabeçalho do mapa com o resumo do desconto. |
| `src/agentes/comparador/index.ts` (confirmar preço, `:324-332`) | Hoje envia direto; passar por `pedirAoFornecedor` da cadência. Como a função nasce na Frente 4, combinar a interface (um parâmetro `tipo` e um texto). |
| `src/config.ts` | `NEGOCIACAO_ESPERA_FRACAO = 0.25`, `NEGOCIACAO_RESTANTE_MIN = 0.10`, `ESPERA_PERGUNTA_FRACAO = 0.25`, todas como fração do prazo de respostas. Não mexe em `prazoRespostasMs`, que já escala demo/real. |
| `web/lib/dados-dashboard.ts` (economia) | **Sem mudança** se o `produtoAnterior` vier certo. Opcional: contar também o frete. |

### Frente 2 (migrações)

**Nenhum pedido obrigatório.** Tudo cabe em colunas existentes (`oferta.extraido` jsonb, `mensagem.criadoEm`, `cotacao.enviadaEm`, `oferta.confirmacaoPedidaEm`).

Pedido opcional, só se a consulta de pendência ficar lenta ou frágil: `mensagem.tipo text` e `mensagem.espera_resposta boolean`. Para a migração, lembrar que tabela nova de negócio entra nos gatilhos da auditoria (`frentes.md:61`; aqui seria só coluna).

### Frente 3 (harness)

| Arquivo | Mudança |
|---|---|
| `src/simulador/index.ts` | `reagir` (`:70-76`): o tipo `negociacao` manda `enviarProposta` com a mesma regra de preço da rodada; na rodada automática `item.rodada` não muda, então a persona **não baixa o preço** (`personas.ts:117`: `if (rodada > 1)`). Passar um sinal "negociando" para `textoProposta`. Reagir também ao recebimento com pedido de desconto. |
| `src/simulador/personas.ts` | Comportamentos novos (seção 7): `desconta_se_pedir`, `ignora_desconto`, `duas_mensagens`, `desconto_condicional`, `firme`. |
| `testes/negociador.test.ts` e novos | Casos da seção 7. |

---

## 6. Interação com a busca automática de mais fornecedores

Decisão do dono (plano-ia, decisão 4): **no fim do prazo**, sem 3 propostas válidas, buscar mais; demo de 15 min, vida real de no mínimo 3 dias. (O I3 do plano ainda diz "na metade do prazo"; vale corrigir o texto do plano.)

Como encaixa:

1. **Sequência no fim:** janelas de desconto (≤ 25% do prazo) terminam antes ou junto do prazo, então o fechamento acontece uma vez (`encerrar_cotacao`), o Comparador monta o mapa e, se `validas < MINIMO_PROPOSTAS_VALIDAS` (`calculo.ts:20`) e há candidatos, dispara a busca. A negociação **não atrasa** a busca além do próprio prazo.
2. **Evitar reperguntar:** `voltar_busca` hoje abre rodada nova **com todos os fornecedores de novo** (`busca/index.ts:77-79`, `:153-154`). Na busca automática o certo é só **adicionar os novos**; se a rodada nova refizer a cotação para todos, os antigos receberiam um segundo pedido de cotação e, na resposta, um segundo pedido de desconto. A regra "1 pedido automático por fornecedor por item, em qualquer rodada" (seção 2.1, condição 2) protege disso, e também a cadência (um fornecedor com pendência não recebe outra pergunta).
3. **Novos fornecedores negociam normalmente:** cada proposta nova cai no mesmo fluxo (desconto na mensagem de recebimento). Na demo, o segundo prazo de 15 min comporta isso; se o fornecedor novo responde quando resta menos de 10% do prazo, não negocia (condição 3), e o comprador tem o botão.
4. **O que conta como "proposta válida" depois do desconto:** o desconto pode mudar o mapa (a mais barata muda, uma retida deixa de estar). A contagem das 3 propostas é feita **no fechamento**, com as propostas finais.
5. **Mapa:** além do resumo do desconto, o cabeçalho diz quantos fornecedores foram consultados a mais (I3). Frente 1.
6. **Demo:** o item passa por 2 janelas de 15 min mais as janelas de desconto, então uma demo ao vivo com busca automática não cabe em poucos minutos. Para a banca, recomendo `PRAZO_RESPOSTAS_SEG` menor (ex.: 180 a 300 s), com `SIM_ATRASO_FATOR` baixo, e deixar os 15 min só para teste com pessoas.

---

## 7. Riscos e casos de teste (para a Frente 3)

### 7.1 Riscos

| # | Risco | Mitigação no desenho |
|---|---|---|
| R1 | Resposta "não consigo desconto" lida como `recusa` e a **proposta é perdida** (`fornecedor.ts:498-503`) | Extrator com contexto de negociação aberta: nunca `recusa`; `resultado = "manteve"` |
| R2 | Resposta sem preço recebe "Não encontrei preço..." (`:511-513`) no meio da negociação | No contexto de negociação aberta, ficar em silêncio ou "mantenho a proposta" |
| R3 | O fechamento corta a negociação (`cotador:233-266`) | Espera a janela de desconto aberta; varredor fecha quando a janela vence |
| R4 | Resposta chega depois do fechamento e é perdida ("A cotação X já foi encerrada", `fornecedor.ts:129-136`) | Janela vence antes do prazo; se ainda assim chegar, registrar a mensagem e avisar o comprador no mapa |
| R5 | "Antes" destruído por `delete`+`insert` da oferta (`:428-452`) | Marca `extraido.negociacao.antes`, carregada de oferta em oferta |
| R6 | Fornecedor aumenta o preço depois do pedido | Vale o último preço, alerta no mapa, não conta como economia |
| R7 | Desconto condicional ("3% à vista") contado como preço | `condicional` não aplica; vai para `pagamento` e alerta |
| R8 | Vazamento: valor de outro fornecedor, ranking, `melhorCusto` no texto | Tipo do texto sem `melhorCusto`, validador de R$ e de palavras, teste de invariante |
| R9 | Referência pública abaixo ou igual ao preço do fornecedor induz aumento | Só cita quando o preço do fornecedor está acima da mediana |
| R10 | Duas mensagens seguidas ao fornecedor (cobrança + desconto + confirmar preço) | Cadência (seção 3) |
| R11 | Fornecedor com dois itens abertos recebe e responde misturado | Fila por contato; pergunta de item diferente espera |
| R12 | Fornecedor manda duas mensagens (primeiro "vou ver", depois o preço) | "Vou ver" não fecha a janela nem gera resposta; o preço fecha |
| R13 | O fornecedor responde só a metade da mensagem juntada | O que não é `faltam` não é cobrado de novo; `faltam` é recalculado a cada proposta |
| R14 | A demo fica mais lenta (fechamento espera a janela) | Janela de 25% do prazo; reduzir `PRAZO_RESPOSTAS_SEG` para a banca |
| R15 | Pedido de desconto a fornecedor com proposta que será cortada (fora do prazo, item diferente) | `deveNegociar` filtra pelos portões do comparador |
| R16 | Pedido a fornecedor que pediu "falar com uma pessoa" | Não negociar |
| R17 | Pendência de pergunta trava a fila para sempre (fornecedor mudo) | `ESPERA_PERGUNTA` vence a pendência; varredor reavalia |
| R18 | Mensagem de recebimento com desconto vira texto longo demais | Máximo 2 alavancas; máximo 3 itens por mensagem juntada |
| R19 | Reinício do servidor perde a fila | A fila é calculada do estado; o varredor refaz |
| R20 | Desconto de frete não entra no saving do dashboard | Aceito e documentado; pedido opcional à Frente 1 |

### 7.2 Personas novas (Frente 3, `src/simulador/personas.ts`)

| Persona | Comportamento |
|---|---|
| `desconta_se_pedir` | Responde a proposta sem desconto. Quando recebe o pedido, baixa 5% do unitário. Se **não** receber o pedido (teste de controle), não baixa. |
| `ignora_desconto` | Responde a proposta e **não responde** ao pedido de desconto. |
| `manteve` (firme) | Responde "já está no limite, mantenho a proposta". |
| `duas_mensagens` | Primeira mensagem "vou ver com o gerente e já respondo"; segunda, minutos depois, com o preço novo. Variante: manda a proposta em duas mensagens (preço, depois prazo e pagamento). |
| `condicional` | "Faço 3% se for à vista." |
| `sobe` | Responde o pedido de desconto com preço **maior**. |
| `percentual` | "Faço 5% a menos", sem número novo (testa a conta em código). |
| `tarde` | Responde ao desconto depois da janela, mas antes do prazo; e outra variante depois do fechamento. |
| `pergunta_no_meio` | Responde ao pedido com uma dúvida ("o frete é para onde?"). |
| `mudo` | Nunca responde nada (testa a pendência vencida). |

### 7.3 Casos de teste

**Negociação**

1. Três fornecedores, o mais barato é `desconta_se_pedir`: o pedido sai para os 3, **inclusive o mais barato**, dentro da mensagem de recebimento; o mapa mostra "Desconto obtido: R$ X".
2. Mesmo caso com a proposta mais barata de uma **loja online**: a loja não recebe nada, os outros sim.
3. `deveNegociar` falso: proposta incompleta, item não exato sem aceite, prazo maior que o do pedido, resta menos de 10% do prazo, `pedidoContato`.
4. Proposta incompleta que se completa: o pedido de desconto sai **só** na mensagem de recebimento da proposta completa (não duas vezes).
5. `ignora_desconto`: a proposta continua no mapa, `resultado = sem_resposta`, registro do Negociador, **nenhum lembrete** e nenhuma outra mensagem ao fornecedor.
6. `manteve`: resposta "Combinado, mantenho a proposta", `cotacao` continua `respondeu` (não `encerrada`).
7. `condicional`: o total do mapa **não** muda; há alerta de pagamento.
8. `sobe`: vale o último preço, alerta no mapa, economia zero.
9. `percentual`: o novo preço é o anterior x (1 - p), calculado em código; o Extrator não devolve preço.
10. `duas_mensagens`: "vou ver" não gera resposta nem fecha a janela; a segunda atualiza e fecha, com o `antes` correto (o da primeira proposta).
11. Rodada do botão depois da automática: o `antes` da economia continua sendo a **primeira** proposta; o botão inclui a mais barata; o texto muda.
12. Segunda proposta do mesmo fornecedor na mesma rodada (reenvio): **não** gera segundo pedido de desconto (marca em `extraido`).

**Regras de texto (invariantes, rodar em todas as personas)**

13. Nenhum texto enviado ao fornecedor contém valor em R$ que não seja a referência pública ou valor da **própria** proposta dele; nenhum contém as palavras proibidas; nenhum cita a posição no ranking.
14. `melhorCusto` não aparece em nenhuma mensagem (varredura de todas as mensagens `saida` com o valor numérico do melhor custo, em várias formatações).
15. A referência pública só aparece quando o preço do fornecedor está **acima** dela.
16. O mesmo texto estrutural sai para o mais barato e o mais caro.
17. Texto com alavanca falsa: sem histórico de compra, **não** aparece "já compramos com vocês"; sem `pedido.entregas`, não aparece "entrega em partes".

**Cadência**

18. Em nenhuma sequência de testes saem **duas mensagens seguidas** ao mesmo contato sem resposta no meio, **exceto** `encerrada`, cancelamento, `nao_venceu`, resposta a dúvida e `lembrete` da mesma pergunta (métrica "mensagens seguidas sem resposta" do plano, item 3).
19. `confirmar_preco` com pedido de desconto pendente: espera, e sai quando o fornecedor responde, juntado com o que mais estiver pronto.
20. Pendência vence (`mudo`): a pergunta seguinte sai depois de `ESPERA_PERGUNTA`, e o varredor a libera sem nova entrada do fornecedor.
21. Reinício do processo no meio de uma pendência: a fila é refeita do estado, sem duplicar mensagem.
22. Fornecedor com dois itens abertos: a pergunta do segundo espera a resposta do primeiro.
23. Juntar 3 perguntas numa só: ordem completar, confirmar preço, desconto; o resto espera.

**Fechamento e busca**

24. Todos responderam, uma janela de desconto aberta: a cotação **não** fecha; fecha quando a janela vence (varredor) ou quando o último responde.
25. Resposta de desconto no último segundo do prazo: entra no mapa.
26. Menos de 3 propostas válidas no fim do prazo, com candidatos: a busca automática adiciona só os novos; os antigos **não** recebem segundo pedido de cotação nem de desconto.
27. Novo fornecedor que responde com menos de 10% do prazo restante: não recebe pedido de desconto.

**Métricas** (para o relatório do harness)

- desconto obtido por rodada e por fornecedor (R$ e %), taxa de resposta ao pedido, taxa de desconto, quantas respostas "mantém" e "sem resposta";
- mensagens por fornecedor por item, e mensagens seguidas sem resposta (meta: zero fora das exceções);
- tempo médio de fechamento da cotação antes e depois da espera pela janela;
- textos derrubados pelo validador (alvo: zero com template).

---

## Decisões que faltam (para o dono ou a Ester)

1. `pedido_compra` e `lembrete` passam direto na cadência? Recomendo que sim (seção 3.3); a Ester só listou cancelamento e fim de prazo.
2. Janela do desconto de 25% do prazo e mínimo de 10% restante: valores razoáveis, sem base ainda; ajustar com o harness.
3. A economia deve contar o frete? Hoje só conta o produto.
4. A Ester aceita que a cotação não feche mais no segundo em que todos respondem (espera até a janela)?
