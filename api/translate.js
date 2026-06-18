const MAX_TEXT_LENGTH = 5000

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `Você é um tradutor direto entre espanhol e português brasileiro.
Estilo do espanhol: Madrid do dia a dia — tuteo ("tío", "tía", "mola", "venga", "qué pasa?", "guay", "mogollón"), descontraído, direto. NUNCA use ¡ ou ¿.
Estilo do português: brasileiro informal — contrações ("tá", "pra", "tô", "tava"), linguagem viva.
Detecte o idioma (espanhol ou português) e traduza para o outro.
Responda APENAS com JSON: {"translation":"...","detected":"es" ou "pt"}`,
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

    if (typeof parsed.translation !== 'string' || !parsed.translation) {
      console.error('Bad response shape:', parsed)
      return res.status(502).json({ error: 'Tradução não encontrada.' })
    }

    res.status(200).json({ translation: parsed.translation, detected: parsed.detected || null })
  } catch (err) {
    console.error('Translate error:', err)
    res.status(500).json({ error: 'Deu ruim na tradução.' })
  }
}
