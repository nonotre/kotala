# Frentes de trabalho em paralelo

Divisão do trabalho a partir do commit do rastreio completo (07/11/2026, logo depois de `1b91375`), para duas frentes andarem ao mesmo tempo em worktrees separadas e serem juntadas depois sem conflito. Leia junto com [arquitetura.md](arquitetura.md).

## Quem faz o quê

| Frente | Módulos | Branch | Quem |
|---|---|---|---|
| **1 · Telas** | R10 Quadro, Q1 Mapa de cotação em tela, N5 Raciocínio visível, X4 Painel de economia, E3 Chat web | `frente-1-telas` | Claude, na worktree principal |
| **3 · Entradas e contato** | R1b Pedido por áudio, E6 Base de itens com botões, E1 Convite do fornecedor por e-mail com link pessoal (substitui o cadastro com pergunta do nome, ver [decisoes.md](decisoes.md)) | `frente-3-entradas` | Dono do repo, com outro agente, em outra worktree |

Frentes 2 (negociação e reprovação com motivo), 4 (voz) e 5 (pitch e testes de manipulação) ficam para depois.

## Arquivos de cada frente

Cada frente só edita os arquivos dela. Precisou mexer num arquivo da outra ou num arquivo comum? Siga a seção "Arquivos comuns".

**Frente 1 · Telas**

- Cria: `web/` (app Next com as telas), `src/canais/web.ts` (canal do chat web).
- Pode editar: `package.json` (scripts e dependências das telas), `docker-compose.yml` (serviço das telas), `README.md` (seção das telas), `docs/arquitetura.md` (seção das telas).
- Só lê: o banco, pelas tabelas do N1. As ações (aprovar, escolher outra, cotar de novo, buscar mais, confirmar pedido) chamam as mesmas funções do Telegram: `aoBotaoDoComprador` em `src/fluxo/decisao.ts` e `aoMensagemDoComprador` em `src/fluxo/comprador.ts`, sem alterar esses arquivos.

**Frente 3 · Entradas e contato**

- Cria: `src/canais/email.ts`, `src/agentes/interpretador/base-itens.ts` (ou equivalente), testes novos.
- Pode editar: `src/fluxo/comprador.ts` (áudio e botões de especificação), `src/fluxo/fornecedor.ts` (convite por link pessoal), `src/agentes/interpretador/`, `src/agentes/cotador/index.ts` (envio do convite por e-mail junto da cotação), `src/canais/telegram.ts` (áudio).

## Arquivos comuns: regras

| Arquivo | Regra |
|---|---|
| `src/nucleo/db/schema.ts` e `drizzle/` | **Só a Frente 3 gera migração.** A Frente 1 não muda o schema; se precisar de algo novo, anota aqui embaixo e a Frente 3 inclui. Motivo: duas migrações geradas em paralelo quebram o `_journal.json` |
| `src/nucleo/**` (núcleo) | Ninguém muda comportamento. Acréscimo pequeno (exportar uma função, um campo opcional) vale, anotado aqui embaixo |
| `src/fluxo/decisao.ts`, `src/agentes/comparador/` | Nenhuma das duas edita (são da Frente 2) |
| `.env.exemplo` | As duas podem acrescentar variáveis, sempre no fim do arquivo, em bloco com comentário. Na junção, manter os dois blocos |
| `package.json` e `package-lock.json` | As duas podem acrescentar dependências. Na junção, refazer o lock com `npm install` em vez de resolver o conflito à mão |
| `README.md`, `docs/arquitetura.md` | Cada frente acrescenta a sua seção; não reescreve a dos outros |

**Rastreio:** a base já grava tudo (auditoria por gatilho, eventos, IA com prompt e resposta, mensagens ligadas ao pedido, arquivos com hash; ver [arquitetura.md](arquitetura.md#rastreio-nada-se-perde)). A Frente 3 deve ligar cada mensagem nova ao pedido com `vincularMensagem` e baixar anexos com `baixarAnexo(canal, anexo, mensagemId)`, que já guarda o original. Tabela nova de negócio entra na lista de gatilhos da auditoria (migração `0007`, numa migração nova).

**Bot do Telegram:** um processo por token. Quem não está com o container ligado testa com `npm run simular` (banco de teste). A Frente 1 não precisa do bot rodando.

## Pedidos de uma frente para a outra

Anote aqui o que uma frente precisa que a outra faça (campo novo, função exportada).

- (vazio. O pedido de prompt e resposta em `uso_ia` já entrou na base, junto com a auditoria por gatilho.)

## Como juntar

1. Cada frente faz commits no seu branch e roda `npm run checar` antes de cada um.
2. Junta primeiro a frente que terminar antes: `git checkout main && git merge --no-ff frente-N-...`.
3. A segunda faz `git rebase main` (ou `git merge main`) no seu branch, resolve conflitos seguindo a tabela acima, roda `npm run db:migrar` e `npm run checar`, e só então é juntada.
4. Antes do push: a checagem de sempre (nada de `.env`, de arquivos locais fora do git ou de valores de chave no que vai subir).
5. Depois da junção, reconstruir o container: `docker compose up -d --build`.
