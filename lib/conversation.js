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

export function buildTranslationPrompt({ text, sourceLang, strict = false }) {
  const direction = sourceLang === 'pt'
    ? ['Idioma de origem: pt. Traduza para espanhol da Espanha. No JSON, detected deve ser "pt".']
    : sourceLang === 'es'
      ? ['Idioma de origem: es. Traduza para português do Brasil. No JSON, detected deve ser "es".']
      : [
          'Idioma de origem: detectar entre es e pt.',
          'Se o texto estiver em português, traduza para espanhol da Espanha e detected deve ser "pt".',
          'Se o texto estiver em espanhol, traduza para português do Brasil e detected deve ser "es".',
          'O campo translation tem de estar no outro idioma. Não corrija só acentos e não parafraseie no mesmo idioma.',
        ]
  const lines = [...direction]
  if (strict && (sourceLang === 'pt' || sourceLang === 'es')) {
    lines.push('A tentativa anterior repetiu o idioma de origem. Entregue somente a tradução no idioma de destino.')
  }
  lines.push('Texto:', text)
  return lines.join('\n')
}

export function buildAnthropicRequest({ text, sourceLang, strict = false }) {
  return {
    model: TRANSLATION_MODEL,
    max_tokens: 8192,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildTranslationPrompt({ text, sourceLang, strict }) }],
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
  'eu', 'com', 'sem', 'um', 'uns', 'quero', 'vou', 'onde', 'fica', 'fico', 'ficou',
  'povo', 'banheiro', 'onibus', 'ônibus', 'amanha', 'amanhã', 'acucar', 'açúcar',
  'estou', 'agora', 'pode', 'posso', 'em', 'do', 'ao', 'num', 'numa', 'pelo', 'pela',
  'é', 'são', 'sao',
])
const ES_WORDS = new Set([
  'hola', 'gracias', 'donde', 'dónde', 'usted', 'ustedes', 'vale', 'adios',
  'adiós', 'buenos', 'dias', 'días', 'tio', 'tío', 'pues', 'mio', 'mío',
  'estais', 'estáis', 'vosotros', 'vosotras', 'llamo', 'tambien', 'también',
  'qué', 'cómo', 'yo', 'una', 'unas', 'muy', 'sí',
  'el', 'él', 'la', 'los', 'las', 'lo', 'un', 'con', 'sin', 'estoy', 'quiero',
  'voy', 'viendo', 'puedes', 'puede', 'puedo', 'ahora', 'esto', 'eso', 'dijo',
  'bano', 'baño', 'azucar', 'azúcar', 'manana', 'mañana', 'autobus', 'autobús', 'en',
])
const ECHO_FUNCTION_WORDS = new Set([
  'a', 'o', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'por', 'e', 'y',
  'la', 'el', 'los', 'las', 'que', 'se', 'em', 'en', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'un', 'una', 'para', 'con', 'com', 'del', 'al', 'lo', 'le',
  'me', 'te', 'tu', 'su', 'ao', 'aos', 'ou', 'pero', 'mas',
])

function spokenWords(text) {
  return String(text || '').toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

function foldMarks(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '')
}

export function detectSpokenLang(text) {
  const raw = String(text || '').trim()
  if (raw.length < 2) return null
  const lower = raw.toLowerCase()
  const folded = foldMarks(lower)
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
  if (/\bpor\s+causa\b/.test(folded)) pt += 4
  if (/\bse\s+[a-z]+(?:ar|er|ir|ando|endo|indo)\b/.test(folded)) pt += 3
  if (/\ba\s+gente\b/.test(folded)) pt += 3
  if (/\bpara\s+o\b/.test(folded)) pt += 2
  if (/\b[a-z]+(?:arse|erse|irse|andose|endose)\b/.test(folded)) es += 3
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

function contentTokens(folded) {
  return folded.split(' ').filter(token => token.length > 1 && !ECHO_FUNCTION_WORDS.has(token))
}

export function translationRepeatsSource(original, translation) {
  const left = foldMarks(original).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const right = foldMarks(translation).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (!left || !right) return false
  if (left === right) return true
  const leftTokens = contentTokens(left)
  const rightTokens = contentTokens(right)
  if (leftTokens.length < 3 || rightTokens.length < 3) return false
  const leftSet = new Set(leftTokens)
  let shared = 0
  for (const token of rightTokens) if (leftSet.has(token)) shared += 1
  return shared / rightTokens.length >= 0.75
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
