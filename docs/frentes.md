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

## Estado da Frente 4 para a junção

Branch `f4-ia-conversa`, a partir de `368d7fc`. Plano e desenhos: [plano-ia.md](plano-ia.md) e `docs/plano-ia/`. Sem migração e sem dependência nova.

### O que entrou

| Item | O quê | Onde |
|---|---|---|
| S | Guardrails do comprador: 8 classes (pedido, ambíguo, controlado, proibido, fora do escopo, consulta, injeção, ofensa), lista dura, controlados tirados do pedido, condição "sem nota" tirada, dado pessoal mascarado, insistência em 24 h, aviso ao gestor, botão "Era uma compra da empresa"; barreira antes da busca e antes de enviar ao fornecedor | `src/agentes/guardrail/`, `interpretador/`, `fluxo/comprador.ts`, `busca/index.ts`, `cotador/index.ts` |
| S | Lado do fornecedor: alertas (sem nota, item irregular, propina, combinação de preço, pagamento por fora, pede dados, controlado, link suspeito) em `oferta.extraido.alertas` | `extrator/`, `fluxo/fornecedor.ts` |
| G, Q3 | Generalista: Interpretador para "compras de uma empresa", interpreta antes de abrir o pedido (sem pedido cancelado por pergunta), "Quer que eu cote X?"; categorias, unidades, jargão, CNAE e lojas como dados | `src/dominio/`, `interpretador/`, `busca/`, `verificacao/confianca.ts` |
| Q1 | Preço unitário ou total: `leituraPreco`, conferência de coerência, pergunta ao fornecedor quando ambíguo | `extrator/`, `fluxo/fornecedor.ts` |
| Q2 | Aderência técnica (`exato`, `equivalente`, `diferente`, `a_confirmar`) e `divergencias`; sem exigência de marca, o equivalente é aceito por padrão | `extrator/`, `fluxo/comprador.ts` |
| Q4 | Atributos obrigatórios por categoria perguntados antes da confirmação, com botões quando há opções | `src/dominio/`, `fluxo/comprador.ts` |
| Q5 | Pedido com marca vista na foto pergunta "só a marca X ou aceita similar?" | `interpretador/anexos.ts`, `fluxo/comprador.ts` |
| Q9, U6 | Telegram: teclado do mapa mantido nas ações não finais, edição da mensagem clicada, aviso em botão velho, texto acima de 4096 dividido, HTML opcional com escape, "digitando...", botões coloridos, documentos, `/start` e `/ajuda`; e-mail com botões em texto e anexos | `canais/`, `texto.ts`, `fluxo/componentes/`, `nucleo/mensagens/` (só acréscimos) |
| U1.1 | Pagamento combinado no pedido de compra | `fluxo/decisao.ts` |
| U4 | Cotação ao fornecedor organizada em HTML, com checklist do que responder | `cotador/index.ts` |
| I3 | Busca mais fornecedores sozinha no fim do prazo, ou quando todos responderam antes, com menos de 3 propostas válidas (até 2 levas, urgente 1), na mesma rodada; corrige lembrete repetido e reenvio de cotação parada | `cotador/index.ts`, `busca/index.ts` |
| I4 | Releitura com o modelo forte quando a leitura é sensível ou duvidosa | `interpretador/`, `extrator/` |
| I1 | Negociação automática em toda cotação: pedido de desconto dentro da mensagem "Recebi sua proposta" (inclusive para a mais barata), janela de 25% do prazo, uma rodada automática por fornecedor e item, desconto calculado em código, antes e depois em `oferta.extraido.negociacao`, validador de texto; o botão do comprador passa a incluir a mais barata | `negociador/`, `fluxo/fornecedor.ts`, `cotador/index.ts` |
| U3 | Uma pergunta por vez ao fornecedor: fila calculada (sem tabela nova), perguntas juntadas em até 3; encerramento, pedido de compra e lembrete passam direto | `cotador/cadencia.ts` |
| U5 | Categoria perguntada uma vez a fornecedor real sem categorias, depois da primeira resposta | `fluxo/fornecedor.ts` |

### Para quem junta

- **`.env`:** variáveis novas `GESTOR_CONTATO_ID` (contato que recebe os avisos de conduta; vazio desliga), `GUARDRAIL_MODO_DEMO=1` (desliga o aviso ao gestor nos testes do time) e `EMPRESA_NICHO` (só exemplos; padrão `geral`). Para os 15 min da Ester: `PRAZO_RESPOSTAS_SEG=900`.
- **`src/dados/` é ignorado pelo git** (regra `dados/` do `.gitignore`). Worktree nova precisa copiar `itens.json` e `fornecedores-simulados.json` da pasta principal, senão os testes falham. As categorias do cadastro agora vêm de `src/dominio/categorias.json`, que é versionado.
- **Comportamento novo que muda a demo:**
  - pergunta e conversa não abrem mais pedido;
  - "aceita similar" passa a ser o padrão quando o comprador não exige marca, então o rótulo "(aceita similar)" aparece em quase todo item;
  - a cotação ao fornecedor vai em HTML;
  - a cotação pode ser prorrogada pela busca automática;
  - a cotação não fecha mais no instante em que o último responde: espera a janela do pedido de desconto (na demo de 15 min, até uns 4 min).
- **Nomes que mudaram:** `TEXTO_BOAS_VINDAS` virou `textoBoasVindas()`; `ehPedido` é calculado em código a partir da classe; `ATIVIDADE_DA_AREA` saiu de `confianca.ts`; `limpar` e `extrair` do Extrator ganharam parâmetros opcionais.
- **Conflitos prováveis:** `src/agentes/cotador/index.ts`, `src/fluxo/comprador.ts` e `src/fluxo/fornecedor.ts` mudaram bastante. `scripts/testar-seguranca.ts` ainda chama `interpretar` sem `posRegras` (funciona, mas não testa as pós-regras).

### O que a Frente 4 não fez (fica para outras frentes ou para depois)

**Frente 1 (comparador e regras):**
- Ler `oferta.extraido`:
  - `alertas` (não ranquear sem nota ou item irregular; mostrar propina e pagamento por fora);
  - `divergencias`;
  - `aConfirmar` (hoje a proposta com preço ambíguo aparece como "Sem preço" no mapa).
- Mostrar a negociação no mapa a partir de `oferta.extraido.negociacao` (tipos e o leitor `marcaDe` em `src/agentes/negociador/index.ts`):
  - `produtoAnterior` da proposta mais antiga do fornecedor (o `antes` da marca);
  - "Desconto obtido: R$ X (de A para B)", "Pedi desconto: manteve", "não respondeu";
  - `subiu` e `condicional` em "Atenção".
- A confirmação de preço abaixo da referência deveria passar pela cadência (`pedirAoFornecedor` em `cotador/cadencia.ts`).
- Contar a busca automática no mapa ("consultei mais N em K levas"). Hoje o número de levas está nos eventos do Cotador, com `dados.tipo = "ampliacao"` e `dados.rodada`.
- Exportar `contarPropostasValidas` sem a verificação de CNPJ (o Cotador duplica a montagem das ofertas).
- Q7: referência de preço só de fornecedores físicos; preço online vira alerta, não corte.
- Frete "a calcular no site"; forma de pagamento aceita no mapa; "Mapa atualizado" quando refeito; PDF do mapa (o Telegram e o e-mail já enviam anexos); "comprador de obra" no prompt do comparador.
- Regras em `src/config.ts`: `MAX_AMPLIACOES` (hoje constante no cotador), `NEGOCIACAO_ESPERA_FRACAO`, `NEGOCIACAO_RESTANTE_MIN` e `PRAZO_PAGAMENTO_PADRAO` (hoje no negociador), `ESPERA_PERGUNTA_FRACAO` (hoje em `cadencia.ts`), `EMPRESA_NICHO`, política da empresa (bebida, tabaco, uso pessoal, serviços), empresa e endereço padrão neutros.
- Telas: textos com "obra"; tela de alertas de conduta com o botão de bloquear o fornecedor.

**Frente 2 (migrações e contas):**
- Migrações: `pedido.pagamento_preferido` (U1 completo); `item_pedido.ampliacoes` (substitui a contagem por eventos); urgência `obra_parada` → `parada` (a decidir); opcional `oferta.aderencia` e `oferta.divergencias`.
- Papel de gestor para receber os avisos (hoje é a variável `GESTOR_CONTATO_ID`).
- Mascarar CPF e cartão na tabela `mensagem`, que guarda o texto bruto.

**Frente 3 (harness):** ver a lista em "Pedidos entre frentes". As mais urgentes:
- o simulador (`src/simulador/personas.ts`) só conhece preços de obra;
- o simulador não baixa o preço quando recebe o pedido automático de desconto (mensagem `tipo: "negociacao"` na mesma rodada) e reenvia o mesmo preço, que vira "manteve";
- faltam as personas que dão desconto só quando pedem, em percentual ou condicionado.

**Frente 4, depois:**
- U1 completo (preferência de pagamento do comprador), que depende da migração.
- Q6 (dois mapas seguidos): sem reprodução; falta o número do pedido com a Ester.
- Q8: frete das lojas fora da VTEX.
- I2 (negociador que redige com IA), I5 (memória na conversa).
- U6 de prioridade média: pedir o motivo num campo de resposta, reação de "recebi", menu.
- Usar `substitui` nos fluxos para editar o mapa em vez de mandar outra mensagem.
- Lojas VTEX de outras categorias (testar a API pública antes).
- Serviços: hoje viram "Ainda cotamos só produtos".
- Retentar o envio quando a busca automática falha depois de prorrogar.
- Conferência de saída no convite ao fornecedor.
- Resposta ao pedido de desconto que chega depois do fechamento ainda recebe "A cotação já foi encerrada".
- Campo próprio do Extrator para desconto condicionado (hoje é detectado por regex).
- Não testado com a IA real de ponta a ponta nem com os bots no ar: só testes automáticos e uma sonda do Interpretador.

**Dono, Ester e jurídico:**
- Escolhas feitas na implementação, a confirmar: não pedir desconto quando a mensagem do fornecedor tem alerta (comissão, sem nota); qualquer resposta sem preço com desconto aberto ("ok", "obrigado") vira "manteve"; lojas online contam para chegar a 3 propostas.
- Os "10 minutos" do solicitante.
- A Ester aceitar que a cotação espere a janela do desconto.
- Validar a lista de produtos controlados (`docs/plano-ia/guardrails.md`).

## Como juntar

Ordem: dashboard (se ainda não entrou) → 2 Perfil e login → 4 IA → 1 Regras e UI → 3 Harness. A Frente 2 vem antes porque traz as migrações e o filtro por comprador; o harness vem por último e roda em cima de tudo junto, como checagem da junção.

1. Cada frente faz commits no seu branch e roda `npm run checar` antes de cada um.
2. Junta a da vez: `git checkout main && git merge --no-ff <branch>`.
3. As seguintes fazem `git rebase main` (ou `git merge main`), resolvem conflitos pela tabela acima, rodam `npm run db:migrar` e `npm run checar`, e só então são juntadas.
4. Antes do push: a mesma conferência do commit, agora sobre tudo o que vai subir.
5. Depois da junção: `docker compose up -d --build` e `git worktree remove ../kotala-fN`.
