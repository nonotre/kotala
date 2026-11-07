# kotala

Agentes de IA para cotação de compras de material de obra.

## Rodar

Requer Node 26 ou maior e Docker.

```bash
npm ci
cp .env.exemplo .env            # troque a senha e preencha as chaves
npm run db:subir                # Postgres com pgvector, em 127.0.0.1:5433
npm run db:migrar
npm run checar                  # tipos + testes
npm run ia:testar               # chamada real ao Gemini
```

### Bots do Telegram

Crie o bot no @BotFather e ponha o token em `TELEGRAM_TOKEN_COMPRADOR` no `.env`.

```bash
npm run bots                    # na máquina
docker compose up -d --build    # ou tudo em container: banco + bots (aplica as migrações ao subir)
docker compose logs -f bots
```

Rode só um dos dois: o mesmo token em dois processos dá erro 409 no Telegram.

Sem Telegram, dá para conversar como comprador pelo terminal, com a IA real:
`npm run simular -- "40 cp2 e 2 carrada de areia pra obra alfa até sexta" "botao:confirmar"`.

Para os testes de integração, crie o banco de teste uma vez:
`docker compose exec banco psql -U kotala -c "create database kotala_teste"`.

## Núcleo (`src/nucleo/`)

| Módulo | Pasta | O que faz |
|---|---|---|
| N1 Modelo de dados | `db/` | Schema Drizzle: pedido com N itens, fornecedor, contato por canal, cotação, oferta, mensagem, evento, uso de IA e histórico. Mudou o schema? `npm run db:gerar` e `npm run db:migrar`. |
| N2 Adaptador de IA | `ia/` | `gerarTexto` e `gerarObjeto` (zod) por papel (`rapido`, `forte`). Tenta os modelos da chave principal (`GEMINI_API_KEY`) e depois os da reserva (`GEMINI_API_KEY_RESERVA`). 429 e 5xx trocam de modelo; chave inválida pula a rota; alvo que falhou descansa um tempo. |
| N3 Orquestrador | `orquestrador/` | Tabela de transições em `estados.ts`. `avancarPedido` e `avancarItem` fazem UPDATE atômico e registram o evento na mesma transação. Agentes se ligam com `aoEntrarItem(estado, fn)` e rodam depois do commit. Cota um item por vez: o próximo começa quando o atual chega ao mapa pronto. `iniciarVarredor()` encerra cotações com prazo vencido. |
| N4 Entrada única | `mensagens/` | Canal converte o que recebe em `MensagemEntrada` e chama `receber()`; toda saída passa por `enviar()`, que bloqueia quem respondeu PARAR, em qualquer canal. Canais se ligam com `registrarCanal()`. |
| N5 Registro | `registro.ts` | `registrar()` grava o que cada agente fez e por quê. |

## Agentes e canais

| Módulo | Onde | O que faz |
|---|---|---|
| R1 Pedido pelo Telegram | `src/canais/telegram.ts`, `src/bots.ts` | grammY por long polling, um bot por papel (comprador e, depois, fornecedor), uma mensagem por vez em cada conversa. |
| R2 Interpretador | `src/agentes/interpretador/` | Lê o pedido solto, entende o jargão, separa os itens e devolve destino, prazo em dias, urgência, suposições e o que falta. |
| Conversa do comprador | `src/fluxo/comprador.ts` | "Entendi assim, confirma?" com botões, no máximo uma rodada de perguntas, correção por texto, confirmação e cancelamento. |

Quadro: as 4 colunas vêm de `colunaDoItem()`. Diagrama para o pitch: `diagramaMermaid()`.
