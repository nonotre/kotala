// Listas do guardrail (S). Todas testam o texto já normalizado: sem acento,
// minúsculo e com o leetspeak desfeito (ver normalizar em index.ts).
// Desenho e critérios em docs/plano-ia/guardrails.md. A lista de controlados
// ainda precisa ser validada pelo dono ou pelo jurídico.

/** Subtipos que bloqueiam sem a IA. Os marcados com `avisarJa` avisam o gestor já na 1ª vez. */
export type TermoDuro = { subtipo: string; padrao: RegExp; avisarJa?: boolean };

/**
 * Lista dura: só termos sem uso legítimo numa compra de empresa. Bloqueia sem a IA,
 * e vale mesmo que a IA diga "pedido" (defesa contra injeção que convenceu o modelo).
 * Palavra de duplo sentido (bala, pedra, pó, crack, pistola) nunca entra aqui.
 */
export const LISTA_DURA: readonly TermoDuro[] = [
  {
    subtipo: "droga",
    padrao: /\b(cocaina|heroina|maconha|haxixe|metanfetamina|ecstasy|mdma|lanca[- ]perfume|pasta base de coca\w*)\b/,
  },
  {
    subtipo: "nota_fria",
    padrao: /\bnotas? (fiscal |fiscais )?frias?\b|\bnotas? (fiscal |fiscais )?sem mercadoria\b|\bnotas? (fiscal |fiscais )?(falsas?|fake)\b/,
    avisarJa: true,
  },
  {
    subtipo: "documento_falso",
    padrao:
      /\b(cnh|rg|cpf|documentos?|diplomas?|atestados?|certid(ao|oes)|carteiras? de (motorista|trabalho|identidade)|alvaras?|laudos?|habilitac(ao|oes)|passaportes?)( [a-z]+){0,2} (falsos?|falsas?|falsificad[oa]s?|fake)\b|\bfalsifica\w* (de |uma |um |o |a )?(documento|assinatura|cnh|rg|diploma|atestado|laudo|receita)/,
  },
  {
    subtipo: "sexual_menor",
    padrao:
      /\b(pornografia|porno|nudes?|fotos? intimas?|conteudo (sexual|erotico)|sexo)\b.{0,40}\b(infantil|criancas?|menor(es)? de idade|menores|menin[oa]s? de \d{1,2}|adolescentes?)\b|\bpedofil\w*/,
    avisarJa: true,
  },
  {
    subtipo: "licitacao",
    padrao:
      /\borcamentos? (de )?(fachada|fantasmas?|combinados?|frios?|falsos?|fake|de cobertura)\b|\bcobertura (de|na|pra|para) (a )?licitac\w*|\bcombin\w* com (os|as) (fornecedores|concorrentes|outras empresas|outros fornecedores)\b.{0,40}\b(todos|todas|mesmo (preco|valor)|preco unico|um preco so|darem|derem|cobri\w*)/,
    avisarJa: true,
  },
  {
    subtipo: "fraude",
    padrao:
      /\bfico com a diferenca\b|\bsuperfatur\w*|\b(valor|preco|orcamento) (maior|mais alto|acima)\b.{0,40}\b(diferenca|pra mim|para mim)\b|\bcaixa dois\b|\blavagem de dinheiro\b/,
    avisarJa: true,
  },
  { subtipo: "radiofrequencia", padrao: /\bbloqueador(es)? de (sinal|sinais|celular(es)?|gps|rastreador(es)?)\b|\bjammers?\b/ },
  {
    subtipo: "pirataria",
    padrao: /\bcrack (do|da|pro|pra|para o|para a) [a-z]+|\bcrackead[oa]s?\b|\b(versao|licencas?|software|programa|windows|office) (pirata|piratead[oa])\b|\bkeygen\b/,
  },
  {
    subtipo: "dados_pessoais",
    padrao:
      /\b(lista|base|banco|planilha)s? de (cpfs?|e-?mails?|telefones?|celulares)( [a-z]+){0,3} (de clientes|vazad\w*|de pessoas|de terceiros)\b|\b(dados|cpfs?|senhas?) vazad\w*/,
  },
];

/** Controlado: item legal que exige autorização de quem compra. Sai do pedido e vai a uma pessoa. */
export type Controlado = { grupo: string; orgao: string; padrao: RegExp };

export const CONTROLADOS: readonly Controlado[] = [
  {
    grupo: "arma ou munição",
    orgao: "Exército e Polícia Federal",
    padrao:
      /\bmunic(ao|oes)\b|\barmas? de fogo\b|\brevolver(es)?\b|\bespingardas?\b|\bcarabinas?\b|\bfuzi[ls]\b|\bpistolas? (\.?\d|calibre|glock|taurus|semi)|\bcartuchos? (calibre|cal\.? ?\d|\.?\d+ ?mm|\.\d+|de (espingarda|revolver|pistola|caca))|\bcoletes? (balisticos?|a prova de bala|nivel (ii|iii|iv|2|3|4))|\b(spray|gas|gel) de pimenta\b|\barmas? de choque\b|\btaser\b/,
  },
  {
    grupo: "explosivo",
    orgao: "Exército",
    padrao: /\bdinamites?\b|\b(?<!(atmosferas?|areas?|ambientes?|zonas?|prova de) )explosiv[oa]s?\b|\bcordel detonante\b|\bespoletas?\b|\bestopins?\b|\bdetonador(es)?\b/,
  },
  { grupo: "precursor químico", orgao: "Polícia Federal e Exército", padrao: /\bnitrato de amonio\b/ },
  {
    grupo: "medicamento controlado",
    orgao: "ANVISA (receita retida)",
    padrao:
      /\bmorfina\b|\bfentanil\w*|\bmetadona\b|\boxicodona\b|\bcodeina\b|\btramadol\b|\bbenzodiazepinic\w*|\bdiazepam\b|\bclonazepam\b|\brivotril\b|\balprazolam\b|\blorazepam\b|\bzolpidem\b|\banabolizantes?\b|\bmetilfenidato\b|\britalina\b|\b[ck]etamina\b/,
  },
  { grupo: "fonte radioativa", orgao: "CNEN", padrao: /\bdensimetros? nuclear(es)?\b|\bfontes? radioativ\w*|\bmateria(l|is) radioativ\w*/ },
];

/**
 * Sinais sensíveis: só marcam o caso e fazem a leitura usar o modelo forte.
 * Nunca bloqueiam. As exceções comuns ("pistola de cola", "bomba d'água") ficam de fora.
 */
export const SINAIS: readonly { nome: string; padrao: RegExp }[] = [
  { nome: "arma", padrao: /\barmas?\b/ },
  {
    nome: "pistola",
    padrao: /\bpistolas?\b(?! (de|para|pra) (cola|silicone|pintura|ar|calor|solda|pregos?|grampos?|espuma|pressao|lavar|limpeza|agua|rebite\w*|pulveriza\w*))/,
  },
  {
    nome: "bomba",
    padrao:
      /\bbombas?\b(?! ?(d ?.?agua|de (agua|vacuo|calor|combustivel|graxa|pressao|recalque|piscina|poco|incendio|lama|drenagem|infla\w*|chocolate)|submersa|submersivel|centrifuga|dosadora|hidraulica|periferica|injetora|sapo|pneumatica|manual|de ar))/,
  },
  { nome: "granada", padrao: /\bgranadas?\b/ },
  { nome: "munição", padrao: /\bmunic(ao|oes)\b/ },
  { nome: "explosivo", padrao: /\bexplosiv\w*|\bdetona\w*/ },
  { nome: "crack", padrao: /\bcrack\b/ },
  { nome: "droga", padrao: /\bdrogas?\b|\bentorpecente\w*/ },
  { nome: "vigilância oculta", padrao: /\bcameras? (escondidas?|espias?|ocultas?)\b|\bescuta clandestina\b|\bgrampo telefonico\b/ },
  { nome: "sexual", padrao: /\b(porno\w*|sexo|sexual|erotic\w*|nudes?|putaria)\b/ },
  { nome: "irregular", padrao: /\b(contrabando|contrabandead\w*|roubad[oa]s?|furtad[oa]s?|sem procedencia|desmanche|ilegal|falsificad\w*|clonad[oa]s?|replicas?)\b/ },
  { nome: "vantagem", padrao: /\b(propina|suborno|por fora|agrado|comissao pra mim|comissao para mim)\b/ },
  { nome: "licitação", padrao: /\blicitac\w*/ },
  { nome: "invasão", padrao: /\b(hackear|hacker|invadir|senha de outr\w*)\b/ },
  { nome: "falsificação", padrao: /\bfals[oa]s?\b|\bfake\b/ },
];

/**
 * Contexto legítimo de palavra sensível. Quando a IA diz "proibido" sobre um item
 * que casa aqui (e a lista dura não casou), o assistente pergunta em vez de recusar.
 */
export const EXCECOES =
  /\b(faca|facas|facao|facoes) (de|para|pra) (cozinha|mesa|pao|carne|estilete|rocada|mato|corte|legumes|churrasco)|\balcool (70|46|absoluto|em gel|gel|isopropilico|etilico|liquido)|\bfitas? (adesivas?|crepe|isolantes?|dupla face|de (empacotamento|demarcacao|vedacao|led|cetim))|\bpo de (pedra|cafe|marmore|serra|brita)|\bpedras? (brita|britada|de mao|portuguesa|sao tome|ardosia|\d)|\berva[- ]mate\b|\bbalas? (de goma|de menta|de coco|macias?|mastigave\w*|sortidas?|de iogurte)|\bpistolas? (de|para|pra) (cola|silicone|pintura|ar|calor|solda|pregos?|grampos?|espuma)|\bcartuchos? (de )?(tinta|toner|silicone|filtro|impressora|cola|gas|fixacao)|\bbombas? (d.?agua|de (agua|vacuo|calor|combustivel|graxa|piscina|poco)|submersa|centrifuga)|\b(ferro|concreto|vidro|aco) armad[oa]\b|\barmac(ao|oes)\b|\barmaduras?\b|\bgranalha\b|\bvenenos? (de|pra|para) (rato|barata|formiga|cupim|inseto)|\bacido muriatico\b|\bsoda caustica\b|\bcameras? de seguranca\b|\bnota fiscal\b|\bpreservativos?\b/;

/** Condição irregular sobre item legal: tirada do pedido, que segue com nota. */
export const CONDICAO_IRREGULAR =
  /\bsem (nota|nf|nfe|nota fiscal)\b|\bnotas? (fiscal )?(com|de) valor (menor|maior|abaixo|acima|reduzido)\b|\bnota (por fora|calcada|pela metade)\b|\b(pagamento|pago|pagar|pix|deposito) (por fora|na (minha )?conta pessoal|na conta (de|da) pessoa fisica)\b/;

/** Texto com cara de código ou longo demais: sinal de pedido fora do escopo. */
export const CARA_DE_CODIGO = /```|\bfunction\s*\w*\s*\(|\bdef \w+\(|\bselect .{1,80} from \w|#include|console\.log|\bimport \w+ from\b|<\/?(div|script|html)\b|=>\s*\{/;
export const TEXTO_LONGO = 2000;

/** Tentativa de mudar as regras: só marca (a classe sai da IA). */
export const SINAL_INJECAO =
  /\bignor\w* (as |suas |todas as |essas |tudo )?(regras|instruc\w*|anteriores)|\b(mostre|mostra|revele|revela|repita|repete) (o |seu |teu )?prompt\b|\bmodo (desenvolvedor|dev|deus|admin)\b|\bvoce agora e\b|\bsou o (gestor|dono|admin\w*|diretor|desenvolvedor)\b|\bsistema:|\bjailbreak\b/;

/** Links que nunca vão ao fornecedor: encurtadores, IP, executável. */
export const LINK_SUSPEITO =
  /\bhttps?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|encurtador\.com\.br|rb\.gy|shorturl\.at|ow\.ly)\/|\bhttps?:\/\/\d{1,3}(\.\d{1,3}){3}|\bhttps?:\/\/\S+\.(exe|apk|bat|scr|msi|cmd|js|vbs)\b/;
