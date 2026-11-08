# Frentes de trabalho em paralelo

Rodada 2, aberta em 08/11/2026 a partir do `main` (`d356044`). Quatro frentes em worktrees separadas, juntadas depois com o dashboard, que já está pronto no branch `dashboard-economia`. A rodada anterior (telas, entradas, negociação) já está no `main`; o registro dela fica no histórico deste arquivo. Leia junto com [arquitetura.md](arquitetura.md), [decisoes.md](decisoes.md) e [status.md](status.md).

| Frente | Branch | Pasta | Banco de teste | Porta das telas |
|---|---|---|---|---|
| 1 · Regras de negócio, UI e arquitetura da informação | `f1-regras-ui` | `../kotala-f1` | `kotala_teste_f1` | 3310 |
| 2 · Perfil e login | `f2-perfil-login` | `../kotala-f2` | `kotala_teste_f2` | 3320 |
| 3 · Harness geral | `f3-harness` | `../kotala-f3` | `kotala_teste_f3` | 3330 |
| 4 · IA do comprador e do fornecedor | `f4-ia-conversa` | `../kotala-f4` | `kotala_teste_f4` | 3340 |

## 1 · Regras de negócio, UI e arquitetura da informação

Objetivo: arrumar a navegação e as telas de operação, e dar uma tela às regras de compra.

- Navegação: menu, rotas, trilhas e nomes. Pontos já levantados: Economia sem link no menu, Convite como ação dentro de Fornecedores, o item "Quadro" que também acende em Lista, Pedido e Voz.
- Telas de operação: Início, Quadro, Lista, Pedido e abas, Avisos, Fornecedores, Itens, Convite. Anotações da Liria em `docs/workspaces/liria-workspace/interface.md`.
- Regras de compra com tela: pesos da nota, prazo das respostas, limite de compra maior, regras do mapa.
- É dela: `web/app/`, `web/components/` e `web/lib/`, menos o que é da Frente 2 e do dashboard; `src/agentes/comparador/`; as regras em `src/config.ts`.
- Não mexe: a conversa (fluxo, prompts, Telegram), que é da Frente 4.

## 2 · Perfil e login

Objetivo: cada comprador entra com a sua conta e vê só o que é seu.

- Login de mentira (sem senha de verdade), mas com sessão real no servidor local, no lugar da demonstração que hoje guarda tudo no navegador (`web/components/conta/demo.ts`).
- Cada comprador com os próprios pedidos, avisos e conversas: o chat web passa a ser do comprador que entrou, e o contato do Telegram fica ligado a um comprador.
- Perfil, empresa e endereços salvos no banco (módulos E4 e E8).
- É dela: `web/app/login/`, `web/app/configuracoes/`, `web/components/conta/`, `web/components/chat/`, `src/canais/web.ts`, a proteção das rotas e **as migrações** (`src/nucleo/db/schema.ts` e `drizzle/`).
- Só acrescenta, anotando em "Pedidos entre frentes": o filtro por comprador nas consultas de `web/lib/`, empresa e Sair na `Casca.tsx`, o chat por usuário em `src/api-interna.ts`.

## 3 · Harness geral

Objetivo: um comprador inteligente que opera a solução inteira de ponta a ponta e diz o que quebrou, mais a checagem de modelos melhores.

- Agente comprador que pede, corrige, responde, aprova e reprova pelos mesmos caminhos de um comprador de verdade (canal simulado, chat web, ações da API interna), com os fornecedores simulados do outro lado.
- Cenários repetíveis, conferidos pelo rastro (eventos, mensagens, chamadas de IA), com relatório do que passou e do que falhou.
- Modelos: lista os disponíveis no provedor, roda o mesmo conjunto de casos e compara qualidade, custo e tempo com o modelo atual de cada papel. Sugere a troca; a troca só entra na junção.
- É dela: a pasta nova do harness, scripts e testes novos, `src/simulador/`, `scripts/simular-comprador.ts`, `src/nucleo/ia/config.ts`.
- Não mexe: o comportamento dos agentes e do fluxo. Bug achado vai para a Frente 4, em "Pedidos entre frentes".

## 4 · IA do comprador e do fornecedor

Objetivo: conversas melhores e menos erros nos dois lados.

- Negociação, mensagens, botões e componentes do Telegram, interpretação das propostas, buscar mais fornecedores sozinho quando houver menos de 3 propostas (Q2).
- Bugs: anotações da Ester em `docs/workspaces/ester-workspace/analise-erros-cotacao.md` e o que o harness achar.
- É dela: `src/agentes/` (menos o comparador), `src/fluxo/`, `src/canais/telegram.ts`, `src/canais/email.ts`, `src/texto.ts`.
- Não mexe: as telas, que são da Frente 1.

## O dashboard

Branch `dashboard-economia` (`e8429e9`): o dashboard de economia, com um mock fictício para alimentá-lo. Ficam reservados para ele `web/app/dashboard/`, `web/app/economia/`, `web/components/dashboard/`, `web/lib/dados-dashboard.ts` e `scripts/mock-dashboard.ts`. Ele também muda `web/lib/dados.ts`, `web/components/Casca.tsx`, `package.json` e `docs/arquitetura.md`: quem mexer nesses arquivos deve esperar conflito.

Recomendado: juntar o dashboard ao `main` antes de abrir as worktrees, para as quatro partirem dele.

## Arquivos comuns: regras

| Arquivo | Regra |
|---|---|
| `src/nucleo/db/schema.ts` e `drizzle/` | **Só a Frente 2 gera migração** (a última é a `0014`). Quem precisar de coluna ou tabela anota em "Pedidos entre frentes". Tabela nova de negócio entra nos gatilhos da auditoria (ver migração `0007`) |
| `src/nucleo/**` | Ninguém muda comportamento; acréscimo pequeno vale, anotado. Exceção: `src/nucleo/ia/config.ts` é da Frente 3 |
| `src/bots.ts`, `src/api-interna.ts` | Só acréscimos (rota ou registro novo), sem reescrever |
| `web/components/Casca.tsx`, `MenuLateral.tsx` | Da Frente 1; a Frente 2 só acrescenta empresa e Sair |
| `package.json` e locks | Pode acrescentar. Na junção, refazer o lock com `npm install` em vez de resolver à mão |
| `.env.exemplo` | Bloco novo no fim, com comentário |
| `README.md`, `docs/arquitetura.md`, `docs/status.md` | Cada frente acrescenta a sua seção; não reescreve a das outras |

## Como abrir a worktree

Exemplo da Frente 1; para as outras, troque o número e o nome do branch.

```bash
# na pasta principal:
git worktree add ../kotala-f1 -b f1-regras-ui main
cp .env ../kotala-f1/.env              # o .env fica fora do git
docker compose exec banco psql -U kotala -c "create database kotala_teste_f1"   # uma vez
cd ../kotala-f1 && npm ci && (cd web && npm ci)
```

No `.env` da worktree, troque só `DATABASE_URL_TESTE` para o banco de teste dela: cada rodada de testes limpa o banco de teste.

Cuidados:

- **Não rode `docker compose up` na worktree**: subiria um segundo banco na mesma porta. O banco da pasta principal serve a todas.
- **Telas:** `cd web && npx next dev -p 3310` (a porta da frente, na tabela). A 3300 é do container `telas`.
- **Bots do Telegram:** um processo por token. Sem Telegram, teste com `npm run simular` e com os testes. Quem precisar dos bots ao vivo (Frente 4; Frente 2 para ligar o contato ao comprador) cria um par de bots de teste no BotFather e põe, no `.env` da worktree, os tokens deles e uma `API_INTERNA_PORTA` própria. Outra saída é parar o container dos bots enquanto testa (`docker compose stop bots`, na pasta principal), avisando as outras frentes.
- **Migrações:** `npm run db:migrar` aplica no banco principal, que é compartilhado. Só a Frente 2 roda.
- **Antes de cada commit:** `npm run checar`, `git add` com caminhos explícitos (nunca `-A`) e conferir que não vai junto nada do `.env`, de arquivos locais fora do git, de valores de chave nem caminhos de pastas de fora do repositório.

## Pedidos entre frentes

Anote aqui o que uma frente precisa que a outra faça (coluna nova, função exportada, bug achado).

Da Frente 4, a partir de [plano-ia.md](plano-ia.md) e dos anexos em `docs/plano-ia/`. O assistente passa a ser generalista: construção é só o nicho de exemplo.

- **Para a Frente 3 (intenção, a decidir por ela; ver "Intenções para a Frente 3" no plano):**
  - casos de regressão para os erros do plano: "clips de papel", "R$ 300 cada" para 5 unidades, proposta em kg ou com marca não exigida, extintor sem kg, foto com marca, botões do mapa depois de "voltar", um mapa por item e rodada;
  - **generalista:** o `CATALOGO` de `src/simulador/personas.ts`, `M3_POR_CARRADA` e "até a obra" viram dados por categoria; fornecedores, itens e personas de comprador de outras áreas (escritório, EPI, limpeza, informática, copa, serviço); regressão com o nicho trocado; testes de CNAE e de unidade; comparação de modelos num conjunto misto;
  - **guardrails:** os 60 casos do comprador e os 9 do fornecedor de `plano-ia/guardrails.md`, com falso positivo e falso negativo por classe; o Assistente usa a mesma triagem (`src/agentes/guardrail/`) e recusa pedido fora do escopo;
  - **negociação e busca automática:** personas que dão desconto só quando pedem, ignoram ou dizem "vou ver"; simulador que baixa o preço na rodada automática (`personas.ts:117`); casos de ampliação (corrida, dedupe, teto, fornecedor antigo na leva 2);
  - personas de fornecedor: unitário ambíguo, proposta em duas mensagens, só aceita Pix, resposta em PDF;
  - métricas de desconto por rodada e de mensagens seguidas sem resposta; juiz de clareza das mensagens ao fornecedor.
- **Para a Frente 3:** combinar a fronteira entre o Assistente e o Interpretador, porque os dois tratam pergunta contra pedido no comprador.
- **Para a Frente 2 (migração):**
  - `pedido.pagamento_preferido`;
  - `item_pedido.ampliacoes integer not null default 0`;
  - urgência `obra_parada` → `parada` (a decidir);
  - papel de gestor, para receber os avisos dos guardrails;
  - opcional: `oferta.aderencia` e `oferta.divergencias`.
- **Para a Frente 1:**
  - **comparador:**
    - o portão de retenção usa referência só de fornecedores físicos, e o preço online vira alerta, não corte;
    - proposta "a confirmar", frete "a calcular no site" e forma de pagamento aceita no mapa;
    - "Mapa atualizado" quando ele for refeito, e só tirar os botões do mapa quando a ação for final;
    - exportar `contarPropostasValidas` sem a verificação de CNPJ;
    - `produtoAnterior` a partir de `oferta.extraido.negociacao`, com "Desconto obtido";
    - ler `oferta.extraido.alertas` dos guardrails;
    - "comprador de obra" no prompt vira "comprador";
  - **regras (`src/config.ts`):** `MAX_AMPLIACOES`, `NEGOCIACAO_ESPERA_FRACAO`, `EMPRESA_NICHO` e a política da empresa; empresa e endereço padrão neutros;
  - **telas:** textos com "obra"; tela de alertas de conduta com o botão de bloquear fornecedor.
- **Núcleo (acréscimo):**
  - `Botao.estilo`, `OpcoesEnvio.formato` e `substitui`, `MensagemEntrada.mensagemRef` e `responder`, `AdaptadorCanal.acao` (ver [telegram-interface.md](plano-ia/telegram-interface.md));
  - "Guardrail" em `AGENTES`.

## Como juntar

Ordem: dashboard (se ainda não entrou) → 2 Perfil e login → 4 IA → 1 Regras e UI → 3 Harness. A Frente 2 vem antes porque traz as migrações e o filtro por comprador; o harness vem por último e roda em cima de tudo junto, como checagem da junção.

1. Cada frente faz commits no seu branch e roda `npm run checar` antes de cada um.
2. Junta a da vez: `git checkout main && git merge --no-ff <branch>`.
3. As seguintes fazem `git rebase main` (ou `git merge main`), resolvem conflitos pela tabela acima, rodam `npm run db:migrar` e `npm run checar`, e só então são juntadas.
4. Antes do push: a mesma conferência do commit, agora sobre tudo o que vai subir.
5. Depois da junção: `docker compose up -d --build` e `git worktree remove ../kotala-fN`.
