# Revisão 80: o que os testes da Ester mostraram e o que mudou

Testes da Ester em 08/11/2026, das 14:14 às 14:53, pedidos 29 a 33 (chat web e Telegram), mais o documento dela, [`revisao80.md`](workspaces/ester-workspace/revisao80.md). Cada erro foi tratado na causa, não só no caso visto, e cada um ganhou teste: os puros em `testes/revisao80.test.ts` e os de ponta a ponta em `src/simulador/cenarios/revisao80.ts` (`npm run simulador -- desconto-total pos-pedido especificacao`).

## 1. Especificação anotada, mas invisível no resumo

**O que aconteceu.** Pedidos 30 e 31: "classe A e branco". Pedido 32: "3/4 de polegada". O Interpretador gravou tudo em `item_pedido.especificacao`, mas o resumo "Entendi assim" só mostrava especificação de item da base (`ITM-`), e só as duas primeiras. A Ester corrigiu 4 a 5 vezes, recebeu sempre o mesmo resumo e cancelou o pedido 32.

**O que mudou** (`src/fluxo/comprador.ts`):
- O resumo mostra **toda** especificação de **qualquer** item, numa linha embaixo do item ("Classe: A · Cor: branco"), sem repetir o que o nome já diz.
- "(não aceita similar)" aparece escrito; antes, o "(aceita similar)" só sumia.
- "Prazo: 15 dias (15 dias)" virou "Prazo: 15 dias".
- O prompt do Interpretador exige que toda característica dita (classe, cor, bitola, comprimento, norma...) vá para a especificação, mesmo que não caiba no nome.

## 2. Pergunta tratada como correção, com resposta igual

**O que aconteceu.** Com o pedido aberto, "vc anotou o diâmetro?" virava correção e a resposta era o resumo repetido, sem dizer nada. O Assistente respondia "anotei tudo" sem ver a especificação.

**O que mudou:**
- Depois de toda correção, a resposta começa dizendo **o que mudou** ("Anotei: Comprimento: 6 m; não aceita similar."), ou que **nada mudou**. Pergunta de conferência ("anotou?", "entendeu?", "colocou?") recebe "Conferi: está tudo anotado como abaixo" (`textoDoQueMudou`, `PERGUNTA_CONFERENCIA`).
- O Assistente recebe a especificação e o "aceita similar" de cada item no cartão e nas ferramentas (`src/assistente/consultas.ts`). A instrução dele manda listar o que está anotado e nunca dizer "anotei tudo" sem mostrar.
- Suposições com jargão do sistema ("Adotado risco regulado para EPI", "Unidade definida como unidade", "do entendimento anterior") são filtradas no Interpretador e proibidas no prompt.

## 3. Desconto "no valor total da proposta" lido como condicionado

**O que aconteceu.** A Casa do Construtor (a Ester, como fornecedora) respondeu "Dou 10% de desconto no valor total da proposta". A IA preencheu a condição com "no valor total da proposta" e o desconto ficou fora do total: R$ 270,00 em vez de R$ 243,00. O texto interno "(não aplicado ao total)" vazou para o mapa e para o pedido de compra.

**O que mudou** (`src/agentes/negociador/index.ts`, `src/agentes/extrator/index.ts`):
- Uma condição só vale se tiver algo que o comprador precise fazer: forma de pagamento, volume, prazo para fechar (`ehCondicaoDeVerdade`). "No total", "na proposta", "em tudo" dizem a base do desconto e são ignorados como condição, mesmo que a IA erre. O prompt do Extrator também foi corrigido.
- "Total da proposta", "em tudo", "com o frete": o percentual vale também para o frete (`descontoSobreTotal`), como a Ester pediu no item 4. "3% no total" sozinho continua só no produto (pergunta aberta no documento dela).
- O mapa mostra **valor bruto, percentual e valor com desconto**: "Desconto obtido: R$ 27,00 (10%) · valor bruto R$ 270,00 · com desconto R$ 243,00" (item 5).

## 4. Resposta ao pedido de compra virava "cotação encerrada"

**O que aconteceu.** O pedido de compra saiu com "desconto condicionado ... (não aplicado ao total)". A fornecedora respondeu "desconto se aplica ao total sim" e recebeu "A cotação 64 já foi encerrada". Depois ela tocou em Confirmo e a compra fechou por R$ 270,00, sem o desconto.

**O que mudou** (novo `src/fluxo/pos-pedido.ts`, item 7 dela):
- Com o pedido de compra enviado, toda mensagem do vencedor que não é "Confirmo" é lida (IA, com regras de reserva sem IA) e classificada: **confirma**, **não atende**, **muda condição** (desconto, preço, frete, prazo, pagamento), **dúvida ou documento**, **outro**.
- Mudança de condição: a conta é feita em código. "O desconto vale" usa o percentual que tinha ficado pendente na proposta. O comprador recebe o antes e o depois, com os botões **Aceitar (R$ X)** e **Manter o pedido como foi**. Só com o aceite a proposta é atualizada e o pedido de compra novo sai ao fornecedor; sem aceite, vale o que foi enviado.
- Dúvida ou documento: o Cotador responde com os dados do pedido, ou leva ao comprador.
- O resto vai ao comprador, e o fornecedor recebe de novo os botões Confirmo / Não consigo atender.
- O pedido de compra não manda mais jargão: quando há desconto condicionado, pergunta "Você ofereceu um desconto com condição (...). Se ele vale para este pedido, me diga".

## 5. Estado errado ao comprador

**O que aconteceu.** A Ester escreveu "confirmar" depois do pedido de compra e ouviu "O pedido 33 está em cotação".

**O que mudou:** a resposta diz o passo de cada item ("com o pedido de compra enviado, esperando a confirmação do fornecedor") e quem age agora (`situacaoDoItem`). "confirmar" sem pedido esperando confirmação responde isso direto, sem IA: com a IA real, ele virava uma pergunta ambígua com quatro botões ("Confirmar o último pedido"...). No chat web e no Telegram, esse "confirmar" vai ao fluxo em vez do Assistente quando há pedido de compra enviado, a menos que a última mensagem do Assistente tenha sido uma pergunta (aí o "sim" responde a ela). "confirmar" também passou a valer como "sim" no "Confirma?".

## 6. Loja online com produto diferente em 1º lugar

**O que aconteceu.** No pedido 33 (tubo 25 mm × **6 m**, sem similar), a Telhanorte ficou em 1º com um anúncio de tubo de **3 m**: o unitário parecia a metade.

**O que mudou** (`src/agentes/busca/filtro.ts`): as medidas do pedido (comprimento, bitola em mm, polegada, voltagem, potência) são comparadas com as do título do anúncio. Se o título traz uma medida do mesmo tipo e nenhuma bate, o anúncio sai, com o motivo "Medida diferente do pedido (3 metros no anúncio; pedido 6 m)". Título sem medida fica, para o comprador conferir no link. A marca 3M não é confundida com "3 metros".

## 7. E-mail de teste: só o link do Telegram

Pedido do dono: com `EMAIL_FORNECEDOR_TESTE=<e-mails de teste separados por vírgula>` (já no `.env`; vários endereços separados por vírgula), quando uma cotação sai para um fornecedor que não está no Telegram (os simulados, por exemplo), esses endereços recebem um e-mail **só com o link pessoal do bot** daquele fornecedor. O e-mail não leva cotação nem conversa: tudo acontece no Telegram.

- Assunto: `[Casa do Construtor Lagoa Exemplo (simulado)] Responda como este fornecedor pelo Telegram (teste)`. O corpo abre com `FORNECEDOR: ...` e a cotação (item e quantidade), e depois o link.
- Um e-mail por fornecedor e cotação. O fornecedor sem código de convite ganha um na hora.
- Abrindo o link, a conversa do Telegram passa a ser a daquele fornecedor, a cotação aberta chega lá e a persona automática dele para de responder. Abrir o link de outro fornecedor troca a conversa para ele, e o anterior volta ao automático (essa troca só vale com `EMAIL_FORNECEDOR_TESTE` ligado).
- Nunca vai ao e-mail do fornecedor: a trava de `src/canais/email.ts` continua igual, e esses endereços só entram na lista liberada. Só funciona nos bots; o simulador e os testes não mandam e-mail.

## O harness

| Cenário | O que confere |
|---|---|
| `desconto-total` | A leitura simulada repete o erro da IA (condição "no valor total da proposta"); o custo sai com 10% sobre produto e frete, a linha mostra bruto, % e final, e não há alerta de condicionado |
| `pos-pedido` | Desconto "se fechar hoje" fica fora do total; o pedido de compra pergunta se ele vale, sem jargão; o fornecedor diz que vale; nunca "cotação encerrada"; o comprador recebe Aceitar e Manter; "confirmar" do comprador recebe o estado certo; aceita; o pedido atualizado sai e o fornecedor confirma pelo total novo |
| `especificacao` | O resumo mostra classe e cor; "vc anotou a cor?" recebe conferência; "não aceito similar" diz o que mudou; sem jargão nas suposições |

Rodada completa com a IA falsa: 14 de 14 cenários passando (os 11 de antes e os 3 novos). Com a IA real (`--ia`), `desconto-total` e `pos-pedido` também passaram: o Extrator de verdade leu "no valor total da proposta" sem condição, e a leitura pós-pedido entendeu "Fechando hoje, o desconto vale sim". Uma das rodadas com IA real falhou por tempo: com a demora da IA, o pedido de desconto saiu a 1 dos 3 fornecedores antes de o mapa fechar. É uma corrida do simulador com prazos de segundos, que já existia antes destas mudanças; a rodada seguinte passou. O próprio cenário `especificacao` achou um erro no filtro novo: "Classe: A" sumia porque a letra "a" aparece em "capacete de segurança com carneira". Corrigido antes da rodada final.

## O que ficou de fora (de propósito)

- **Itens 1, 2 e 6 do documento** (anexo do fornecedor no mapa, arquivo da proposta aceita, negociar com um fornecedor só): são funcionalidades novas, não correções. Estão em "Próximos passos" no documento dela.
- **Loja online recomendada com pagamento antecipado** quando o comprador prefere 28 DDL: o peso do pagamento na nota (10%) não tirou a Telhanorte do 1º lugar. Com o corte por medida, ela sairia nesse caso; mudar os pesos é decisão de negócio.
- **Perguntas abertas** para a Ester: desconto "no total" sem "da proposta" vale para o frete? Desconto depois do pedido de compra que só baixa o total pode ser aceito sem perguntar?
