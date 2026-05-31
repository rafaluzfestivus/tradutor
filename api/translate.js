export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { text } = req.body

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

    const data = await response.json()
    const raw = data.content?.find(b => b.type === 'text')?.text || '{}'
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
    res.status(200).json(parsed)
  } catch {
    res.status(500).json({ error: 'Deu ruim na tradução.' })
  }
}
