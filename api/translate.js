const MAX_TEXT_LENGTH = 5000
const VALID_LANGS = new Set(['es', 'pt'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not configured')
    return res.status(503).json({ error: 'Serviço não configurado. Contate o administrador.' })
  }

  const { text } = req.body || {}

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
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        temperature: 0.2,
        system: `Você é um tradutor instantâneo bilateral de alta performance entre Espanhol (Espanha) e Português (Brasil).
Seu objetivo é entregar uma tradução fluida, natural e que soe como um nativo falando no dia a dia, respeitando o contexto.

Diretrizes:
1. Detecte o idioma automaticamente.
2. Evite traduções literais. Adapte expressões idiomáticas e falsos amigos naturalmente de acordo com o tom do texto original.
3. Não force gírias extremas (como 'mola' ou 'tá') a menos que o texto de entrada seja explicitamente informal ou use gírias.
4. Nunca adicione os caracteres ¡ ou ¿ no espanhol se a tradução for para o dia a dia digital/mensagens.
5. Responda APENAS com o objeto JSON válido: {"translation": "...", "detected": "es" ou "pt"}`,
        messages: [{ role: 'user', content: text }]
      })
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      console.error('Anthropic API error:', response.status, errData)
      return res.status(502).json({ error: 'Serviço de tradução indisponível.' })
    }

    const data = await response.json()
    const raw = data.content?.find(b => b.type === 'text')?.text || ''
    let parsed
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
    } catch {
      console.error('JSON parse failed. raw:', raw)
      return res.status(502).json({ error: 'Resposta inesperada do serviço.' })
    }

    if (!parsed || typeof parsed.translation !== 'string' || !parsed.translation) {
      console.error('Bad response shape:', parsed)
      return res.status(502).json({ error: 'Tradução não encontrada.' })
    }

    const detected = VALID_LANGS.has(parsed.detected) ? parsed.detected : null
    res.status(200).json({ translation: parsed.translation, detected })
  } catch (err) {
    console.error('Translate error:', err)
    res.status(500).json({ error: 'Deu ruim na tradução.' })
  }
}
