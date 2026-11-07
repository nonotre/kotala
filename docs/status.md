# Estado do projeto

Retrato em 07/11/2026, depois das frentes 1, 2 e 3 e da rodada de complementos. Como cada parte funciona: [arquitetura.md](arquitetura.md). Decisões: [decisoes.md](decisoes.md). Pitch: [pitch.md](pitch.md).

**Resumo:** dos 42 módulos do escopo V1, 34 prontos, 2 parciais e 6 não feitos (todos das fases de complemento e "só se sobrar"). Fases 0 a 2, pitch e todos os diferenciais (Raro, Épico e Lendário) completos. 85 testes automáticos passando.

## Módulos

### Fase 0 · Fundação (7 de 7)

| Módulo | Situação |
|---|---|
| N1 Modelo de dados, N2 Adaptador de IA, N3 Orquestrador, N4 Entrada única | Pronto |
| R1 Pedido pelo Telegram | Pronto |
| R5 Cadastro do fornecedor | Pronto: link ou QR, e convite por e-mail com link pessoal |
| R10 Quadro | Pronto: as 4 colunas do site, com etiquetas |

### Fase 1 · Ciclo obrigatório (7 prontos, 1 parcial)

| Módulo | Situação |
|---|---|
| R2 Interpretador, R4 Cotador, R6 Extrator, R8 Comparador, R9 Recomendação, R11 Decisão | Pronto |
| R3 Busca | Pronto: lojas VTEX com frete por CEP, Serper e leitura de páginas, sempre com fonte e hora |
| R7 Frete e prazo | Parcial: vale o frete informado, ou estimado pela mediana dos outros; o frete real por CEP aparece só na referência pública; falta cálculo por distância |

### Fase 2 · Nota da banca (11 prontos, 1 parcial)

| Módulo | Situação |
|---|---|
| Q1 Mapa de cotação | Pronto; faltam os cenários "menor custo / mais rápido / conhecido" ("se sobrar tempo" no escopo) |
| Q2 Três propostas válidas | Parcial: com menos de 3, registra a justificativa e nunca diz "melhor"; não busca mais sozinho (o botão "buscar mais" faz isso) |
| Q3 Fornecedor simulado | Pronto: 6 personas e 12 fornecedores da base da Ester; falta a persona que responde em PDF |
| Q4 Prazo e lembrete, Q7 Robustez, N5 Raciocínio visível, N6 Reprovação com motivo, R12 Avisos | Pronto |
| Q8 Verificação do fornecedor | Pronto: Receita, CEIS e CNEP (arquivos e API do Portal) e TJSP; o TJSP não pôde ser conferido (manutenção em 07 e 08/11) |
| E5 Proposta em PDF e foto, R1b Pedido por áudio | Pronto |
| E6 Base de itens | Pronto, com botões de variação; falta o autocompletar no chat web |

### Pitch (2 de 2)

| Módulo | Situação |
|---|---|
| Q5 Roteiro e QR, Q6 Explicação das escolhas | Pronto: `docs/pitch.md` e tela Convite |

### Fases 3 e 4 · Diferenciais (4 de 4)

| Módulo | Situação |
|---|---|
| X2 Memória (Raro) | Pronto: recompra em menos de 3 meses, histórico, homologação, lista de bloqueio; falta contrato anual com pedido automático |
| X3 Negociação (Raro) | Pronto: até 3 rodadas, sem citar valor de outro fornecedor |
| X4 Economia (Épico) | Pronto |
| X5 Voz (Lendário) | Pronto e testado com microfone: pelo navegador; ligação telefônica de verdade fica de fora (paga) |

### Fases 5 e 6 · Complementos (3 prontos, 6 não feitos)

| Módulo | Situação |
|---|---|
| E3 Chat web, E1 Convite por e-mail, E7 Anexos do comprador | Pronto |
| X1 WhatsApp simulado | Não feito (o de mais efeito na nota entre os que faltam: é um adaptador de canal novo) |
| E9 Primeiro contato ativo simulado | Não feito |
| R1c Pedido pelo quadro | Não feito; o chat web na tela cobre o mesmo uso |
| E2 Resposta do fornecedor por e-mail | Não feito |
| E8 Endereços de entrega e faturamento | Não feito; há só o endereço padrão da empresa |
| E4 Login e várias empresas | Não feito; fora da demo, como o escopo previa |

### Além do escopo

Rastreio completo (estado de qualquer pedido em qualquer instante), API do Portal da Transparência na verificação, cadastro automático de item novo, e as regras das anotações da Ester (setor, dúvida do fornecedor repassada ao comprador, cancelamento com motivo, unidades de agregados).

## Erros conhecidos

Relatados pela Ester ao testar o chat (anotações dela, 07/11/2026). Ainda não corrigidos.

| Erro | Onde olhar | Causa provável |
|---|---|---|
| Fornecedor que se cadastra pelo bot não diz o que vende, e depois não é encontrado nas cotações | `src/fluxo/fornecedor.ts` (cadastro pede só o nome) e `src/agentes/busca/index.ts` (`candidatos`) | O cadastro não pergunta categorias. A busca hoje chama todo fornecedor real com canal; com as categorias, daria para filtrar como já faz com os simulados (`personaVende`) |
| Perguntas repetidas ("Qual é a quantidade de extintores?" e "Quantos unidade de Extintor de incêndio pó químico?") | `src/agentes/interpretador/index.ts`, função `limpar` | Quando a quantidade é 0, o código acrescenta "Quantos … de …?" se nenhuma pergunta da IA contém a descrição exata do item; a pergunta da IA usa outras palavras e as duas aparecem |
| Pouco tempo para o comprador terminar a solicitação (ideal: até 1 hora para responder às perguntas antes de cotar) | `src/fluxo/comprador.ts` (confirmação) | A confirmação não expira hoje; vale conferir com a Ester o que ela viu. Uma regra possível: o pedido espera até 1 hora e só então avisa ou segue |
| Pouco tempo para os fornecedores (ideal: 3 a 4 dias em compras menores, 5 a 7 em maiores) | `src/config.ts` (`PRAZO_RESPOSTAS_SEG`, padrão 120 s) | O prazo curto é de propósito para a demo. Para uso real, o prazo pode depender do valor ou do item, e o lembrete hoje sai na metade do prazo |

## Para quem vai mexer nas telas

- Código em `web/` (Next 16 e Carbon). Telas em `web/app/`, componentes em `web/components/`, leitura do banco em `web/lib/dados.ts`, ações em `web/lib/acoes.ts` (vão para a API interna dos bots).
- Casca (cabeçalho, menu lateral, sino, tema) em `web/components/Casca.tsx`; peças comuns de página em `Pagina.tsx`, `Bloco.tsx` e `Tabela.tsx`. Cada área tem suas consultas e componentes: `lib/dados-pedido.ts` e `components/pedido/`, `lib/dados-operacao.ts` e `components/operacao/` (início, quadro, lista, avisos), `lib/dados-consulta.ts` e `components/consulta/` (fornecedores, itens, convite, voz), `components/chat/` e `components/conta/` (demonstração). Avisos do sino em `lib/avisos.ts`, tirados do estado dos pedidos.
- Rodar com recarga automática: `npm run telas:dev` (porta 3300; pare o container `telas` antes, porque usa a mesma porta). Conferir tipos: `npm run telas:tipos`.
- Depois de mudar: `docker compose up -d --build telas`.
- A tela fala a língua do comprador de obra: "assistente" (nunca "bot"), sem siglas de módulo, fornecedor simulado sempre com a marca "simulado", aprovação sempre em dois toques.
- Testes de integração (`npm run checar`) limpam o banco de teste: não rode ao mesmo tempo que uma simulação (`npm run simular`) no mesmo banco.
