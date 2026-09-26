export type QuestionnaireMediaKind = 'image' | 'video' | 'audio' | 'file'

export type QuestionnaireMedia = {
  id?: string
  name: string
  kind: QuestionnaireMediaKind
  contentType?: string
}

export type QuestionnaireSource = 'common' | 'interview'

export type QuestionnaireAnswer = {
  id: string
  question: string
  answer: string
  media: QuestionnaireMedia[]
  source: QuestionnaireSource
}

export type QuestionnaireState = {
  common: QuestionnaireAnswer[]
  interview: QuestionnaireAnswer[]
}

export const MAX_INTERVIEW_QUESTIONS = 6

export function mediaToken(name: string): string {
  return `{media:${String(name || '').trim()}}`
}

export function createQuestionnairePair(source: QuestionnaireSource): QuestionnaireAnswer {
  return {
    id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    question: '',
    answer: '',
    media: [],
    source,
  }
}

export function emptyQuestionnaire(): QuestionnaireState {
  return {
    common: [createQuestionnairePair('common'), createQuestionnairePair('common')],
    interview: [],
  }
}

function asMedia(value: unknown): QuestionnaireMedia | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<QuestionnaireMedia>
  const name = String(item.name || '').trim()
  if (!name) return null
  const kind: QuestionnaireMediaKind =
    item.kind === 'image' || item.kind === 'video' || item.kind === 'audio' || item.kind === 'file'
      ? item.kind
      : 'file'
  return {
    id: item.id ? String(item.id) : undefined,
    name,
    kind,
    contentType: item.contentType ? String(item.contentType) : undefined,
  }
}

function asAnswer(value: unknown, fallback: QuestionnaireSource): QuestionnaireAnswer | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<QuestionnaireAnswer>
  const media = Array.isArray(item.media) ? item.media.map(asMedia).filter(Boolean) as QuestionnaireMedia[] : []
  const question = String(item.question || '').trim()
  const answer = String(item.answer || '').trim()
  if (!question && !answer && !media.length) return null
  return {
    id: String(item.id || `${fallback}-${Math.random().toString(36).slice(2, 8)}`),
    question,
    answer,
    media,
    source: item.source === 'interview' ? 'interview' : fallback,
  }
}

export function parseQuestionnaire(value: unknown): QuestionnaireState {
  if (!value || typeof value !== 'object') return emptyQuestionnaire()
  const raw = value as Partial<QuestionnaireState>
  const common = Array.isArray(raw.common)
    ? raw.common.map((item) => asAnswer(item, 'common')).filter(Boolean) as QuestionnaireAnswer[]
    : []
  const interview = Array.isArray(raw.interview)
    ? raw.interview.map((item) => asAnswer(item, 'interview')).filter(Boolean) as QuestionnaireAnswer[]
    : []
  return {
    common: common.length ? common : emptyQuestionnaire().common,
    interview,
  }
}

export function isCompleteAnswer(entry: QuestionnaireAnswer): boolean {
  return Boolean(entry.question.trim() && (entry.answer.trim() || entry.media.length))
}

export function completedAnswers(state: QuestionnaireState): QuestionnaireAnswer[] {
  return [...state.common, ...state.interview].filter(isCompleteAnswer)
}

export function hasCompletedCommonQuestions(state: QuestionnaireState): boolean {
  return state.common.some(isCompleteAnswer)
}

export function questionsToPairs(questions: string[], source: QuestionnaireSource = 'common'): QuestionnaireAnswer[] {
  const pairs = questions
    .map((question) => String(question || '').trim())
    .filter(Boolean)
    .map((question) => ({
      ...createQuestionnairePair(source),
      question,
    }))
  return pairs.length ? pairs : emptyQuestionnaire().common
}

export function ensureMediaTokens(prompt: string, compiled: string): string {
  const tokens = Array.from(compiled.match(/\{media:[^}]+\}/gi) || [])
  const missing = tokens.filter((token, index) => tokens.indexOf(token) === index && !prompt.includes(token))
  if (!missing.length) return prompt.trim().slice(0, 7800)
  const lines = compiled.split('\n').filter((line) => missing.some((token) => line.includes(token)))
  return `${prompt.trim()}\n\n${lines.join('\n')}`.trim().slice(0, 7800)
}

export function compileQuestionnairePrompt(opts: {
  purpose?: 'leads' | 'support'
  tone?: string
  storeName?: string | null
  entries: QuestionnaireAnswer[]
}): string {
  const entries = opts.entries.filter(isCompleteAnswer)
  const lines: string[] = []
  lines.push('You are the store’s WhatsApp assistant: answer customer questions and help with orders when they ask.')
  if (opts.storeName) lines.push(`Business: ${opts.storeName}.`)
  if (opts.tone) lines.push(`Tone: ${opts.tone}.`)
  lines.push('Use only the seller facts below. Never invent prices, stock, policies, or delivery times.')
  lines.push('If a media file is listed for a topic, send that exact file when the customer asks about that topic.')
  lines.push('')
  lines.push('KNOWLEDGE FROM THE SELLER:')

  for (const entry of entries) {
    const question = entry.question.trim()
    const answer = entry.answer.trim()
    lines.push('')
    lines.push(`Question customers ask: ${question}`)
    if (answer) lines.push(`Seller answer: ${answer}`)
    for (const file of entry.media) {
      lines.push(`When the customer asks about ${question}, send this media file ${mediaToken(file.name)}`)
    }
  }

  if (!entries.some((entry) => entry.media.length)) {
    lines.push('')
    lines.push('No seller media files were provided.')
  }

  return lines.join('\n').trim().slice(0, 7800)
}
