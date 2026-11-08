# Perfil e login (Frente 2, rodada 2)

Branch `f2-perfil-login`, telas de teste na porta 3320. Plano geral em [frentes.md](frentes.md).

## O que entrou

- **Contas no banco.** Tabela `usuario` (migração `0015_usuario`): `login` único e minúsculo, `nome`, `senha_hash` (scrypt, `sal:hash` em hex). Qualquer pessoa cria a sua conta na tela de entrada; a regra mora em `src/contas.ts`.
- **Login simples, de propósito.** A sessão é só o `{ id, login, nome }` no `localStorage` do navegador (`kotala-sessao`, em `web/components/conta/sessao.ts`). Não há cookie nem checagem no servidor: serve para separar as pessoas e os chats, não para proteger dados. Sem sessão, a casca manda para `/login` (`web/components/conta/Guarda.tsx`).
- **Conta criada à mão, sem senha.** Para a Ester e a Liria, a conta já existe sem senha: a senha digitada na primeira entrada passa a ser a delas. Assim nenhuma senha fica no repositório. Antes disso, qualquer um que digite `ester` ou `liria` poderia tomar a conta; vale avisar as duas para entrarem logo.
- **Chat web por usuário.** Cada usuário tem um contato `web` com o próprio id como endereço, criado ao entrar ou ao criar a conta. O chat da tela `/chat` usa esse endereço no lugar do id aleatório que ficava no navegador; as conversas antigas, de ids aleatórios, ficam no banco sem dono.
- **Contato ligado a uma pessoa.** Coluna nova `contato.usuario_id`. O Telegram da Ester e da Liria foi ligado à mão (ver abaixo).
- **Dono do card.** O dono de um pedido é o usuário ligado ao contato que o fez (`pedido.comprador_id → contato.usuario_id → usuario.nome`). Aparece no card do Quadro, na Lista de pedidos e no cabeçalho do pedido; sem usuário ligado, aparece "Sem dono". Todos veem todos os cards: o dono só diz quem é o responsável.
- **Sua conta.** Em Configurações, o bloco "Sua conta" mostra o nome, o usuário e os canais ligados. Empresas e endereços continuam sendo a demonstração no navegador (`demo.ts`).

## Telegram da Ester e da Liria

Só as duas conversaram com os bots de verdade, cada uma nos dois bots (do comprador e do fornecedor). No banco principal havia exatamente quatro contatos de Telegram, dois por pessoa (mesmo id de Telegram nos dois bots):

| Pessoa | Bot | Contato (`contato.id`) | Nome no contato | Pedidos |
|---|---|---|---|---|
| Ester | comprador | `736236bf-ddd9-4f27-a8ed-2af684d569b3` | Leoni | 9, 14, 15 |
| Ester | fornecedor | `d91e350a-c4b7-40dd-8721-80dfa1b48253` | Cleiton Extintores | — |
| Liria | comprador | `055f2067-19fb-4ee7-9917-4ff02adee2e6` | Liria | 3, 10, 11, 12 |
| Liria | fornecedor | `ddca1a92-14fa-497a-8d58-44e8d160a0f4` | vizzano | — |

Como se sabe quem é quem:

- **Liria:** o nome no Telegram do bot do comprador é "Liria".
- **Ester:** o nome no Telegram é "Leoni", o sobrenome dela (Ester Leoni Medeiros, pelo e-mail dos commits). Os pedidos desse contato são de extintor de incêndio, o caso que ela mesma anotou em `docs/workspaces/ester-workspace/analise-erros-cotacao.md`.
- Em cada pessoa, o contato de fornecedor tem o mesmo id de Telegram que o de comprador.

A ligação está em `scripts/ligar-telegram.ts`, que cria as contas `ester` e `liria` sem senha e põe `usuario_id` nesses contatos. O script não faz nada de mais se rodar de novo e já foi rodado no banco principal em 08/11/2026:

```bash
node --env-file=.env scripts/ligar-telegram.ts
```

Os ids acima são do banco principal; num banco novo os contatos não existem e o script só cria as contas.

## Fica para depois

Ideias que esta frente não vai fazer, separadas por quem deve pegar. Servem de guia na junção com as outras frentes.

### Frente 4 · IA, Telegram e conversa

- **Espelho Telegram ↔ chat web.** Uma das conversas do chat no site espelha exatamente o Telegram da pessoa: as mensagens dos contatos de Telegram ligados ao usuário (`contato.usuario_id`) aparecem na tela, e o que se escreve ali sai pelo Telegram. Hoje o chat web é uma conversa separada, com o seu próprio contato `web`.
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

- Frente 2 acrescentou `dono` em `web/lib/dados.ts` (`quadro`, `listaPedidos`, `detalhePedido`), em `web/lib/dados-operacao.ts` (`LinhaPedido`) e em `web/lib/dados-pedido.ts`; o card do Quadro, a Lista e o cabeçalho do pedido mostram o dono. Frente 1: ao mexer nesses arquivos, manter o campo.
- `Casca.tsx` ganhou a guarda de sessão e o botão de quem entrou; `MenuLateral.tsx`, o Sair que apaga a sessão.
- Migração `0015_usuario` (tabela `usuario` e `contato.usuario_id`) já aplicada no banco principal. A tabela `usuario` fica fora dos gatilhos da auditoria, para não copiar hash de senha para lá; `contato` continua auditado.
- `testes/nucleo.integracao.test.ts`: `usuario` entrou no `truncate`.
- A worktree precisa de `src/dados/` copiado da pasta principal (fica fora do git, como o `.env`); sem isso, 9 testes falham.
