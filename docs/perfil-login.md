# Perfil e login (Frente 2, rodada 2)

Branch `f2-perfil-login`, telas de teste na porta 3320. Plano geral em [frentes.md](frentes.md).

## O que entrou

- **Contas no banco.** Tabela `usuario` (migração `0015_usuario`): `login` único e minúsculo, `nome`, `senha_hash` (scrypt, `sal:hash` em hex). Qualquer pessoa cria a sua conta na tela de entrada; a regra mora em `src/contas.ts`.
- **Login simples, de propósito.** A sessão é só o `{ id, login, nome }` no `localStorage` do navegador (`kotala-sessao`, em `web/components/conta/sessao.ts`). Não há cookie nem checagem no servidor: serve para separar as pessoas e os chats, não para proteger dados. Sem sessão, a casca manda para `/login` (`web/components/conta/Guarda.tsx`).
- **Conta criada à mão, sem senha.** Para a Ester e a Liria, a conta já existe sem senha: a senha digitada na primeira entrada passa a ser a delas. Assim nenhuma senha fica no repositório. Antes disso, qualquer um que digite `ester` ou `liria` poderia tomar a conta; vale avisar as duas para entrarem logo.
- **Chat web por usuário.** Cada usuário tem um contato `web` com o próprio id como endereço, criado ao entrar ou ao criar a conta. O chat da tela `/chat` usa esse endereço no lugar do id aleatório que ficava no navegador; as conversas antigas, de ids aleatórios, ficam no banco sem dono.
- **Contato ligado a uma pessoa.** Coluna nova `contato.usuario_id`. O Telegram da Ester e da Liria foi ligado à mão (ver abaixo).
- **Dono do card.** O dono de um pedido é o usuário ligado ao contato que o fez (`pedido.comprador_id → contato.usuario_id → usuario.nome`). Aparece no card do Quadro, na Lista e nos Detalhes da cotação (junção: a Frente 1 tirou o dono do cabeçalho); sem usuário ligado, aparece "Sem responsável". O responsável pode ser trocado (`pedido.responsavel_id`). Todos veem todos os cards: o dono só diz quem é o responsável.
- **Espelho do Telegram, só leitura.** Desde a junção, é a conversa "Seu Telegram" na lista de Conversas da Frente 1 (lateral do Início), marcada por `contato.usuario_id`; o `EspelhoTelegram.tsx` e o `/api/chat?canal=telegram` saíram para não haver dois espelhos. Não tem campo de envio, de propósito: no lugar há o botão que abre o bot.
- **Sua conta.** Em Configurações, o bloco "Sua conta" mostra o nome, o usuário e os canais ligados. Empresas e endereços continuam sendo a demonstração no navegador (`demo.ts`).

## Telegram da Ester e da Liria

As contas `ester` e `liria` estão ligadas ao Telegram de compradora de cada uma. Em 08/11/2026 todos os dados de teste delas foram apagados a pedido do dono (conversas, pedidos e os fornecedores em que se passaram, "Cleiton Extintores" e "vizzano", com backup feito antes); as contas e a ligação do Telegram de compradora ficaram. Para ligar outra pessoa, use o `/vincular` (abaixo); `scripts/ligar-telegram.ts` continua para o caso manual.

## Bloco 4 (08/11/2026): o que era "próxima rodada" e entrou

- **Sessão no servidor.** Ao entrar, uma linha em `sessao` (vale 30 dias) e o id no cookie httpOnly `kotala_sessao` (SameSite=Lax; Secure em HTTPS). O proxy das telas (`web/proxy.ts`) confere a sessão a cada requisição: sem ela, tela vai para `/login` e API recebe 401. Ações e rotas usam o usuário do cookie, nunca o que vem do navegador; `useSessao()` virou espelho para a interface. Sair apaga a sessão.
- **Empresas e locais de entrega no banco** (E4/E8), no lugar da demonstração: empresa em uso por pessoa (`usuario.empresa_id`, seletor no topo), locais por empresa com um padrão. O local padrão vira o destino do pedido que não diz onde entregar (contato → usuário → empresa → local padrão; sem isso, o `EMPRESA` do `.env`). Faturamento que vai ao fornecedor (R11) continua do `EMPRESA`.
- **"Só os meus"** no Início (`?meus=1`) e **sino e avisos por pessoa** (Meus/Todos), pela mesma regra do dono: responsável, senão o usuário de quem pediu.
- **/vincular.** Em Configurações › Visão geral, um código de 8 caracteres que vale 15 min e uma vez; mandar `/vincular CODIGO` ao bot do comprador liga o Telegram à conta (migração 0019). Contato novo de Telegram sem conta recebe a oferta no primeiro contato.
- **Conversar** voltou a ser tela própria (`/chat`): só as conversas da conta, Telegram primeiro (o espelho), e "Nova conversa".
- Ficaram de fora: convites e papéis Aprovador/Só leitura (não há tabela); qualquer pessoa que entrou edita empresas e locais.

## Fica para depois

Ideias que esta frente não vai fazer, separadas por quem deve pegar. Servem de guia na junção com as outras frentes.

### Frente 4 · IA, Telegram e conversa

- **Espelho só leitura, por decisão.** O espelho do Telegram no site não vai ter campo de envio; responder é sempre no Telegram ("Continuar no Telegram"). Não acrescentar envio por ele.
- **Tela "Conversas" da Frente 1.** Feito na junção: a lista usa o usuário que entrou (`useSessao()`), marca "Você" e "Seu Telegram" por `contato.usuario_id`, e há um espelho só.
- **Ligar o Telegram pela tela, sem script.** Configurações mostra um código; a pessoa manda `/vincular CODIGO` ao bot, e `src/canais/telegram.ts` grava `usuario_id` no contato. Substitui `scripts/ligar-telegram.ts` para gente nova.
- **Contato novo no Telegram sem conta.** Hoje ele vira um contato sem dono. O bot pode oferecer a ligação (o `/vincular` acima) logo no primeiro contato.
- **Usar o nome do dono nas mensagens.** O pedido ao fornecedor e os resumos podem dizer quem está comprando (`usuario.nome`) em vez do nome que veio do Telegram.

### Frente 1 · Telas e navegação

- **Filtro por dono.** "Só os meus" e "por responsável" no Quadro, na Lista e no Início. O campo `dono` já vem nas consultas.
- **Sino e avisos por pessoa.** `contarAvisos()` e `avisosComContexto()` contam os avisos de todos; dá para destacar os do usuário que entrou. A tela só sabe quem entrou no navegador (`useSessao()`), então o filtro tem de ir do cliente, ou a sessão passa para cookie (ver Segurança).
- **Menu de quem entrou no topo.** Hoje o ícone do topo só leva às Configurações; pode abrir um menu com nome, empresa e Sair.
- **Trocar o responsável de um card.** Hoje o dono sai do contato que pediu e não muda. Para reatribuir, precisa de uma coluna `pedido.responsavel_id` (migração, pedir à Frente 2) com o dono atual como valor padrão.

### Frente 3 · Harness

- **O comprador simulado precisa de conta.** Com a guarda, toda tela sem sessão vai para `/login`. Pelo navegador: entrar em `/login` ou gravar `kotala-sessao` no `localStorage` antes de abrir as telas. Pela API: o chat web usa o id do usuário como endereço, então criar a conta com `criarConta()` (`src/contas.ts`) e mandar o chat com `endereco = usuario.id`.
- **Conferir o dono nos cenários.** Um pedido feito pelo chat web de um usuário deve aparecer com o nome dele no Quadro e na Lista.
- Não usar `ester` nem `liria` nos testes: a primeira entrada define a senha delas.

### Dashboard

- **Gasto e economia por comprador.** O dono já sai de `pedido.comprador_id → contato.usuario_id → usuario`; dá um recorte por pessoa nos gráficos.

### Frente 2, numa próxima rodada

- **Perfil, empresa e endereços no banco (E4 e E8).** Hoje são a demonstração no navegador (`web/components/conta/demo.ts`). Ligar usuário a empresa, com papel (comprador, aprovador, só leitura), e fazer o frete usar o endereço salvo.
- **Trocar a senha** e recuperar conta. Hoje, para zerar a senha de alguém: `update usuario set senha_hash = null where login = '...'`, e a próxima entrada define a nova.
- **Segurança de verdade.** Hoje a tela confia no id guardado no navegador, a proteção das rotas é só no navegador e a API interna (`/chat`) aceita mensagem para qualquer endereço. O caminho: sessão em cookie assinado (httpOnly), proteção das rotas no servidor (`proxy.ts` do Next) e o servidor das telas mandando ao `/chat` o endereço da sessão, sem aceitar o que vem do navegador.
- **Aprovar só o próprio pedido**, se um dia for preciso: hoje qualquer um que entrou aprova qualquer card, de propósito.

### Na junção

- O branch `dashboard-economia` já foi juntado ao `f2-perfil-login` (08/11/2026), sem conflitos. Juntar a Frente 2 ao `main` traz o dashboard junto: os passos "dashboard" e "2 Perfil e login" da ordem de junção viram um só. O dashboard ainda não usa o dono (ideia acima).
- Se o banco principal for recriado, rodar `node --env-file=.env scripts/ligar-telegram.ts` de novo. Os ids dos contatos mudam num banco novo; aí refazer a identificação pela tabela acima (nome no Telegram e pedidos de cada uma).
- Cada worktree nova precisa de `src/dados/` copiado da pasta principal, além do `.env`.

## Pedidos entre frentes

Para copiar em [frentes.md](frentes.md), na seção de mesmo nome, na junção:

- Frente 2 acrescentou `dono` em `web/lib/dados.ts` (`quadro`, `listaPedidos`, `detalhePedido`), em `web/lib/dados-operacao.ts` (`LinhaPedido`) e em `web/lib/dados-pedido.ts`; o card do Quadro, a Lista e os Detalhes da cotação mostram o dono. Frente 1: ao mexer nesses arquivos, manter o campo.
- `Casca.tsx` ganhou a guarda de sessão e o botão de quem entrou; `MenuLateral.tsx`, o Sair que apaga a sessão.
- Migração `0015_usuario` (tabela `usuario` e `contato.usuario_id`) já aplicada no banco principal. A tabela `usuario` fica fora dos gatilhos da auditoria, para não copiar hash de senha para lá; `contato` continua auditado.
- `testes/nucleo.integracao.test.ts`: `usuario` entrou no `truncate`.
- A worktree precisa de `src/dados/` copiado da pasta principal (fica fora do git, como o `.env`); sem isso, 9 testes falham.
