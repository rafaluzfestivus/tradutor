export const TRANSLATION_MODEL = 'claude-haiku-5-5'
export const TRANSCRIBE_MODEL = 'gpt-transcribe'
export const SPEECH_MODEL = 'gpt-4o-mini-tts'
export const LIVE_MODEL = 'gpt-realtime-translate'
export const LIVE_INPUT_MODEL = 'gpt-realtime-whisper'

export const MAX_TEXT_LENGTH = 5000
export const MAX_AUDIO_BASE64 = 3_500_000
export const UTTERANCE_ATTACK_MS = 140
export const UTTERANCE_QUIET_MS = 420
export const UTTERANCE_MIN_MS = 280
export const UTTERANCE_LIMIT_MS = 8000

const SYSTEM_PROMPT = `Você é um tradutor instantâneo entre espanhol da Espanha e português do Brasil.
Entregue uma tradução fluida e natural, como um nativo falando no dia a dia.
Traduza só o texto recebido. Cada pedido é independente: não invente assunto, não continue uma frase anterior e não responda como conversa.

Regras:
- Se o idioma de origem vier indicado, respeite esse idioma e traduza para o outro.
- Se não vier indicado, detecte se o texto está em espanhol (es) ou português (pt) e traduza para o outro.
- Evite tradução literal. Adapte expressões idiomáticas e falsos amigos ao tom do original.
- Não force gírias extremas, a menos que o original seja explicitamente informal.
- Não use os caracteres ¡ nem ¿ no espanhol do dia a dia.
- Não traduza nomes próprios. João continua João.
- Responda apenas com um JSON válido, sem markdown: {"translation":"...","detected":"es"} ou {"translation":"...","detected":"pt"}.`

export function buildTranslationPrompt({ text, sourceLang }) {
  const lines = [
    sourceLang === 'pt'
      ? 'Idioma de origem: pt. Traduza para espanhol da Espanha. No JSON, detected deve ser "pt".'
      : sourceLang === 'es'
        ? 'Idioma de origem: es. Traduza para português do Brasil. No JSON, detected deve ser "es".'
        : 'Idioma de origem: detectar entre es e pt.',
    'Texto:',
    text,
  ]
  return lines.join('\n')
}

export function buildAnthropicRequest({ text, sourceLang }) {
  return {
    model: TRANSLATION_MODEL,
    max_tokens: 8192,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildTranslationPrompt({ text, sourceLang }) }],
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

export function languageFromTranscript(data, text) {
  const listed = Array.isArray(data?.languages)
    ? data.languages
      .map(item => normalizeDetectedLang(typeof item === 'string' ? item : item?.code))
      .find(Boolean)
    : null
  return listed || normalizeDetectedLang(data?.language) || detectSpokenLang(text)
}

export function createEndpoint(now = 0) {
  return {
    phase: 'listen',
    floor: 0.01,
    avg: 0.01,
    primed: false,
    ready: false,
    voiceSince: 0,
    quietSince: 0,
    recordStart: 0,
    startedAt: now,
  }
}

export function releaseEndpoint(state, now = 0) {
  return {
    ...state,
    phase: 'listen',
    voiceSince: 0,
    quietSince: 0,
    recordStart: 0,
  }
}

export function stepEndpoint(state, rms, now) {
  const level = Number.isFinite(rms) && rms > 0 ? rms : 0
  const next = { ...state }
  if (!next.primed) {
    const seed = level || 0.005
    next.floor = seed
    next.avg = seed
    next.primed = true
    next.startedAt = now
    return { state: next, action: null }
  }

  const high = Math.max(next.floor + 0.018, next.avg * 1.55, 0.02)
  const low = Math.max(next.floor + 0.007, next.avg * 1.12)

  if (next.phase === 'listen') {
    if (!next.ready && now - next.startedAt >= 200) next.ready = true
    if (level < high) {
      next.avg = next.avg * 0.82 + level * 0.18
      if (level < next.floor) next.floor = level
      else next.floor = next.floor * 0.96 + Math.min(level, next.floor * 1.5) * 0.04
    }
    if (!next.ready) return { state: next, action: null }
    if (level >= high) {
      if (!next.voiceSince) next.voiceSince = now
      if (now - next.voiceSince >= UTTERANCE_ATTACK_MS) {
        next.phase = 'record'
        next.recordStart = next.voiceSince
        next.voiceSince = 0
        next.quietSince = 0
        return { state: next, action: 'start' }
      }
    } else {
      next.voiceSince = 0
    }
    return { state: next, action: null }
  }

  if (level >= low) next.quietSince = 0
  else if (!next.quietSince) next.quietSince = now

  const spokeFor = now - next.recordStart
  const quietFor = next.quietSince ? now - next.quietSince : 0
  if ((quietFor >= UTTERANCE_QUIET_MS && spokeFor >= UTTERANCE_MIN_MS) || spokeFor >= UTTERANCE_LIMIT_MS) {
    next.phase = 'listen'
    next.voiceSince = 0
    next.quietSince = 0
    next.recordStart = 0
    next.avg = Math.min(next.avg, Math.max(level, next.floor))
    return { state: next, action: 'stop' }
  }
  return { state: next, action: null }
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
