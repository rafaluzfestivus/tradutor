const VALID_LANGS = new Set(['es', 'pt'])
const MAX_TEXT_LENGTH = 5000

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { text, forceLang } = req.body

  // Fix #2 + #8: validate text length and forceLang allowlist server-side
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Texto ausente.' })
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: 'Texto muito longo.' })
  }
  const validLang = VALID_LANGS.has(forceLang) ? forceLang : null

  const langHint = validLang
    ? validLang === 'es'
      ? 'O texto está em espanhol. Traduza para português brasileiro informal.'
      : 'O texto está em português. Traduza para espanhol de Madrid, natural e coloquial.'
    : 'Detecte o idioma (espanhol ou português) e traduza: se for espanhol, devolva em português brasileiro informal; se for português, devolva em espanhol de Madrid, natural e coloquial.'

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
Estilo do espanhol: o que falam em Madrid no dia a dia — tuteo ("tío", "tía", "mola", "venga", "jolín", "qué pasa?", "guay", "mogollón", "flipar"), descontraído, direto, sem formalidade. Nada de espanhol neutro ou latinoamericano. NUNCA use pontuação invertida (¡ e ¿).
Estilo do português: português brasileiro informal, como se fala — contrações naturais ("tá", "tô", "pra", "pro", "tava", "numa", "num"), linguagem viva, sem rebuscamento.
${langHint}
Responda APENAS com JSON: {"translation":"...","detected":"es" ou "pt"}
Sem explicações, sem markdown, só o JSON.`,
        messages: [{ role: 'user', content: text }]
      })
    })

    // Fix #1: check response.ok before parsing — catches 401/429/529 from Anthropic
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      console.error('Anthropic API error:', response.status, errData)
      return res.status(502).json({ error: 'Serviço de tradução indisponível.' })
    }

    const data = await response.json()
    const raw = data.content?.find(b => b.type === 'text')?.text || ''

    // Fix #7: parse JSON separately so failures are diagnosable, then validate shape
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
