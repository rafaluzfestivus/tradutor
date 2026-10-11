export const TRANSLATION_MODEL = 'claude-haiku-5-5'
export const TRANSCRIBE_MODEL = 'gpt-transcribe'
export const SPEECH_MODEL = 'gpt-4o-mini-tts'
export const LIVE_MODEL = 'gpt-realtime-translate'

export const MAX_TEXT_LENGTH = 5000
export const MAX_HISTORY_TURNS = 6
export const MAX_STORED_TURNS = 80
export const MAX_AUDIO_BASE64 = 3_500_000

const SYSTEM_PROMPT = `Você é um tradutor instantâneo entre espanhol da Espanha e português do Brasil.
Entregue uma tradução fluida e natural, como um nativo falando no dia a dia.

Regras:
- Se o idioma de origem vier indicado, respeite esse idioma e traduza para o outro.
- Se não vier indicado, detecte se o texto está em espanhol (es) ou português (pt) e traduza para o outro.
- Use o contexto só para entender pronomes, o assunto e respostas curtas. Não traduza o contexto de novo e não o inclua na resposta.
- Evite tradução literal. Adapte expressões idiomáticas e falsos amigos ao tom do original.
- Não force gírias extremas, a menos que o original seja explicitamente informal.
- Não use os caracteres ¡ nem ¿ no espanhol do dia a dia.
- Não traduza nomes próprios. João continua João.
- Responda apenas com um JSON válido, sem markdown: {"translation":"...","detected":"es"} ou {"translation":"...","detected":"pt"}.`

export function normalizeHistory(history) {
  if (!Array.isArray(history)) return []
  const turns = []
  for (const item of history.slice(-MAX_HISTORY_TURNS)) {
    if (!item || typeof item !== 'object') continue
    const sourceLang = item.sourceLang === 'pt' || item.sourceLang === 'es' ? item.sourceLang : null
    const original = typeof item.original === 'string' ? item.original.trim().slice(0, 500) : ''
    const translation = typeof item.translation === 'string' ? item.translation.trim().slice(0, 500) : ''
    if (!original && !translation) continue
    turns.push({ sourceLang, original, translation })
  }
  return turns
}

export function buildTranslationPrompt({ text, sourceLang, history }) {
  const turns = normalizeHistory(history)
  const lines = []
  if (turns.length) {
    lines.push('Contexto recente (não traduzir, usar só para desambiguar):')
    for (const turn of turns) {
      const lang = turn.sourceLang || '?'
      lines.push(`- ${lang}: "${turn.original}" => "${turn.translation}"`)
    }
    lines.push('')
  }
  lines.push(sourceLang === 'pt'
    ? 'Idioma de origem: pt. Traduza para espanhol da Espanha. No JSON, detected deve ser "pt".'
    : sourceLang === 'es'
      ? 'Idioma de origem: es. Traduza para português do Brasil. No JSON, detected deve ser "es".'
      : 'Idioma de origem: detectar entre es e pt.')
  lines.push('Texto novo:')
  lines.push(text)
  return lines.join('\n')
}

export function buildAnthropicRequest({ text, sourceLang, history }) {
  return {
    model: TRANSLATION_MODEL,
    max_tokens: 8192,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildTranslationPrompt({ text, sourceLang, history }) }],
  }
}

export function parseTranslation(raw) {
  const cleaned = String(raw || '').replace(/```json|```/gi, '').trim()
  const candidates = [cleaned]
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed.translation === 'string') return parsed
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

export function targetLang(sourceLang) {
  if (sourceLang === 'pt') return 'es'
  if (sourceLang === 'es') return 'pt'
  return null
}

export function polishTranslation(text, target) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (target !== 'es') return clean
  return clean.replace(/[¡¿]/g, '').replace(/\s+/g, ' ').trim()
}

export function isStoredTurn(item) {
  return Boolean(item
    && typeof item.id === 'string'
    && (item.sourceLang === 'pt' || item.sourceLang === 'es')
    && typeof item.original === 'string'
    && typeof item.translation === 'string')
}

export function applyLiveEvent(state, event) {
  const next = { input: state?.input || '', output: state?.output || '' }
  if (!event || typeof event !== 'object') return next
  const type = typeof event.type === 'string' ? event.type : ''
  const transcript = typeof event.transcript === 'string' ? event.transcript : (typeof event.text === 'string' ? event.text : null)
  if (typeof event.delta === 'string' && type.includes('transcript') && type.endsWith('.delta')) {
    if (type.includes('output')) next.output += event.delta
    else if (type.includes('input')) next.input += event.delta
  } else if (transcript && type.endsWith('.done')) {
    if (type.includes('output')) next.output = transcript
    else if (type.includes('input')) next.input = transcript
  } else if (type === 'error' || event.error) next.error = event.error?.message || event.message || 'Erro no modo ao vivo.'
  return next
}
