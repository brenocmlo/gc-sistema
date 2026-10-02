// Log e etapas da automação de documentos (Breno, 28/09): "o log de erros
// precisa ser descritivo — ex.: aconteceu um erro de excesso de execução no
// n8n — e mostrado no sistema; e preciso saber em que etapa estamos".
//
// O n8n e o sistema gravam só a ETAPA e o erro cru (documentos_processamento.
// etapa / etapa_detalhe); um trigger no banco transforma cada mudança num
// evento (automacao_eventos). A tradução do erro cru para frase de gente mora
// aqui, com teste, e é usada na tela.

export const ETAPAS = ['NA_FILA', 'LEITURA', 'LEITURA_RESERVA', 'GRAVANDO', 'CONCLUIDO', 'REVISAO', 'ERRO'] as const
export type Etapa = (typeof ETAPAS)[number]

export const ETAPA_LABELS: Record<Etapa, string> = {
  NA_FILA: 'Na fila da automação',
  LEITURA: 'Lendo o PDF (Gemini)',
  LEITURA_RESERVA: 'Lendo o PDF pela reserva (Groq)',
  GRAVANDO: 'Registrando no sistema',
  CONCLUIDO: 'Concluído',
  REVISAO: 'Aguardando revisão',
  ERRO: 'Parou com erro',
}

/** Caminho feliz, na ordem — para a linha de progresso do detalhe. */
export const ETAPAS_DO_CAMINHO: readonly Etapa[] = ['NA_FILA', 'LEITURA', 'GRAVANDO', 'CONCLUIDO']

export function isEtapa(v: unknown): v is Etapa {
  return typeof v === 'string' && (ETAPAS as readonly string[]).includes(v)
}

export function rotuloEtapa(v: unknown): string {
  return isEtapa(v) ? ETAPA_LABELS[v] : typeof v === 'string' && v ? v : 'Sem etapa registrada'
}

/** Etapa terminal: a automação não vai mexer mais sozinha. */
export function etapaEncerrada(v: unknown): boolean {
  return v === 'CONCLUIDO' || v === 'REVISAO' || v === 'ERRO'
}

export type ErroDescrito = {
  /** Código estável, para filtro e para a faixa de "automação parada". */
  codigo: string
  titulo: string
  explicacao: string
  oQueFazer: string
  /** Para tudo, não só este documento. */
  bloqueiaAutomacao: boolean
}

type Regra = { teste: RegExp; erro: Omit<ErroDescrito, 'explicacao'> & { explicacao: string | ((raw: string) => string) } }

const REGRAS: Regra[] = [
  {
    teste: /execution limit|limite de execu/i,
    erro: {
      codigo: 'N8N_LIMITE_EXECUCOES',
      titulo: 'Limite de execuções do n8n atingido',
      explicacao:
        'O plano do n8n Cloud chegou ao limite de execuções deste ciclo. Enquanto isso, nenhum documento é lido — nem o que chega pelo bot do Telegram, nem o que é enviado pela tela.',
      oQueFazer:
        'Esperar o ciclo do plano renovar (n8n → Settings → Usage mostra a data) ou subir o plano. Depois, reprocessar em /documentos o que ficou parado.',
      bloqueiaAutomacao: true,
    },
  },
  {
    teste: /exceeded your current quota|current quota|RESOURCE_EXHAUSTED/i,
    erro: {
      codigo: 'GEMINI_COTA',
      titulo: 'Cota gratuita do Gemini esgotada',
      explicacao: 'A chave do Gemini usou toda a cota gratuita do dia. A leitura passa para a reserva (Groq), que só lê PDF com texto.',
      oQueFazer: 'Nada, se a reserva deu conta. A cota volta por volta das 04:00 (Brasília); para não depender disso, ativar o faturamento da chave.',
      bloqueiaAutomacao: false,
    },
  },
  {
    teste: /high demand|overloaded|service unavailable|\b503\b/i,
    erro: {
      codigo: 'GEMINI_SOBRECARGA',
      titulo: 'Gemini sobrecarregado',
      explicacao: 'O Gemini recusou por excesso de demanda do lado do Google — é temporário. A reserva (Groq) tenta ler no lugar.',
      oQueFazer: 'Se a reserva também falhou, reprocessar o documento em alguns minutos.',
      bloqueiaAutomacao: false,
    },
  },
  {
    teste: /tokens per minute|\bTPM\b|\bOTPM\b|rate.?limit|too many requests|request too large/i,
    erro: {
      codigo: 'IA_LIMITE_POR_MINUTO',
      titulo: 'Limite por minuto da IA',
      explicacao: 'A IA de leitura recusou por excesso de uso no minuto (plano gratuito). Documento grande ou vários seguidos passam do limite.',
      oQueFazer: 'Reprocessar o documento depois de um minuto.',
      bloqueiaAutomacao: false,
    },
  },
  {
    teste: /PDF sem texto/i,
    erro: {
      codigo: 'PDF_SEM_TEXTO',
      titulo: 'PDF sem texto (escaneado ou foto)',
      explicacao: 'O Gemini estava indisponível e a reserva só lê PDF com texto. Este parece escaneado.',
      oQueFazer: 'Pedir o PDF original, gerado pelo sistema de quem enviou, ou reprocessar quando o Gemini voltar.',
      bloqueiaAutomacao: false,
    },
  },
  {
    teste: /Obra não identificada|não encontramos no sistema a obra|mais de uma obra/i,
    erro: {
      codigo: 'OBRA_NAO_IDENTIFICADA',
      titulo: 'Obra não identificada no documento',
      explicacao: (raw) => `A leitura não conseguiu casar o documento com uma única obra cadastrada. ${trechoUtil(raw)}`.trim(),
      oQueFazer: 'Reprocessar escolhendo a obra certa, ou cadastrar a obra se ela ainda não existe.',
      bloqueiaAutomacao: false,
    },
  },
  {
    teste: /já tem um contrato vigente/i,
    erro: {
      codigo: 'OBRA_JA_TEM_CONTRATO',
      titulo: 'A obra já tem contrato',
      explicacao: (raw) => `Uma obra tem um contrato vigente, e esta já tem. ${trechoUtil(raw)}`.trim(),
      oQueFazer: 'Ver se o documento é um aditivo ou um reenvio. Se for reenvio, descartar; se for o contrato certo, vincular.',
      bloqueiaAutomacao: false,
    },
  },
  {
    teste: /Já existe (uma proposta|um contrato) com (esse|o) número|já existe (uma proposta|um contrato) com o número/i,
    erro: {
      codigo: 'NUMERO_REPETIDO',
      titulo: 'Número já cadastrado',
      explicacao: 'Já existe proposta ou contrato com o número deste documento nesta empresa.',
      oQueFazer: 'Se é o mesmo documento de novo, descartar; se é o registro certo, vincular a ele.',
      bloqueiaAutomacao: false,
    },
  },
  {
    teste: /Itens sem conserto|quantidade ausente ou zero|sem valor unitário e sem valor total/i,
    erro: {
      codigo: 'ITENS_ILEGIVEIS',
      titulo: 'Itens que não puderam ser lidos',
      explicacao: (raw) => `Algum item veio sem valor ou sem quantidade, e o registro inteiro foi recusado para não ficar pela metade. ${trechoUtil(raw)}`.trim(),
      oQueFazer: 'Conferir o PDF; se estiver certo, cadastrar à mão e vincular.',
      bloqueiaAutomacao: false,
    },
  },
  {
    teste: /InvalidSignature|Baixar PDF|Baixar arquivo|getFile/i,
    erro: {
      codigo: 'DOWNLOAD_PDF',
      titulo: 'Não foi possível baixar o PDF',
      explicacao: 'A automação não conseguiu baixar o arquivo (link expirado ou arquivo indisponível).',
      oQueFazer: 'Reprocessar; se persistir, pedir o reenvio do PDF.',
      bloqueiaAutomacao: false,
    },
  },
  {
    teste: /não está configurada|não configurada neste ambiente/i,
    erro: {
      codigo: 'NAO_CONFIGURADA',
      titulo: 'Automação não configurada neste ambiente',
      explicacao: 'Falta alguma variável de ambiente no servidor (token ou endereço da automação).',
      oQueFazer: 'Conferir na Vercel: INGESTAO_TOKEN, INGESTAO_PROFILE_ID, N8N_DOCUMENTO_WEBHOOK_URL e N8N_DOCUMENTO_TOKEN.',
      bloqueiaAutomacao: true,
    },
  },
  {
    teste: /Token de ingestão inválido|\b401\b|\b403\b|Unauthorized|Forbidden/i,
    erro: {
      codigo: 'TOKEN_INVALIDO',
      titulo: 'Sistema e automação não se reconheceram',
      explicacao: 'O token trocado entre o sistema e o n8n foi recusado.',
      oQueFazer:
        'Conferir se INGESTAO_TOKEN na Vercel (Production) é igual ao header x-ingestao-token da Credential do n8n — sem aspas, espaço ou quebra de linha — e fazer Redeploy, porque variável nova só vale no deploy seguinte. Depois, reprocessar o documento.',
      bloqueiaAutomacao: true,
    },
  },
  {
    teste: /não respondeu|timed? ?out|ECONNREFUSED|ENOTFOUND|fetch failed|respondeu 5\d\d/i,
    erro: {
      codigo: 'SEM_RESPOSTA',
      titulo: 'A automação não respondeu',
      explicacao: 'O sistema chamou o n8n e não teve resposta a tempo (fora do ar, lento ou no limite do plano).',
      oQueFazer: 'Reprocessar em alguns minutos; se continuar, conferir o n8n.',
      bloqueiaAutomacao: false,
    },
  },
]

function trechoUtil(raw: string): string {
  const limpo = raw.replace(/\s+/g, ' ').trim()
  return limpo ? `Detalhe: ${limpo.slice(0, 220)}${limpo.length > 220 ? '…' : ''}` : ''
}

/** Traduz o erro cru (do n8n, da IA, do banco) para o que a pessoa precisa saber. */
export function descreverErro(raw: unknown): ErroDescrito {
  const texto = typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw)
  for (const r of REGRAS) {
    if (r.teste.test(texto)) {
      return { ...r.erro, explicacao: typeof r.erro.explicacao === 'function' ? r.erro.explicacao(texto) : r.erro.explicacao }
    }
  }
  return {
    codigo: 'OUTRO',
    titulo: 'Erro na automação',
    explicacao: texto ? trechoUtil(texto) : 'A automação parou sem mensagem de erro.',
    oQueFazer: 'Reprocessar o documento; se repetir, avisar o suporte com este detalhe.',
    bloqueiaAutomacao: false,
  }
}

export type EventoAutomacao = {
  id: string
  documento_id: string | null
  etapa: string
  nivel: 'info' | 'aviso' | 'erro' | string
  mensagem: string
  detalhe: string | null
  origem: string
  criado_em: string
}

/**
 * A automação está parada? Olha os eventos mais recentes (mais novo primeiro):
 * um erro que bloqueia tudo (limite do n8n, token, configuração) sem nenhum
 * documento concluído depois dele.
 */
export function situacaoDaAutomacao(
  eventosMaisNovosPrimeiro: EventoAutomacao[],
  agora: Date = new Date(),
  janelaHoras = 48,
): { parada: false } | { parada: true; erro: ErroDescrito; desde: string } {
  const limite = agora.getTime() - janelaHoras * 3600 * 1000
  for (const e of eventosMaisNovosPrimeiro) {
    if (new Date(e.criado_em).getTime() < limite) break
    if (e.etapa === 'CONCLUIDO') return { parada: false }
    if (e.nivel === 'erro') {
      const erro = descreverErro(`${e.mensagem} ${e.detalhe ?? ''}`)
      if (erro.bloqueiaAutomacao) return { parada: true, erro, desde: e.criado_em }
    }
  }
  return { parada: false }
}
