# Kotala generalista: o que prende o sistema a construção

Anexo de [plano-ia.md](../plano-ia.md), de 08/11/2026. Os `arquivo:linha` são do `main` em `fc313f2`.

## 1. Resumo

- Sete prompts de agentes dizem "material de construção" (Interpretador, Extrator, Busca/entende, anexos, Comparador "comprador de obra", boas-vindas e convite do fornecedor). Troca por texto neutro, mais um bloco de contexto vindo de configuração.
- O pior acoplamento é o código, não o texto: regra de agregados com regex em `interpretador/index.ts:112-115`, conversão de preço por m³/carrada em `busca/filtro.ts:74-84`, e `ATIVIDADE_DA_AREA` (CNAE de construção) em `verificacao/confianca.ts:43,74,78`. Isso muda o resultado em compras de outras áreas (um fornecedor de papelaria perde 10 pontos).
- A busca online só tem duas lojas VTEX fixas, Telhanorte e Obramax (`busca/vtex.ts:8-11`, usadas em `internet.ts:107,183`). Fora de construção elas não acham nada, e sobra o Google Shopping.
- O jargão (`jargao.ts`) é 100% de obra e entra inteiro no prompt. Vira dados por categoria, injetados só quando a categoria bate.
- Os dados (`itens.json` com 36 itens e `fornecedores-simulados.json` com 12 fornecedores) têm só categorias de obra, e as categorias do cadastro de fornecedor saem dessa base. Precisam de itens de escritório, EPI, limpeza, TI, alimentos e serviços.
- A urgência `obra_parada` está no enum do banco, no zod, no Comparador e em 6 telas. Renomear para `parada` (ou aceitar o alias) exige migração (Frente 2).
- Textos de tela com "obra" são cerca de 15, quase todos da Frente 1 (Obra Alfa, "Entrega na obra", "Diga como a obra é chamada").
- Desenho proposto: `src/dominio/` com perfil por categoria como dados e `EMPRESA_NICHO` só para exemplos e padrões. Detalhes na seção 3.

## 2. Achados por frente

Legenda: F1 = Frente 1, F2 = Frente 2, F3 = Frente 3, F4 = Frente 4. As linhas são do `main` atual.

### Frente 4 (agentes, fluxo, Telegram/e-mail, texto)

| Arquivo:linha | O que prende | Proposta |
|---|---|---|
| `src/agentes/interpretador/index.ts:40` | Prompt: "assistente de compras de material de construção" | "assistente de compras de empresas". Acrescentar o bloco `contextoEmpresa()` (nicho, só para desambiguar). |
| `index.ts:53` | `urgencia: "obra_parada"` ("se disser obra parada") | "parada: a falta do item para a operação (obra, linha, loja, escritório)". Enum de 3 valores igual para todos. Ver nota de migração na linha de `schema.ts:41` (F2). |
| `index.ts:58` | Regra de agregados no prompt (m³, t, kg, saco, L; carrada) | Sair do prompt. Vira regra de unidade da categoria (seção 3.2), injetada só quando o item é dessa categoria. |
| `index.ts:62` + `jargao.ts:1-25` | Prompt injeta `textoJargao()` inteiro: cimento, ferro, carrada, milheiro, tubo | Arquivo vira dados por categoria. O Interpretador faz primeiro uma classificação leve do item e injeta só o jargão da categoria e o genérico. Alternativa barata: injetar tudo, com um limite de tamanho. |
| `index.ts:12` | Descrição do campo unidade: "saco, barra, m³, carrada, milheiro, unidade..." | "unidade de compra como o comprador disse (caixa, resma, par, kg, hora, mês, unidade...)". |
| `index.ts:10` | Exemplo "Cimento CP II 50 kg" | Exemplo neutro ("Papel A4 75 g/m², resma 500 folhas") ou tirado do nicho configurado. |
| `index.ts:25` | "Dias e horários em que a obra recebe" | "em que o local recebe". |
| `index.ts:22` | `destino`: "Obra ou endereço de entrega" | "Local ou endereço de entrega". |
| `index.ts:29` | Setor: exemplos "estrutura, elétrica, manutenção, escritório" | Já é quase genérico. Trocar por exemplos do nicho. |
| `index.ts:112-115` | Regex de agregados (`areia\|brita\|pedra...`) e whitelist de unidade, que gera a pergunta "quantos m³ (ou toneladas)?" | Mover para `regrasUnidade` do perfil da categoria: `{ detectar: regex | categoria, unidadesAceitas, pergunta }`. O código só aplica a regra, sem saber o que é areia. Sem categoria que bata, não pergunta nada. |
| `index.ts:148` | Regex de feminino ("sacas\|barras\|caixas\|latas\|placas\|telhas\|peças") | Lista maior ou cobertura por sufixo ("-a" no plural). Menor, mas afeta o português de serviços ("horas", "diárias", "licenças"). |
| `interpretador/base-itens.ts:3,35-47` | `SINONIMOS` de obra (vergalhão, ferro, cano/tubo, brita/pedra, cimentcola) e `VAZIAS` com "portland", "lavada" | Sinônimos e palavras vazias por categoria, nos dados. Ficam só os neutros (kg, mm, de, para). |
| `interpretador/anexos.ts:33,38` | Prompt de anexos: "material de construção"; jargão ("cp2", "carrada", "ferro 3/8") | Texto neutro. Exemplos de jargão do nicho. |
| `interpretador/catalogo.ts` | Não inspecionado a fundo. Cadastra itens novos em `item_catalogo`, o que já serve ao caso generalista | Conferir se o prompt de cadastro cita construção. |
| `busca/entende.ts:2,40-43` | Prompt: "lojas online brasileiras de material de construção"; exemplos cimento e rejunte/argamassa | "lojas online brasileiras" mais exemplos mistos (ex.: "papel a4 75g 500 folhas"; proibidas de "cartucho de tinta" para "papel"). |
| `busca/entende.ts:12` | `conteudoKg` (só peso). Sem outras medidas | Generalizar para `conteudoPorEmbalagem: { valor, unidade: kg\|L\|un\|m\|folhas }`. Afeta `filtro.ts`. |
| `busca/filtro.ts:7` | Comentário de "Proibidas": exemplo rejunte/areia | Só comentário. |
| `busca/filtro.ts:46-48,74-84` | `kgNoTitulo` (só kg), `UNIDADE_VOLUME` (m3/carrada/caçamba), corte "carrada não tem volume fixo". Em outra área o corte nunca age, e conversões de L, m, resma, caixa não existem | Tabela de unidades convertíveis (kg, g, L, mL, m, un, caixa com N) em `dominio/unidades.ts`. `carrada` e m³ ficam como regra da categoria Agregados. |
| `busca/filtro.ts:69` | `tamanhoDoKit` com "sacos" na regex | Incluir "resma\|caixa\|pares\|rolos\|latas" ou usar a unidade do pedido. |
| `busca/vtex.ts:8-11` + `internet.ts:107,183` | `LOJAS_VTEX` fixo: Telhanorte e Obramax | `LOJAS_POR_CATEGORIA` (dados) com `{ nome, dominio, categorias: [...] \| "*" }`. Sem loja que bata, vai só Serper/Google Shopping. Lojas candidatas (a validar, `catalog_system` precisa estar aberta): papelaria, informática e EPI com VTEX. Ver 3.4. |
| `busca/internet.ts:19` | `NAO_LER` exclui leroymerlin (mercado de obra) além dos marketplaces | Ficar com os marketplaces. Leroy não precisa de exclusão especial: foi excluída por não ser lida bem. Conferir o motivo. |
| `busca/internet.ts` (consulta `${consulta} preço`) | Não cita construção | OK. |
| `extrator/index.ts:48` | Prompt: "material de construção" | Texto neutro. O resto das regras (frete, CIF, FOB, equivalente) já vale para qualquer compra. |
| `extrator/index.ts` (regras) | "Valores em reais", item equivalente por especificação | Para serviços, falta o conceito de proposta por hora, mensal ou escopo (`totalProduto` sem quantidade). Ver 3.5. |
| `cotador/index.ts:52,65,192,315,346` | Usa `quantidade()` e `unidade` do item | Sem texto de construção. Só depende de `texto.ts` (linha seguinte). |
| `negociador/index.ts:77` | "por ${item.unidade}" | OK. |
| `memoria/index.ts:31` | Exemplo no comentário (cimento) | Só comentário. Chave de item usa palavras do nome, sem dependência de domínio. |
| `fluxo/comprador.ts:28-31` (`TEXTO_BOAS_VINDAS`) | Exemplo "40 sacos de cp2 e 2 carradas de areia média para a Obra Alfa" | `exemploDeTexto()` vindo de `EMPRESA_NICHO` (padrão neutro: "50 resmas de papel A4 e 20 pares de luva para o escritório até sexta"). |
| `fluxo/comprador.ts:70,93` | Tipo `urgencia` com `obra_parada` e a linha "Obra parada: o prazo pesa mais que o preço." | "Parada: o prazo pesa mais que o preço." |
| `fluxo/decisao.ts:313` | `d.pedido.destino ?? "da obra"` | "do local de entrega". |
| `fluxo/decisao.ts:251,334,355` | "confirmou o fornecimento" | Para serviço funciona. Sem mudança. |
| `fluxo/fornecedor.ts:32` | Boas-vindas do fornecedor: "cotações de material de construção" | "cotações de compras da empresa X". Usar o nicho como complemento, se houver. |
| `fluxo/fornecedor.ts:144,215` | Exemplos de categoria: "hidráulica, elétrico, cimento, areia, tintas" | Exemplos tirados das categorias cadastradas (3 primeiras ou as mais usadas). Lê de `categoriasConhecidas()`. |
| `fluxo/fornecedor.ts:155-170` | Categorias vêm de `baseDeItens()` (itens.json). Sem item de uma categoria, o fornecedor não consegue se cadastrar nela | Lista própria de categorias (`dominio/categorias.json`) independente dos itens. `categoriasDoTexto` usa o nome da categoria e sinônimos da própria categoria. |
| `fluxo/fornecedor.ts:281` | Convite do fornecedor: "pedidos de cotação de material de construção" | Neutro, com o nicho como exemplo. |
| `texto.ts:5,15` | Comentários de plural com saco, m³ | Só comentário. Conferir se o plural (`quantidade()`) trata "resma", "par", "hora", "diária", "licença". |
| `agentes/verificacao/confianca.ts:43,74,78` (`ATIVIDADE_DA_AREA`) | Regex de CNAE de construção. Fornecedor de outra atividade perde 10 pontos e gera o alerta "fora de materiais de construção" | Regex por categoria do pedido (palavras de CNAE esperadas por categoria, em dados). Mensagem: "Atividade compatível com <categoria>". Sem regra da categoria, o ponto não conta, sem punir. É o achado de maior impacto de resultado. Dono: F4 (`src/agentes/`). |
| `agentes/voz/index.ts` | Sem menção a construção | OK. |
| `nucleo/mensagens/parar.ts:17` | Comentário "Não pare a obra" | Só comentário. |
| `nucleo/orquestrador`, `nucleo/ia/reserva.ts` | Falsos positivos do grep ("constructor") | Nada. |

### Frente 1 (web/app, web/components, web/lib, comparador, regras em config)

| Arquivo:linha | O que prende | Proposta |
|---|---|---|
| `src/agentes/comparador/index.ts:155,175` | Texto "obra parada, prazo pesa o dobro" e prompt "comprador de obra" | "parada" e "comprador". Alias do enum (ver `schema.ts`). |
| `src/agentes/comparador/calculo.ts:65` | Tipo `urgencia` com `obra_parada` | Segue o enum. Os pesos (preço, prazo, frete) já são configuráveis e valem para qualquer área. |
| `src/config.ts:10,15` | `EMPRESA` padrão "Construtora Exemplo Ltda." e "Obra Alfa, Rua de Exemplo..." | Padrões neutros ("Empresa Exemplo Ltda.", "Matriz, Rua de Exemplo, 100"). Novo `EMPRESA_NICHO`. |
| `src/config.ts` (resto) | Pesos, prazos, limite 5000 | Sem acoplamento. `LIMITE_COMPRA_MAIOR` pode virar por categoria (serviço contínuo e material têm escalas diferentes). Opcional. |
| `web/app/layout.tsx:13` | Meta description "material de obra" | "Assistente de cotação de compras". |
| `web/components/conta/Entrar.tsx:132` | "Da mensagem da obra à compra aprovada." | "Do pedido à compra aprovada." |
| `web/components/operacao/Inicio.tsx:210,226,234,316` | "Entrega na obra", campo "Obra", "separou itens, quantidades, obra e prazo", "o que a obra precisa" | "Entrega no local", "Destino", "destino e prazo", "o que a empresa precisa". |
| `web/components/operacao/Situacao.tsx:51,56,59,62` | Rótulo "Obra parada", classe CSS `obraParada` | "Parada" (rótulo e classe `parada`). |
| `web/components/pedido/CabecalhoPedido.tsx:14,27` | "Obra parada", "Entrega: Obra Alfa" no comentário | Rótulo neutro. |
| `web/components/operacao/CentralAvisos.tsx:174`, `web/lib/avisos.ts:55`, `web/lib/dados.ts:55`, `web/lib/dados-operacao.ts:16`, `web/app/page.tsx:13` | `obra_parada` e "Obra parada" na etiqueta | Seguem o enum. O texto exibido passa a "Parada". |
| `web/components/operacao/ListaPedidos.tsx:81`, `web/components/pedido/textos.ts:97`, `web/components/consulta/PaginaVoz.tsx:18` | Comentários com cimento/obra | Só comentários. |
| `web/components/consulta/BaseItens.tsx` | Usa categorias da base, listada pelo grep | Sem texto fixo. Funciona com novas categorias. Filtro por categoria deve crescer sem layout fixo. |
| `web/components/Ligacao.tsx:14` | Falso positivo (`constructor`) | Nada. |

### Frente 2 (login, chat, canal web, migrações)

| Arquivo:linha | O que prende | Proposta |
|---|---|---|
| `src/nucleo/db/schema.ts:41` | `urgenciaEnum` com `obra_parada`. Também aparece nos comentários `:175,177` (cimento) | Migração: `ALTER TYPE urgencia RENAME VALUE 'obra_parada' TO 'parada'`, junto com a troca do enum em `interpretador`, `comprador.ts`, `comparador`, `web/lib`. Se a troca atrasar, manter o valor interno `obra_parada` e mudar só o rótulo (decisão do dono). |
| `web/components/conta/demo.ts:38-43,51,56,62,72` | Conta de exemplo: "Construtora Exemplo", "@construtora.exemplo", "Engenharia", endereços "Obra Alfa/Beta" | Dados de exemplo neutros ("Empresa Exemplo", "Sede", "Filial Centro") e papéis genéricos. Pode ficar construção se a demo for o nicho, mas o padrão deve ser neutro. Dono: F2 (`web/components/conta/`). |
| `web/components/conta/Empresas.tsx:80,113,144` | Placeholder "@construtora.exemplo"; função `obrasDe`; lista de obras da empresa | "Endereços de entrega" e "@empresa.exemplo". |
| `web/components/conta/Enderecos.tsx:24,78` | Erro "Diga como a obra é chamada.", placeholder "Obra Delta" | "Diga como o local é chamado." e "Filial Centro". |
| `web/components/chat/textos-pt-br.ts:39` | Placeholder "Ex.: 40 sacos de cimento cp2 até quinta" | Exemplo vindo do nicho (via API interna ou prop). |
| `web/components/chat/Conversa.tsx:68` | `EXEMPLOS`: cimento, ferro 3/8, carrada de areia e milheiro de tijolo | Lista de exemplos por nicho (mesmo `exemploDeTexto`), com 3 amostras mistas no padrão. |
| `src/canais/web.ts` | Sem acoplamento no grep | OK. Pode servir os exemplos do nicho à tela. |

### Sem dono claro

| Arquivo | O que prende | Proposta |
|---|---|---|
| `src/dados/itens.json` | 36 itens, 11 categorias, todas de obra, mais EPI e Isolamento. Origem: Ester. Formato `{ id, descricao, especificacao_tecnica, unidade_compra, categoria }` | A base é "catálogo de itens conhecidos", não precisa ser exaustiva. Acrescentar itens de escritório, limpeza, TI, alimentos e serviços (ver F3). Criar o campo opcional `nicho`. Dono sugerido: F3 (dados de teste e demo), com F4 consumindo. A Ester é a autora da origem (`docs/workspaces/ester-workspace/itens.json`). |
| `src/dados/fornecedores-simulados.json` | 12 fornecedores, categorias de obra. Usado por `src/simulador/personas.ts:60` | Ver F3. |
| `scripts/mock-dashboard.ts` | 12 ocorrências, preços e itens de obra ("faltam itens da base") | Dono: dashboard. Gera dados fictícios, aceitável como está. Apontar que o mock continua de obra, para a demo do dashboard. |
| `README.md`, `docs/pitch.md`, `docs/decisoes.md`, `docs/arquitetura.md`, `docs/status.md`, `docs/plano-ia.md`, `docs/plano-ia/telegram-interface.md`, `docs/frente-3-harness.md` | Descrevem o produto como "material de construção" | Registrar a decisão generalista em `docs/decisoes.md` e ajustar o pitch (nicho como exemplo). `docs/workspaces/*` são das usuárias, não mexer. |

## 3. Desenho proposto

### 3.1 Princípio

Nada de domínio no código ou no prompt base. O que é de uma área vira dado, carregado por categoria, e só entra no prompt quando o item é dessa categoria. O nicho da empresa só escolhe exemplos e padrões; nunca restringe o que o comprador pode pedir.

### 3.2 Perfil por categoria (dados)

Pasta `src/dominio/` (dono proposto: F4, que é quem consome; os dados de teste ficam com F3):

- `categorias.json`, uma entrada por categoria:
  ```json
  { "id": "agregados", "nome": "Agregados", "sinonimos": ["areia", "brita", "pedrisco"],
    "palavras": ["areia", "brita", "pedra", "pedrisco", "cascalho", "po de pedra"],
    "unidadesAceitas": ["m³", "t", "kg", "saco", "L"],
    "perguntaUnidade": "quantos m³ (ou toneladas)?",
    "atributos": ["granulometria", "origem"],
    "jargao": [ { "termo": "carrada, caçamba", "significa": "..." } ],
    "sinonimosBusca": { "brita": ["pedra"] },
    "cnae": ["extra[cç][aã]o de areia", "constru"],
    "lojas": ["telhanorte", "obramax"] }
  ```
- Categorias iniciais: escritório/papelaria, EPI, limpeza, informática, alimentos/copa, manutenção (serviço), mais as de obra que já existem.
- Categoria `geral` (sempre injetada): unidades genéricas, jargão de compras ("CIF", "FOB", "resma", "milheiro").
- O jargão de `jargao.ts` migra para `categorias.json`. `textoJargao(categorias)` recebe as categorias detectadas.
- Como detectar a categoria do item: (a) palavras das categorias (barato, sem IA); (b) se falhar, o Interpretador devolve `categoria` no schema, já com a lista de categorias no prompt (nomes só, baratos). Item sem categoria cai em `geral`.
- Esse arquivo também alimenta: `base-itens.ts` (sinônimos e palavras vazias), `fornecedor.ts` (lista de categorias do cadastro), `confianca.ts` (CNAE esperado) e `busca` (lojas).

### 3.3 Nicho da empresa como configuração

- `EMPRESA_NICHO` (id de uma categoria ou conjunto, ex. `construcao`, `escritorio`, `geral`, padrão `geral`) em `src/config.ts`. Dono do arquivo: F1; é só acrescentar uma linha e anotar em "Pedidos entre frentes".
- Usos permitidos: exemplos do chat, do Telegram e do convite; categorias sugeridas primeiro no cadastro; endereço padrão ("Obra Alfa" vs "Sede"); `contextoEmpresa()` no prompt do Interpretador como desempate ("a empresa compra principalmente X; é só um desempate, não limite o que pode ser pedido").
- Usos proibidos: filtrar itens, recusar pedido, escolher lojas exclusivamente.
- Função única `exemplosDoNicho()` em `src/dominio/`, usada por `fluxo/comprador.ts`, `fluxo/fornecedor.ts` e exposta para a web (`web/components/chat`).

### 3.4 Busca sem lojas fixas

- `LOJAS_VTEX` vira `LOJAS_POR_CATEGORIA` em dados. Cada loja declara `categorias` (ou `"*"`). `internet.ts:107` filtra por categoria do item.
- Sem loja que bata, a busca usa só Serper/Google Shopping e leitura de página. `internet.ts:183` continua excluindo as lojas VTEX da leitura genérica.
- Pesquisa de lojas VTEX para escritório, informática, EPI e limpeza: tarefa de pesquisa, com teste de `catalog_system/pub/products/search` aberto. Não decidir sem testar.
- Prompt de `entende.ts` neutro; o exemplo de "proibidas" vem da categoria (`proibidas` padrão em `categorias.json`, opcional).

### 3.5 Unidades e serviços

- `dominio/unidades.ts`: unidades de compra comuns (un, par, caixa, resma, pacote, kg, g, L, mL, m, m², m³, t, saco, barra, rolo, lata, hora, diária, mês). Conversão só para os pares seguros (kg-g, L-mL, N por caixa).
- `conteudoKg` vira `conteudoPorEmbalagem` com unidade (ver `entende.ts:12` e `filtro.ts:46`).
- Serviços (manutenção, limpeza contratada): o item tem unidade "hora", "diária", "mês" ou "visita", quantidade pode ser 1, e `itemExato` perde sentido. Extrator: aceitar `totalProduto` sem quantidade. Comparador: comparar por total do escopo e não por preço unitário. Decisão de produto para o dono, antes do código.
- Urgência: enum `normal | urgente | parada`; alias de leitura para `obra_parada` por um ciclo.

### 3.6 Ordem sugerida

1. Texto neutro nos prompts e nas telas (barato, sem risco, F4 e F1).
2. `EMPRESA_NICHO` e exemplos (F1 + F4).
3. `categorias.json` com jargão e regras de unidade, trocando as regex (F4).
4. `ATIVIDADE_DA_AREA` por categoria (F4).
5. Lojas por categoria (F4).
6. Urgência `parada` com migração (F2, depois F1 e F4).
7. Serviços: decisão do dono primeiro.

Regras de ouro para quem aplicar: manter as regras antigas de agregados passando nos testes existentes (viram dados da categoria) e não deixar nenhum prompt maior que hoje.

## 4. Pendências da Frente 3 (simulador, personas, fornecedores simulados, testes)

| Item | Onde | O que fazer |
|---|---|---|
| Tabela `CATALOGO` de preços dos fornecedores simulados é só de obra | `src/simulador/personas.ts:8-15` (cimento, areia, brita, vergalhão, tijolo, argamassa) | Externalizar para dados por categoria (preço base, unidade, equivalente), cobrindo escritório, EPI, limpeza, informática, alimentos e serviço. Item sem preço no catálogo deve cair num preço sintético por categoria, não em recusa. |
| `M3_POR_CARRADA = 6` e `/carrad\|caçamba\|caminh/` | `personas.ts:19-20,106` | Vira regra de conversão da categoria Agregados. |
| Fornecedor "Casa do Construtor Lagoa Exemplo" e demais nomes | `personas.ts:49` e vizinhas | Fornecedores simulados com nomes e categorias variados (papelaria, EPI, TI, distribuidor de limpeza e alimentos, prestador de manutenção). |
| "frete R$ 250,00 até a obra" | `personas.ts:142` | "até o local". |
| `fornecedores-simulados.json` | 12 fornecedores de obra (Ferragens x6, Hidráulica x3...) | Acrescentar cerca de 12 a 15 de outras áreas, com `categorias` batendo com `categorias.json`. A origem é da Ester (07/11/2026, só nome e categorias). Decidir com ela, para o arquivo seguir da área de compras. |
| `itens.json` | 36 itens, 11 categorias de obra | Acrescentar pelo menos 3 itens por categoria nova, com `especificacao_tecnica` e `unidade_compra`. |
| Personas de comprador do harness | `scripts/simular-comprador.ts`, `docs/frente-3-harness.md` | Personas de outros ramos: escritório (resmas, toner), EPI (luvas, capacete, CA), limpeza (galão, caixa), TI (notebook, cabo), alimentos (copa, água, café), serviço (manutenção de ar-condicionado, jardinagem). Cenários com unidade ambígua ("1 caixa", "10 pacotes"), serviço sem quantidade, item sem preço público. |
| Cenário de nicho trocado | Harness | Mesmo conjunto de pedidos com `EMPRESA_NICHO` em `construcao` e em `escritorio`: o resultado deve seguir igual para pedidos fora do nicho (regressão do desvio). |
| Teste contra fornecedor de outra atividade (CNAE) | `testes/verificacao.test.ts` | Caso novo: papelaria cotando papel não perde pontos nem gera alerta. Está ligado ao `ATIVIDADE_DA_AREA` (F4). |
| Testes com texto de obra | `testes/busca.test.ts` (24 ocorrências), `comprador.test.ts` (13), `simulador.test.ts` (11), `melhorias.test.ts` (7), `memoria.test.ts` (6), `base-itens.test.ts` (6), `rastreio.integracao.test.ts` (5), `anexos.test.ts` (4) e mais 12 arquivos | A maioria usa cimento/areia como dado de caso, o que é legítimo enquanto os casos de obra continuarem passando. O que falta é par de teste para cada regra generalizada (agregados como dado, conversão de unidade, `urgencia: parada`). Não reescrever os casos atuais. |
| `scripts/testar-busca.ts`, `testar-ia.ts`, `testar-seguranca.ts` (5), `testar-voz.ts` (3) | Frases de obra nos exemplos | Variar os exemplos. O de segurança testa injeção; exemplos mistos bastam. |
| `scripts/mock-dashboard.ts` | Preços de obra (dono: dashboard) | Opcional: mock com uma segunda categoria, só se a demo for mostrar a variedade. |
| Seleção de modelo | `src/nucleo/ia/config.ts` | Rodar o conjunto misto de categorias na comparação de modelos. Um modelo que acerta obra pode errar jargão de escritório; incluir isso nas métricas. |
| Fornecedores simulados de serviço | `personas.ts` | Comportamento "proposta por hora/mês" e "visita técnica antes de cotar", para exercitar o Extrator e o Comparador (depende da decisão de serviços, 3.5). |

Observação de escopo: o que mexe em `src/agentes/` e `src/fluxo/` é da F4. A F3 só relata. O que falhar no harness com as novas personas vai para "Pedidos entre frentes" como bug da F4.
