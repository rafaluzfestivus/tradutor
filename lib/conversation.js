export const TRANSLATION_MODEL = 'claude-haiku-5-5'
export const TRANSCRIBE_MODEL = 'gpt-transcribe'
export const SPEECH_MODEL = 'gpt-4o-mini-tts'
export const LIVE_MODEL = 'gpt-realtime-translate'
export const LIVE_INPUT_MODEL = 'gpt-realtime-whisper'

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

const PT_WORDS = new Set([
  'nao', 'não', 'voce', 'você', 'voces', 'vocês', 'obrigado', 'obrigada',
  'cade', 'cadê', 'pra', 'pro', 'entao', 'então', 'tambem', 'também',
  'ta', 'tá', 'ne', 'né', 'oi', 'ola', 'olá', 'isso', 'joao', 'joão',
  'beleza', 'sim', 'uma', 'umas', 'bem', 'muito',
])
const ES_WORDS = new Set([
  'hola', 'gracias', 'donde', 'dónde', 'usted', 'ustedes', 'vale', 'adios',
  'adiós', 'buenos', 'dias', 'días', 'tio', 'tío', 'pues', 'mio', 'mío',
  'estais', 'estáis', 'vosotros', 'vosotras', 'llamo', 'tambien', 'también',
  'qué', 'cómo', 'yo', 'una', 'unas', 'muy', 'sí',
])

function spokenWords(text) {
  return String(text || '').toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

export function detectSpokenLang(text) {
  const raw = String(text || '').trim()
  if (raw.length < 2) return null
  const lower = raw.toLowerCase()
  let pt = 0
  let es = 0
  if (/[ãõ]/.test(lower)) pt += 4
  if (/[âêô]/.test(lower)) pt += 2
  if (/ç/.test(lower)) pt += 3
  if (/ñ/.test(lower)) es += 4
  if (/[¿¡]/.test(raw)) es += 3
  if (/ção\b/i.test(lower)) pt += 3
  if (/ción\b/i.test(lower)) es += 3
  if (/nh|lh/i.test(lower)) pt += 2
  for (const word of spokenWords(raw)) {
    if (PT_WORDS.has(word)) pt += 2
    if (ES_WORDS.has(word)) es += 2
  }
  if (pt === es) return null
  const winner = Math.max(pt, es)
  const loser = Math.min(pt, es)
  if (winner < 2) return null
  if (loser > 0 && winner - loser < 2) return null
  return pt > es ? 'pt' : 'es'
}

export function normalizeDetectedLang(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  if (raw.startsWith('pt') || raw.includes('portugu')) return 'pt'
  if (raw.startsWith('es') || raw.includes('span') || raw.includes('espanh') || raw.includes('castell')) return 'es'
  return null
}

export function emptyLiveBuffers() {
  return {
    es: { input: '', output: '' },
    pt: { input: '', output: '' },
  }
}

export function chooseLiveTarget(buffers) {
  const heard = [buffers?.es?.input, buffers?.pt?.input]
    .filter(text => typeof text === 'string' && text.trim())
    .sort((a, b) => b.trim().length - a.trim().length)[0] || ''
  const lang = detectSpokenLang(heard)
  if (lang) return targetLang(lang)
  if (heard.trim().length < 8) return null
  const esOut = (buffers?.es?.output || '').trim()
  const ptOut = (buffers?.pt?.output || '').trim()
  if (esOut && !ptOut) return 'es'
  if (ptOut && !esOut) return 'pt'
  return null
}

export function liveDirectionTarget(buffers, active = null) {
  const sample = [buffers?.es?.input, buffers?.pt?.input]
    .filter(text => typeof text === 'string' && text.trim())
    .sort((a, b) => b.trim().length - a.trim().length)[0] || ''
  const tailLang = detectSpokenLang(sample.trim().slice(-70))
  if (tailLang) return targetLang(tailLang)
  if (active === 'es' || active === 'pt') return active
  return chooseLiveTarget(buffers)
}

export function buildLiveSession(targetLanguage) {
  return {
    model: LIVE_MODEL,
    audio: {
      input: {
        transcription: { model: LIVE_INPUT_MODEL },
        noise_reduction: { type: 'far_field' },
      },
      output: { language: targetLanguage },
    },
  }
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

export function readEphemeralToken(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (typeof payload.value === 'string' && payload.value) return payload.value
  if (typeof payload.client_secret === 'string' && payload.client_secret) return payload.client_secret
  if (typeof payload.client_secret?.value === 'string' && payload.client_secret.value) return payload.client_secret.value
  return null
}

export function upstreamErrorMessage(payload, status) {
  const message = payload?.error?.message || payload?.message
  if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 240)
  return `OpenAI respondeu ${status}`
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
