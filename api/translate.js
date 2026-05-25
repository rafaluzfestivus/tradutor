export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { text, forceLang } = req.body

  const langHint = forceLang
    ? forceLang === 'es'
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

    const data = await response.json()
    const raw = data.content?.find(b => b.type === 'text')?.text || '{}'
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
    res.status(200).json(parsed)
  } catch (err) {
    res.status(500).json({ error: 'Deu ruim na tradução.' })
  }
}
