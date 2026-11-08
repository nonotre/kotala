# Interface do Telegram além de texto: levantamento e proposta (Frente 4)

Documento de apoio da Frente 4 (IA do comprador e do fornecedor). Parte 1 e 2 são **fato verificado** (código lido e documentação oficial); parte 3 e 4 são **análise e proposta**. Nada aqui foi implementado.

## Resumo

- **Hoje** o Telegram usa só texto puro (sem `parse_mode`), teclado inline com `callback_data` e `answerCallbackQuery` vazio. Não há edição de mensagem (só retirar o teclado), nem PDF/foto de saída, nem "digitando...", nem comandos, nem enquete.
- **Biblioteca:** grammY 1.46.0 com tipos `@grammyjs/types` 5.0.0, que já incluem a Bot API 10.3 (a atual na consulta). Nenhuma troca de biblioteca é necessária para nada do que segue.
- **Prioridade alta:** (1) editar a mensagem no clique, em vez de só tirar o teclado e mandar outra; (2) formatação em HTML com escape central (negrito nos preços, citação expansível para detalhes); (3) "digitando..." durante a IA; (4) mapa de cotação como documento (PDF) quando houver muitas propostas; (5) `answerCallbackQuery` com aviso para botão velho; (6) cor nos botões (`style`: verde/vermelho) para aprovar e reprovar.
- **Prioridade média:** teclado de resposta com `one_time` para passos de formulário, `ForceReply` para pedir motivo, comandos e botão de menu, reação para "recebi", link de citação (`reply_parameters`) para ligar a resposta ao pedido, mensagens ricas (tabela) para o mapa.
- **Não vale a pena agora:** modo inline, Mini App, enquete, fixar mensagem, efeito de mensagem, mensagem efêmera, rascunho em streaming.
- **Proposta:** um vocabulário de componentes independente de canal em `src/fluxo/componentes/` (escolha, confirmação, formulário, lista paginada, documento), que compila para o `enviar()` que já existe e deixa o Telegram desenhar o melhor que puder. Toda a lógica específica do Telegram (HTML, edição, callback codificado) fica em `src/canais/telegram.ts`. Em `src/nucleo/` só entram três acréscimos pequenos de tipo (a anotar em "Pedidos entre frentes").
- **Achados de bug** no código atual (seção 1.4): o botão "Voltar" do mapa diz que os botões continuam valendo, mas o teclado do mapa já foi removido no clique; o e-mail ignora `botoes`; o Telegram ignora `anexos` de saída.

---

## 1. Estado atual no código (fato verificado)

### 1.1 Biblioteca e plugins

| Item | Valor | Onde |
|---|---|---|
| Biblioteca | `grammy` ^1.46.0 (instalado 1.46.0) | `package.json:38` |
| Tipos da Bot API | `@grammyjs/types` 5.0.0 (traz `sendRichMessage`, `sendMessageDraft`, botão `disabled`, `style`) | `node_modules/@grammyjs/types` |
| Plugins | `@grammyjs/auto-retry` ^2.0.2, `@grammyjs/runner` ^2.0.3 | `package.json:34-35` |
| Recebimento | long polling, um runner por bot, `sequentialize` por chat | `src/canais/telegram.ts:41`, `:124-126` |
| Dois bots | comprador e fornecedor; endereço do contato é `<papel>:<chat_id>` | `src/canais/telegram.ts:10-18`, `src/bots.ts:15-18` |

### 1.2 Recursos de Telegram já usados

| Recurso | Uso | Onde |
|---|---|---|
| Texto simples | `sendMessage` sem `parse_mode`, corte em 4096 caracteres, prévia de link desligada | `src/canais/telegram.ts:90` |
| Teclado inline | `InlineKeyboard`; até 3 botões curtos (rótulo ≤ 18) por linha, senão um por linha; rótulo cortado em 64 | `src/canais/telegram.ts:79-88` |
| `callback_query` | recebe `callback_query:data`, entrega ao núcleo como `botao` | `src/canais/telegram.ts:54-59` |
| `answerCallbackQuery` | sempre vazio (sem texto, sem alerta) | `src/canais/telegram.ts:55` |
| Edição | só `editMessageReplyMarkup` para **tirar** o teclado de qualquer clique | `src/canais/telegram.ts:57` |
| Anexos de entrada | documento (PDF/imagem), foto, voz e áudio; baixados por `getFile` e guardados em disco por hash | `src/canais/telegram.ts:20-35`, `:93-108`; `src/nucleo/mensagens/index.ts:61-71` |
| Deep link | `/start <código>` vira `convite` (link pessoal do fornecedor, `?start=cadastro` genérico) | `src/canais/telegram.ts:63`, `src/bots.ts:45` |
| `getMe` | descobrir `@usuario` do bot | `src/canais/telegram.ts:112-122` |
| Idempotência | `idExterno` único; callback usa `cb:<id da query>` | `src/canais/telegram.ts:58`, `src/nucleo/mensagens/index.ts:114-127` |

**Não usado:** `parse_mode`, `editMessageText`, `sendDocument`/`sendPhoto`/`sendMediaGroup`, `sendChatAction`, `setMessageReaction`, `ReplyKeyboardMarkup`, `ForceReply`, `reply_parameters`, `setMyCommands`, menu, enquetes, Mini App, inline mode, `pinChatMessage`.

### 1.3 Como o adaptador de canal é desenhado

- Interface `AdaptadorCanal` com `canal`, `enviar(endereco, texto, opcoes)` e `baixar?(ref)` em `src/nucleo/mensagens/index.ts:45-50`. O tipo `Canal` (`telegram`, `whatsapp`, `email`, `web`, `voz`, `simulado`) está em `src/nucleo/db/schema.ts:33`.
- `OpcoesEnvio` hoje: `botoes?: {rotulo, dado}[]`, `anexos?`, `pedidoId?`, `itemPedidoId?`, `tipo?` (`src/nucleo/mensagens/index.ts:33-42`). `enviar()` é o **único ponto de saída**, confere o PARAR, grava a mensagem (inclui `botoes` em jsonb, `schema.ts:284`) e chama o adaptador (`:187-226`).
- Entrada: `MensagemEntrada` com `texto`, `anexos`, `botao` (o dado do clique), `convite` (`:15-31`). Não há campo para o id da mensagem clicada nem forma de o fluxo responder ao clique.
- Os fluxos são **independentes de canal**: montam texto e `Botao[]` e chamam `enviar()`. O formato do `dado` é uma convenção de texto lida por regex: `item:<id>:<acao>[:<ofertaId>]` (`src/fluxo/decisao.ts:44-45`), `pedido:<id>:<acao>[_motivo]` (`src/fluxo/comprador.ts:50-55`), `pedido:<id>:base:<ordem>:<ITM-...>` (`:454`), `compra:<id>:confirmo|desisto` (`src/fluxo/fornecedor.ts:45`), `cad:...` (`:179-189`).
- Os outros adaptadores: web (`src/canais/web.ts`) não envia nada, só devolve um id, a tela lê da tabela `mensagem`; e-mail (`src/canais/email.ts:87-107`) manda só `texto` + rodapé e **ignora `botoes` e `anexos`**.
- O texto do mapa de cotação e seus botões nascem em `src/agentes/comparador/index.ts:193-198` e `:292` (arquivo do comparador, **fora** da Frente 4).

### 1.4 Achados no código atual (para a Frente 4 decidir)

1. **Botões do mapa somem no primeiro clique.** `src/canais/telegram.ts:57` tira o teclado da mensagem clicada, mesmo quando o clique só abre uma confirmação ("Aprovar X" → "Sim, aprovar / Voltar"). Mas `src/fluxo/decisao.ts:215` responde "Os botões do mapa continuam valendo" ao tocar em Voltar. O comprador fica sem botões no mapa e precisa rolar a conversa ou escrever.
2. **Clique sem retorno visual.** O `answerCallbackQuery` vazio só tira o relógio do botão. Botão de pedido já decidido gera uma mensagem nova ("este item não está esperando...", `decisao.ts:55-58`), em vez de um aviso rápido.
3. **Sem escape/formatação.** Tudo é texto cru; negrito, citação e links ficam fora. Se alguém ligar `parse_mode` sem escape central, nomes de fornecedor com `<`, `&`, `_` ou `.` quebram o envio (erro 400).
4. **`callback_data` perto do limite.** `item:<id>:confirmar:<uuid de 36>` tem uns 57 bytes com id de 5 dígitos; qualquer ação ou prefixo novo estoura 64 bytes e o Telegram recusa o envio inteiro (sem checagem prévia hoje).
5. **E-mail ignora botões e anexos**: um fornecedor por e-mail não vê as opções (ex.: "Confirmo" da compra).
6. **Clique duplo:** `sequentialize` serializa por chat e o `idExterno` deduplica o mesmo clique, mas dois toques são dois `callback_query.id`. A proteção real é o estado do item (`decisao.ts:54-58`), que funciona, mas a mensagem fica enganosa.

---

## 2. Recursos da Bot API (fato verificado)

**Versão consultada: Bot API 10.3, 24/08/2026** ([changelog](https://core.telegram.org/bots/api-changelog), [referência](https://core.telegram.org/bots/api)). Os tipos instalados do grammY 1.46.0 já têm os campos da 10.3 (conferido em `node_modules/@grammyjs/types`). Limites abaixo vêm da referência oficial e dos comentários dos tipos instalados; o que não consegui confirmar está marcado como "não verificado".

Chamadas pela biblioteca: `ctx.api.<metodo>(...)`, `bot.api.<metodo>(...)` ou `ctx.<atalho>(...)`. "Grupo" = grupo/supergrupo; o kotala hoje só fala em chat privado.

| Recurso | O que é / limites | Como chamar (grammY) | Privado × grupo |
|---|---|---|---|
| **Teclado inline** | Botões presos à mensagem. `callback_data` 1-64 **bytes** (não caracteres: acento conta 2). Tipos de botão: `callback_data`, `url`, `web_app`, `login_url`, `switch_inline_query*`, `copy_text` (até 256 caracteres, copia para a área de transferência), `pay`, `game`, e **`disabled`** (novo na 10.3, botão cinza que não faz nada). Campos novos: `style` (`primary` azul, `success` verde, `danger` vermelho, 9.4) e `icon_custom_emoji_id` (restrito). Limites de quantidade de botões: ver nota ao fim da tabela | `new InlineKeyboard().text("Aprovar", dado).row().url(...)`; `reply_markup` em `sendMessage`. O `.text(rotulo, dado)` não aceita `style`; usar o objeto cru `{ text, callback_data, style }` em `inline_keyboard` | Igual. Em grupo, qualquer membro clica: é preciso conferir `ctx.from` |
| **`callback_query` e `answerCallbackQuery`** | Todo clique chega como update; **precisa ser respondido**, senão o botão fica carregando. `text` 0-200 caracteres: sem `show_alert` aparece como aviso rápido no topo, com `show_alert: true` vira janela com OK. `url` abre link/jogo; `cache_time` | `ctx.answerCallbackQuery({ text: "...", show_alert: true })` | Igual |
| **Teclado de resposta** (`ReplyKeyboardMarkup`) | Substitui o teclado do celular por botões que **enviam texto**. `one_time_keyboard` (esconde após uso), `is_persistent`, `resize_keyboard`, `input_field_placeholder` (1-64), `selective` (só alguns usuários em grupo). Botões especiais: `request_contact`, `request_location`, `request_poll`, `request_users`/`request_chat`, `web_app`. `ReplyKeyboardRemove` remove | `new Keyboard().text("Sim").text("Não").oneTime().resized()`; `.requestContact("Enviar meu telefone")` | Em grupo, só com `selective` e menção/resposta |
| **ForceReply** | Abre o campo de resposta já respondendo à mensagem do bot. `input_field_placeholder` 1-64. Na 10.3 também há `force_reply` dentro do teclado inline (o clique abre a resposta) | `reply_markup: { force_reply: true, input_field_placeholder: "Motivo" }` | Em grupo, `selective` |
| **Editar mensagem e teclado** | `editMessageText` (texto, e agora mensagem rica), `editMessageReplyMarkup`, `editMessageCaption`, `editMessageMedia`, `deleteMessage`. Passar `reply_markup` vazio remove o teclado. Dentro do clique: o `ctx` já sabe a mensagem. Texto igual ao atual dá erro "message is not modified" (precisa ser ignorado) | `ctx.editMessageText(texto, { parse_mode, reply_markup })`, `ctx.api.editMessageText(chatId, msgId, ...)` | Igual |
| **Formatação** | `parse_mode: "HTML"` ou `"MarkdownV2"` (o `Markdown` legado é obsoleto). HTML: `<b> <i> <u> <s> <code> <pre> <a href> <tg-spoiler> <blockquote> <blockquote expandable> <tg-emoji> <tg-time unix=...>`. Só `&lt; &gt; &amp; &quot;` como entidades nomeadas. MarkdownV2 exige escapar `_ * [ ] ( ) ~ ` > # + - = \| { } . !` (inclusive pontuação comum de texto em português). Citação e citação expansível não aninham. Texto: 1-4096 caracteres **depois** de processar as entidades. Alternativa sem escapar: passar `entities` prontas | `{ parse_mode: "HTML" }`; no grammY, plugin `@grammyjs/parse-mode` (`fmt`, `bold`) monta entidades com escape automático (plugin não verificado nesta rodada) | Igual |
| **Citação expansível e spoiler** | `<blockquote expandable>` mostra 3 linhas e "ver mais": ótimo para detalhes (frete, impostos, histórico). `<tg-spoiler>` esconde até o toque; em mídia, `has_spoiler` | HTML acima | Igual |
| **Mensagem rica** (10.1+, nova) | `sendRichMessage` com blocos: títulos, listas, **tabelas (até 20 colunas)**, `details` recolhível, citações, mídia, **linhas de botões** (callback, URL, copiar, `disabled`). Até 32.768 caracteres, 500 blocos, 16 níveis, 50 mídias. Entra por `html`, `markdown` ou `blocks`. Edição por `editMessageText` ([doc](https://core.telegram.org/bots/api/rich-messages)) | `bot.api.sendRichMessage(chatId, { html: "<table>..." })` (tipo presente no grammY 1.46.0). **Não verificado:** versão mínima do app do usuário, comportamento em clientes antigos, e se vale em grupo | Não verificado |
| **Mídia e álbuns** | `sendPhoto`, `sendDocument`, `sendVideo`, `sendAudio`, `sendVoice`... Legenda 0-1024 caracteres. `sendMediaGroup`: álbum de 2 a 10 itens (documentos só se misturam com documentos; limite conhecido, não reconferido nesta rodada). Bot envia arquivos até 50 MB e baixa até 20 MB pela API padrão (servidor local da Bot API chega a 2000 MB) | `ctx.replyWithDocument(new InputFile(buffer, "mapa.pdf"), { caption })`; `replyWithMediaGroup([InputMediaBuilder.photo(...)])` | Igual |
| **Documento (PDF do mapa)** | `sendDocument` com `InputFile` de buffer, nome e legenda (com `parse_mode` e teclado inline). Reenviar por `file_id` não gasta upload | `new InputFile(uint8, "mapa-pedido-12.pdf")` | Igual |
| **Enquetes** | `sendPoll`: pergunta 1-300, opções 1-100 cada, `is_anonymous`, `allows_multiple_answers`, quiz. A 10.0 baixou o mínimo para 1 opção. O bot só recebe `poll_answer` de enquete **não anônima**; em enquete de bot em chat privado o resultado chega por `poll_answer` | `ctx.replyWithPoll("Qual prazo?", ["3 dias","5 dias"], { is_anonymous: false })` | Em grupo, anônima por padrão |
| **Ações de chat** | `sendChatAction`: `typing`, `upload_document`, `upload_photo`, `record_voice`... Dura até 5 s ou até a mensagem do bot chegar, então para tarefas longas é preciso repetir a cada ~4 s | `ctx.replyWithChatAction("typing")` | Igual |
| **Rascunho em streaming** | `sendMessageDraft` (9.5, todos os bots) e `sendRichMessageDraft`: prévia temporária de 30 s do texto sendo gerado; depois é preciso mandar a mensagem final. 10.3 trouxe `can_stop`/`keep_on_stop` e um update quando o usuário para a geração. **Não verificado:** se vale só em chat privado | `ctx.api.sendMessageDraft(chatId, draftId, texto)` | Não verificado |
| **Reações** | `setMessageReaction` põe emoji do conjunto permitido na mensagem **do usuário** (ex.: 👀, 👍). Na 10.0 há métodos para apagar uma ou todas as reações | `ctx.react("👀")` | Igual |
| **Mensagem fixada** | `pinChatMessage` (em privado funciona sem direito de admin); `disable_notification` | `ctx.api.pinChatMessage(chatId, msgId)` | Em grupo exige ser admin |
| **Deep link** | `https://t.me/<bot>?start=<payload>`: payload 1-64 caracteres `A-Za-z0-9_-`; chega como `/start <payload>` (já usado no convite). `?startgroup=` para grupo | `ctx.match` com `bot.command("start")` | Privado e grupo (`startgroup`) |
| **Comandos e botão de menu** | `setMyCommands` (lista `/comando` com descrição, por idioma e por escopo: privado, grupo, admin, chat específico), `setChatMenuButton` (botão "Menu" ao lado do campo: lista de comandos, ou abre Mini App) | `bot.api.setMyCommands([...])`; `bot.command("pedidos", ...)` | Escopos separados |
| **Mini Apps / Web Apps** | Página web dentro do Telegram, aberta por botão (`web_app`), menu, ou link direto; fala com o bot por `initData` assinado e `answerWebAppQuery`. Na 10.2 os métodos ficam restritos ao domínio original do app. Exige HTTPS e hospedagem própria | botão `{ text, web_app: { url } }` | Botão `web_app` só em privado |
| **Modo inline** | `@bot consulta` em qualquer chat; bot devolve `InlineQueryResult*` via `answerInlineQuery`. Precisa ligar no BotFather. Serve para o usuário **compartilhar** coisas, não para conversa de cotação | `bot.on("inline_query", ...)` | Funciona em qualquer chat |
| **Citação e resposta** | `reply_parameters: { message_id, quote }` faz a mensagem do bot aparecer como resposta a uma mensagem anterior (a `quote` aceita 0-1024 caracteres). Bom para ligar uma resposta à mensagem certa quando há vários pedidos | `ctx.reply(texto, { reply_parameters: { message_id } })` | Igual |
| **Efeitos de mensagem** | `message_effect_id` (confete, 👍...) só em **chats privados** | `{ message_effect_id: "..." }` | Só privado |
| **Mensagens efêmeras** (10.2, nova) | O bot manda/edita/apaga mensagem visível a **um** usuário numa conversa pública; precisa ser em até 15 s de uma ação elegível; entrega não garantida. Pensada para grupos | `ephemeral_message_parameters` | Pensada para grupo |
| **Checklists** (9.1+) | Lista de tarefas marcáveis, para contas Premium via conexão de negócio. Fora do caso de uso | — | — |
| **Opções comuns de envio** | `disable_notification` (silencioso), `protect_content`, `link_preview_options`, `allow_paid_broadcast` | argumentos de `sendMessage` | Igual |

Nota sobre a tabela inline: o teto de botões por mensagem (100) e por linha (8) é conhecimento geral da Bot API; não consegui reconfirmar o texto oficial nesta rodada. O corte de rótulo em 64 caracteres em `src/canais/telegram.ts:85` é uma cautela do código, não um limite oficial verificado: o cliente corta rótulos longos visualmente.

**Plugins do grammY úteis** (não verificados nesta rodada, vêm da documentação do grammY; checar versão e compatibilidade com grammY 1.46 antes de adotar): `@grammyjs/menu` (menus inline com estado e edição automática), `@grammyjs/conversations` (formulários em passos), `@grammyjs/parse-mode` (formatação com escape), `@grammyjs/hydrate` (`msg.editText()` direto). Como os fluxos do kotala guardam estado no banco e seguem o modelo `receber()/enviar()` independente de canal, **a proposta abaixo não depende de nenhum deles**.

---

## 3. Mapa para os casos do kotala (análise)

| Etapa do fluxo | Recurso | Para quê | Prioridade |
|---|---|---|---|
| Pedido do comprador | "Digitando..." (`sendChatAction`) | Interpretação por IA leva segundos; hoje o chat fica mudo | **Alta** |
| Pedido do comprador | Reação 👀 na mensagem/áudio do comprador | "Recebi" imediato, sem mensagem extra | Média |
| Pedido do comprador | Formatação HTML (negrito na quantidade/item, lista) na confirmação | Ler a confirmação de relance | **Alta** |
| Pedido do comprador | Botões `style` (Confirmar verde, Cancelar vermelho) | Ação principal destacada, menos toque errado | **Alta** |
| Confirmação do pedido | Editar a mensagem no clique ("Confirmado ✔" no lugar do teclado) | Deixa o histórico limpo e mostra o que foi decidido | **Alta** |
| Especificação do item | Botões de variação da base (`pedido:..:base:`), já existem | Adicionar edição da mesma mensagem ao escolher | Média |
| Especificação do item | `ForceReply` com `input_field_placeholder` ("Ex.: 50 mm, alta densidade") | Pergunta de esclarecimento com campo pronto | Média |
| Especificação do item | Teclado de resposta `one_time` para escolhas curtas (setor, urgência) | Alternativa aos inline quando a resposta é texto | Baixa |
| Cotação ao fornecedor | Texto em HTML com citação expansível para detalhes (especificação completa, condições) | Mensagem curta com o resto sob demanda | Média |
| Cotação ao fornecedor | `copy_text` com o código do item (ITM-...) | Fornecedor cola o código ao responder | Baixa |
| Cotação ao fornecedor | Anexo (foto/PDF da especificação) com `sendDocument`/`sendPhoto` | Hoje `anexos` de saída é ignorado (`telegram.ts:90`) | Média |
| Resposta/proposta do fornecedor | Reação 👍/👀 e "digitando..." enquanto o Extrator lê PDF/foto/áudio | Fornecedor sabe que foi recebido | **Alta** |
| Resposta/proposta do fornecedor | `reply_parameters` ao confirmar ("Recebi sua proposta de R$ ...") | Liga a resposta à mensagem enviada | Média |
| Confirmar preço, completar proposta | Botões com `style` e edição do teclado após resposta | Fornecedor não responde duas vezes | **Alta** |
| Negociação | Botões de contraproposta ("Aceito R$ X", "Mantenho", "Preciso falar com uma pessoa") | Menos erro de interpretação de texto livre | **Alta** |
| Negociação | `ForceReply` para "qual preço você consegue?" | Resposta numérica guiada | Média |
| Mapa de cotação | HTML (negrito no preço, vencedora destacada) + citação expansível para "Fora da comparação" e referência de mercado | O texto do mapa é longo (limite 4096 hoje cortado em silêncio em `telegram.ts:90`) | **Alta** |
| Mapa de cotação | PDF do mapa (`sendDocument`) com legenda e botões de decisão | Para imprimir/encaminhar à chefia; texto passa a ser resumo | **Alta** |
| Mapa de cotação | Mensagem rica com tabela | Comparação lado a lado; depende de cliente novo | Média (testar antes) |
| Mapa de cotação | Lista paginada (mais de 5 propostas) com "‹ 1/2 ›" editando a mensagem | Hoje há um botão por proposta em `decisao.ts:140` | Média |
| Aprovar | Dois toques com edição: "Aprovar X" troca a **mesma** mensagem por "Confirma? Sim/Voltar"; "Voltar" restaura o mapa | Corrige o achado 1.4.1 | **Alta** |
| Reprovar com motivo | Botões de motivo, já existem, com edição; "Outro motivo" abre `ForceReply` para texto livre | Motivo é regra de negócio (`src/texto.ts:31`) | **Alta** |
| Avisos (`tipo: "aviso"`) | Silenciosos (`disable_notification`) quando forem informativos | Menos ruído | Baixa |
| Clique em botão velho | `answerCallbackQuery` com `show_alert` ("Esse mapa foi atualizado") | Substitui mensagem nova de erro | **Alta** |
| Convite/cadastro | Deep link já usado; acrescentar `/start` com mensagem de boas-vindas e `setMyCommands` (`/pedidos`, `/ajuda`) | Descoberta de comandos; botão Menu | Média |
| Cadastro do fornecedor | Multi-seleção de categorias (`cad:cat:i`) editando os "✓" na mesma mensagem | Já existe, mas manda mensagem nova a cada toque? (conferir) | Média |
| Cadastro do fornecedor | `request_contact` (telefone) | Só se o telefone virar dado exigido; hoje não é | Baixa |
| Qualquer etapa | `pinChatMessage` do pedido em andamento | Muito ruído com vários pedidos | Baixa |

**Não vale a pena (agora):**

- **Mini App:** exige hospedar HTTPS e autenticar `initData`; já existe a tela web da Frente 1. Reavaliar só se o comprador pedir editar o pedido dentro do Telegram.
- **Modo inline:** serve para compartilhar, não para cotar.
- **Enquete:** o fornecedor responde com número e prazo, que enquete não coleta; o comprador decide por botão.
- **Efeitos de mensagem e mensagens efêmeras:** enfeite e foco em grupo; o kotala é conversa privada.
- **Rascunho em streaming (`sendMessageDraft`):** o fluxo é de respostas curtas depois do processamento; "digitando..." resolve o incômodo.
- **Teclado de resposta como padrão:** troca o teclado do usuário e dificulta enviar áudio/foto/PDF livremente; usar só em passos curtos e com `one_time`.

---

## 4. Proposta modular (proposta, nada implementado)

### 4.1 Princípios

1. **Os fluxos continuam chamando `enviar()`** com texto e botões. Nada em `src/nucleo/mensagens/` é reescrito.
2. **Componentes são funções puras** em `src/fluxo/componentes/` que recebem dados e devolvem uma estrutura de saída (texto simples + botões + anexos + dica de formato). O formato "mais rico" é uma **dica opcional**; o canal pode ignorá-la.
3. **Cada canal degrada sozinho**: o texto simples sempre é completo. Telegram acrescenta HTML, estilo de botão, edição e documento. Web usa os `botoes` gravados em `mensagem.botoes`. E-mail e WhatsApp recebem o componente já convertido em lista numerada ou links.
4. **Toda a lógica específica de Telegram** (HTML, escape, codificação de callback, edição) fica em `src/canais/telegram.ts` (ou em arquivos que ele importa dentro de `src/canais/`, que é da Frente 4).

### 4.2 Vocabulário de componentes

| Componente | Dados | Telegram | Web | E-mail | WhatsApp (branch pausado; limites do canal não verificados aqui) |
|---|---|---|---|---|---|
| **Escolha** (`escolha`) | pergunta, opções `{rotulo, valor, estilo?}`, `unica`/`multipla` | Teclado inline; `unica`: ao clicar, edita a mensagem para "Você escolheu: X"; `multipla`: edita os "✓" e tem botão "Pronto" | Botões do chat (já lê `botoes`) | Lista numerada "Responda 1, 2 ou 3" + links `mailto:` com assunto pré-preenchido (se o e-mail passar a ler respostas, E2) | Até 3 botões de resposta; senão lista interativa (limites a conferir) |
| **Confirmação** (`confirmacao`) | texto, rótulo do sim (`sucesso`), do não (`perigo`), efeito colateral | Dois botões com `style`; clique troca a mensagem por "Confirmado ✔" | Modal já existente | Texto "Responda SIM para confirmar" | Dois botões de resposta |
| **Formulário de passos** (`formulario`) | passos `{chave, pergunta, tipo: texto/numero/escolha, validar}` | Uma pergunta por vez, `ForceReply` com `placeholder` ou botões; progresso "2 de 4" editado na mesma mensagem; "Pular" e "Cancelar" | Mesma sequência no chat | Uma mensagem só com todas as perguntas numeradas | Pergunta a pergunta em texto |
| **Lista paginada** (`lista`) | itens, tamanho da página, ação por item | Botões por item + linha "‹ 1/3 ›" que **edita** a mesma mensagem | Lista na tela | Todos os itens (sem paginar) | Lista interativa ou texto |
| **Documento** (`documento`) | nome, bytes ou referência, legenda, botões | `sendDocument` (`InputFile`) com legenda em HTML e teclado | Link para baixar na tela | Anexo do e-mail (`nodemailer` aceita `attachments`) | Documento |
| **Aviso rápido** (`aviso`) | texto curto, `alerta?` | `answerCallbackQuery` (aviso ou janela) quando for resposta a clique; senão mensagem silenciosa | Toast | — | — |
| **Detalhes** (`detalhes`) | resumo + texto longo | `<blockquote expandable>` | Seção recolhível | Texto corrido | Texto corrido |

Exemplo da forma (ilustrativo):

```ts
// src/fluxo/componentes/tipos.ts  (proposta)
export type Opcao = { rotulo: string; valor: string; estilo?: "principal" | "sucesso" | "perigo" };
export type Saida = {
  texto: string;                 // sempre completo, em texto simples
  botoes?: Botao[];              // o Botao de hoje, com 'estilo' opcional
  anexos?: Anexo[];
  formato?: "html";              // dica: texto já está em HTML seguro para canais que aceitem
  substitui?: boolean;           // dica: editar a mensagem do clique em vez de enviar outra
};

export const escolha = (p: { pergunta: string; opcoes: Opcao[]; prefixo: string }): Saida => ({ ... });
export const confirmacao = (p: { texto: string; sim: Opcao; nao: Opcao; prefixo: string }): Saida => ({ ... });
```

Um fluxo usaria: `await enviar(contato.id, s.texto, { ...ctx, botoes: s.botoes, anexos: s.anexos, formato: s.formato, substitui: s.substitui })`.

### 4.3 Onde encaixa na abstração existente

| Peça | Arquivo | Mudança | Dono |
|---|---|---|---|
| Componentes e geração de `Saida` | `src/fluxo/componentes/*.ts` (novo) | Criar | Frente 4 |
| Formatação segura (HTML + escape), `plural`, `quantidade` etc. | `src/texto.ts` | Acrescentar `esc(html)`, `negrito()`, `citacaoExpansivel()`; sem mexer nas existentes | Frente 4 |
| Renderização Telegram (HTML, `style`, edição, documento, "digitando", reação) | `src/canais/telegram.ts` | Mudar `enviar` e o handler de `callback_query` | Frente 4 |
| Fallback e-mail (lista numerada, anexos) | `src/canais/email.ts` | Usar `opcoes.botoes` e `opcoes.anexos` | Frente 4 |
| Mapa como documento e botões do mapa | `src/agentes/comparador/index.ts` | Hoje só chama `enviar` com texto e `botoesDecisao`; a Frente 4 não é dona do comparador, então qualquer mudança aqui é pedido entre frentes | outro dono |
| Tipos de `Botao`/`OpcoesEnvio`/`MensagemEntrada` | `src/nucleo/mensagens/index.ts` | **Acréscimos pequenos de tipo, só campos opcionais** (4.7) | Pedido entre frentes |

### 4.4 Renderização no adaptador do Telegram

Ordem de decisão em `enviar(endereco, texto, opcoes)`:

1. Se `opcoes.anexos` tiver documento a enviar: `sendDocument` com legenda (até 1024) e o teclado; se o texto passar disso, manda a legenda curta e o resto como mensagem.
2. Senão `sendMessage` com `parse_mode: "HTML"` **somente** quando `opcoes.formato === "html"`; do contrário, texto cru como hoje (compatível com todo o código existente).
3. Texto acima de 4096: dividir em várias mensagens em quebras de linha (hoje `slice(0, 4096)` corta o mapa em silêncio), ficando o teclado só na última.
4. Se `opcoes.substitui` e houver id da mensagem clicada: `editMessageText` (ignorar "message is not modified") em vez de enviar.
5. Antes de qualquer resposta demorada: `sendChatAction("typing")`, repetido a cada ~4 s enquanto a IA roda (ver 4.6).

Botões: `{ text, callback_data, style }` cru, para usar `style` (a API de atalho `.text()` do grammY não traz esse campo).

### 4.5 `callback_data` dentro de 64 bytes

Hoje funciona por pouco (seção 1.4.4). Proposta:

- Formato único `v1|<acao>|<a>|<b>...`, com **uuid em base64url** (22 caracteres em vez de 36) e ids numéricos em base36. Exemplo: `v1|apv|12|Qm9...` cabe com folga.
- Um codificador/decodificador único em `src/canais/telegram.ts` (ou `src/fluxo/componentes/dado.ts`, já que o fluxo também lê o dado). O adaptador **recusa em voz alta** (`Buffer.byteLength(dado) > 64` → lança erro de rótulo/dado) em vez de deixar o Telegram devolver 400 e perder a mensagem inteira.
- Para dados que não cabem (listas longas, textos): guardar o payload em memória/tabela e mandar só um token curto. Tabela nova exige migração (só a Frente 2 gera); então a primeira versão evita isso, usando só ids que já estão no banco (item, oferta, rodada). O estado mora no banco, o botão só aponta para ele.
- **Compatibilidade:** o leitor aceita os dois formatos (o atual e o `v1|`) por um tempo, porque mensagens antigas já enviadas ainda têm botões no chat do comprador. As regexes de `decisao.ts:45`, `comprador.ts:50-55`, `:454` e `fornecedor.ts:45` seriam trocadas por um `lerDado()` central.
- **Rótulos:** manter até 18 caracteres por botão quando 2 ou 3 por linha (como hoje); acima disso uma linha por botão.

### 4.6 Botão velho, clique duplo e edição no lugar

**Botão velho (versão):** cada botão de decisão carrega a **rodada** (e, quando fizer sentido, o id do mapa). O fluxo compara com o estado atual; se não bate, responde com aviso e não executa. Hoje isso já existe pelo estado do item (`decisao.ts:54-58`); falta o aviso discreto e marcar o mapa antigo como "desatualizado".

**Duplicado:** três camadas, todas já parcialmente presentes.
1. `idExterno = cb:<id>` já elimina reentrega do mesmo update (`mensagens/index.ts:127`).
2. `sequentialize` por chat serializa o processamento.
3. Guarda de estado do item/pedido (`TransicaoConcorrente` com `ignorarCorrida`). Acrescentar: editar a mensagem clicada **antes** de processar, para o segundo toque cair num teclado que já mudou.

**Editar em vez de mandar outra:** o handler de `callback_query` (`telegram.ts:54-59`) passaria de "tirar o teclado" para o ciclo:
1. `answerCallbackQuery()` (sem texto) imediato, para parar o relógio.
2. Descobrir o rótulo clicado no `reply_markup` da mensagem original e **editar a mensagem**: trocar o teclado por uma linha "✔ Você escolheu: Aprovar Fornecedor X" (mantendo o texto do mapa) ou, quando o componente pedir `substitui`, trocar texto e teclado pelo próximo passo.
3. Entregar ao núcleo com o id da mensagem clicada.

Para que o fluxo possa pedir "troque a mensagem do clique" ou "dê um aviso rápido", faltam duas coisas na `MensagemEntrada` (4.7). Enquanto isso não existir, o adaptador pode fazer sozinho o passo 2 (marcar a escolha), que já resolve o achado 1.4.1 parcialmente; o passo "Voltar restaura o mapa" precisa de `substitui`.

**"Digitando...":** um auxiliar `comDigitando(chatId, async () => ...)` no adaptador, ligado por `OpcoesEnvio.tipo` ou chamado pelo roteador do fluxo antes do Interpretador/Extrator. Como o fluxo é independente de canal, o gancho natural é o `aoReceber` (`src/fluxo/index.ts`) pedir ao canal. Exige um método opcional `acao?(endereco, "digitando")` em `AdaptadorCanal` (4.7).

### 4.7 Acréscimos pequenos em `src/nucleo/` (a anotar em "Pedidos entre frentes")

Todos opcionais, sem mudar comportamento existente, sem migração (`botoes` é jsonb, `schema.ts:284`; campo extra dentro do objeto não exige migração, mas o tipo TypeScript lá precisaria acompanhar, e `schema.ts` é do dono das migrações, então é melhor guardar só `rotulo` e `dado` e deixar `estilo` fora do banco, ou pedir o ajuste de tipo).

| # | Acréscimo | Arquivo | Para quê |
|---|---|---|---|
| 1 | `Botao.estilo?: "principal" \| "sucesso" \| "perigo"` | `src/nucleo/mensagens/index.ts:33` | cor do botão no Telegram; ignorado nos outros canais |
| 2 | `OpcoesEnvio.formato?: "html"` e `OpcoesEnvio.substitui?: boolean` | `:36-42` | HTML seguro e edição no lugar |
| 3 | `MensagemEntrada.mensagemRef?: string` (id da mensagem clicada) e `MensagemEntrada.responder?: (aviso: { texto: string; alerta?: boolean }) => Promise<void>` | `:15-31` | edição no lugar e aviso rápido ao clique |
| 4 | `AdaptadorCanal.acao?(endereco, acao: "digitando")` | `:45-50` | "digitando..." |

Texto sugerido para "Pedidos entre frentes" (em `docs/frentes.md`, a ser acrescentado pela Frente 4 quando for implementar): *"Frente 4 pede acréscimos opcionais de tipo em `src/nucleo/mensagens/index.ts`: `Botao.estilo`, `OpcoesEnvio.formato` e `substitui`, `MensagemEntrada.mensagemRef` e `responder`, `AdaptadorCanal.acao`. Sem mudança de comportamento. Além disso, para enviar o mapa como documento e o texto formatado, o comparador (`src/agentes/comparador/index.ts:292`) teria de montar o texto com os componentes ou expor `Comparacao` para a Frente 4 renderizar."*

### 4.8 Ordem sugerida (do que dá mais retorno com menos risco)

1. Escape + HTML opcional + divisão de mensagens longas (`src/texto.ts`, `telegram.ts`). Não muda nada para quem não pedir `formato`.
2. Edição no lugar no clique (corrige 1.4.1) e `answerCallbackQuery` com aviso.
3. `style` nos botões de confirmar/aprovar/reprovar.
4. "Digitando..." e reação de recebido.
5. Componentes `escolha` e `confirmacao`, e migração dos fluxos atuais (um por vez, com os testes de `testes/comprador.test.ts` etc. cobrindo `dado` antigo e novo).
6. `documento` (PDF do mapa) e `lista` paginada.
7. Fallback do e-mail (lista numerada, anexo).
8. Só depois, avaliar mensagem rica com tabela para o mapa, testando em clientes reais.

### 4.9 Riscos e perguntas em aberto

- **Mensagem rica (10.1+):** recurso novo; não verifiquei versão mínima de cliente nem fallback. Testar em celular e desktop antes de depender; manter o texto simples como saída garantida.
- **Edição de mensagens antigas:** não verifiquei se existe limite de tempo para o bot editar a própria mensagem em chat privado comum. Tratar o erro de edição e cair para mensagem nova.
- **Dois bots, dois tokens:** `file_id` e callbacks valem por bot; o adaptador já escolhe o bot pelo papel (`telegram.ts:76-77`), então a edição deve usar o mesmo bot do clique.
- **Testes ao vivo:** exigem par de bots de teste (ver "Bots do Telegram" em `docs/frentes.md`). Os componentes puros (texto, botões, codificação de dado) testam sem Telegram, com `canalEmMemoria` (`mensagens/index.ts:229`).
- **E-mail com respostas:** só vale oferecer "responda 1, 2 ou 3" quando o e-mail passar a ler respostas (E2 está pendente, `docs/arquitetura.md:267`).

## Fontes

- Bot API: <https://core.telegram.org/bots/api>, histórico <https://core.telegram.org/bots/api-changelog>, formatação <https://core.telegram.org/bots/api/formatting>, mensagens ricas <https://core.telegram.org/bots/api/rich-messages>.
- Tipos instalados e comentários de limite: `node_modules/@grammyjs/types/*.d.ts` (versão 5.0.0).
- Código lido: `src/canais/telegram.ts`, `src/canais/web.ts`, `src/canais/email.ts`, `src/nucleo/mensagens/index.ts`, `src/texto.ts`, `src/bots.ts`, `src/fluxo/decisao.ts`, `src/fluxo/comprador.ts`, `src/fluxo/fornecedor.ts`, `src/agentes/comparador/index.ts`, `src/nucleo/db/schema.ts`.
