import { buildAnthropicRequest, MAX_TEXT_LENGTH, parseTranslation, polishTranslation, targetLang } from '../lib/conversation.js'

const VALID_LANGS = new Set(['es', 'pt'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not configured')
    return res.status(503).json({ error: 'Tradução indisponível: falta a chave da Anthropic na Vercel.' })
  }

  const body = req.body || {}
  const text = body.text
  const sourceLang = VALID_LANGS.has(body.sourceLang) ? body.sourceLang : null

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Texto ausente.' })
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: 'Texto muito longo.' })
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(buildAnthropicRequest({
        text: text.trim(),
        sourceLang,
      })),
    })

    if (!response.ok) {
      console.error('Anthropic API error:', response.status)
      return res.status(502).json({ error: 'Serviço de tradução indisponível.' })
    }

    const data = await response.json()
    const raw = data.content?.find(block => block.type === 'text')?.text || ''
    const parsed = parseTranslation(raw)
    if (!parsed || !parsed.translation.trim()) {
      console.error('Bad translation payload')
      return res.status(502).json({ error: 'Tradução não encontrada.' })
    }

    const detected = sourceLang || (VALID_LANGS.has(parsed.detected) ? parsed.detected : null)
    const target = targetLang(detected)
    res.status(200).json({
      translation: polishTranslation(parsed.translation, target),
      detected,
      target,
    })
  } catch (err) {
    console.error('Translate error:', err?.message || err)
    res.status(500).json({ error: 'Deu ruim na tradução.' })
  }
}
