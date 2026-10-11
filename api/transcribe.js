import { MAX_AUDIO_BASE64, TRANSCRIBE_MODEL } from '../lib/conversation.js'

const LANGS = {
  pt: {
    code: 'pt',
    prompt: 'Conversa cotidiana em português do Brasil.',
  },
  es: {
    code: 'es',
    prompt: 'Conversación cotidiana en español de España.',
  },
}

function extensionFor(mime) {
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('aac') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  return 'webm'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'Microfone indisponível: falta a chave da OpenAI na Vercel.' })
  }

  const { audio, mime, language } = req.body || {}
  const lang = LANGS[language]
  if (!lang) return res.status(400).json({ error: 'Idioma do microfone inválido.' })
  if (typeof audio !== 'string' || !audio) return res.status(400).json({ error: 'Áudio ausente.' })
  if (audio.length > MAX_AUDIO_BASE64) return res.status(413).json({ error: 'Áudio longo demais. Fala em partes menores.' })

  const cleanMime = typeof mime === 'string' && mime.startsWith('audio/')
    ? mime.split(';')[0]
    : 'audio/webm'

  try {
    const bytes = Buffer.from(audio, 'base64')
    if (!bytes.length) return res.status(400).json({ error: 'Áudio vazio.' })

    const form = new FormData()
    form.append('file', new Blob([bytes], { type: cleanMime }), `fala.${extensionFor(cleanMime)}`)
    form.append('model', TRANSCRIBE_MODEL)
    form.append('languages[]', lang.code)
    form.append('prompt', lang.prompt)

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    })

    if (!response.ok) {
      console.error('Transcribe error:', response.status)
      return res.status(502).json({ error: 'Não consegui entender o áudio.' })
    }

    const data = await response.json()
    res.status(200).json({ text: typeof data.text === 'string' ? data.text.trim() : '' })
  } catch (err) {
    console.error('Transcribe failed:', err?.message || err)
    res.status(500).json({ error: 'Deu ruim ao ouvir o áudio.' })
  }
}
