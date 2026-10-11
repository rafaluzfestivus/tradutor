import { MAX_TEXT_LENGTH, SPEECH_MODEL } from '../lib/conversation.js'

const VOICES = {
  pt: {
    voice: 'cedar',
    instructions: 'Fale em português do Brasil, com voz humana e clara, ritmo de conversa, sem ler a pontuação.',
  },
  es: {
    voice: 'marin',
    instructions: 'Habla en español de España, con voz humana y clara, ritmo de conversación, sin leer la puntuación.',
  },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'Voz indisponível: falta a chave da OpenAI na Vercel.' })
  }

  const { text, language } = req.body || {}
  const voice = VOICES[language]
  if (!voice) return res.status(400).json({ error: 'Idioma da voz inválido.' })
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Texto ausente.' })
  if (text.length > MAX_TEXT_LENGTH) return res.status(400).json({ error: 'Texto muito longo.' })

  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: SPEECH_MODEL,
        voice: voice.voice,
        input: text.trim(),
        instructions: voice.instructions,
        response_format: 'mp3',
      }),
    })

    if (!response.ok) {
      console.error('Speech error:', response.status)
      return res.status(502).json({ error: 'Não consegui gerar a voz.' })
    }

    const audio = Buffer.from(await response.arrayBuffer()).toString('base64')
    res.status(200).json({ audio, mime: 'audio/mpeg' })
  } catch (err) {
    console.error('Speech failed:', err?.message || err)
    res.status(500).json({ error: 'Deu ruim ao falar.' })
  }
}
