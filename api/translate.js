import {
  buildAnthropicRequest,
  detectSpokenLang,
  MAX_TEXT_LENGTH,
  normalizeDetectedLang,
  parseTranslation,
  polishTranslation,
  targetLang,
  translationRepeatsSource,
} from '../lib/conversation.js'

const VALID_LANGS = new Set(['es', 'pt'])

function asLang(value) {
  if (VALID_LANGS.has(value)) return value
  return normalizeDetectedLang(value)
}

async function completeTranslation(text, sourceLang, strict = false) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(buildAnthropicRequest({ text, sourceLang, strict })),
  })

  if (!response.ok) {
    console.error('Anthropic API error:', response.status)
    return { error: 'upstream' }
  }

  const data = await response.json()
  const raw = data.content?.find(block => block.type === 'text')?.text || ''
  const parsed = parseTranslation(raw)
  if (!parsed || !parsed.translation.trim()) {
    console.error('Bad translation payload')
    return { error: 'bad' }
  }
  return { parsed }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not configured')
    return res.status(503).json({ error: 'Tradução indisponível: falta a chave da Anthropic na Vercel.' })
  }

  const body = req.body || {}
  const text = body.text
  const requested = VALID_LANGS.has(body.sourceLang) ? body.sourceLang : null

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Texto ausente.' })
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: 'Texto muito longo.' })
  }

  const trimmed = text.trim()

  try {
    // Typed text does not name a language. Haiku stays in the same language
    // unless the request names the source and asks for the other one.
    let sourceLang = requested || detectSpokenLang(trimmed)
    let result = await completeTranslation(trimmed, sourceLang, false)
    if (result.error) {
      const message = result.error === 'bad' ? 'Tradução não encontrada.' : 'Serviço de tradução indisponível.'
      return res.status(502).json({ error: message })
    }

    if (translationRepeatsSource(trimmed, result.parsed.translation)) {
      const retryLang = sourceLang || asLang(result.parsed.detected)
      if (retryLang) {
        console.warn('Translation repeated the source language; retrying')
        const second = await completeTranslation(trimmed, retryLang, true)
        if (second.parsed?.translation?.trim() && !translationRepeatsSource(trimmed, second.parsed.translation)) {
          result = second
          sourceLang = retryLang
        }
      }
    }

    const detected = sourceLang || asLang(result.parsed.detected)
    const target = targetLang(detected)
    res.status(200).json({
      translation: polishTranslation(result.parsed.translation, target),
      detected,
      target,
    })
  } catch (err) {
    console.error('Translate error:', err?.message || err)
    res.status(500).json({ error: 'Deu ruim na tradução.' })
  }
}
