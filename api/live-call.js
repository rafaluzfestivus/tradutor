import { buildLiveSession, readEphemeralToken, upstreamErrorMessage } from '../lib/conversation.js'

const TARGETS = new Set(['es', 'pt'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'Modo ao vivo indisponível: falta a chave da OpenAI na Vercel.' })
  }

  const { targetLanguage, sdp } = req.body || {}
  if (!TARGETS.has(targetLanguage)) {
    return res.status(400).json({ error: 'Idioma de saída inválido.' })
  }
  if (typeof sdp !== 'string' || sdp.length < 20 || sdp.length > 100_000) {
    return res.status(400).json({ error: 'Conexão de áudio inválida.' })
  }

  try {
    const secretRes = await fetch('https://api.openai.com/v1/realtime/translations/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': 'tradutor-app',
      },
      body: JSON.stringify({ session: buildLiveSession(targetLanguage) }),
    })

    const secretJson = await secretRes.json().catch(() => ({}))
    const token = readEphemeralToken(secretJson)
    if (!secretRes.ok || !token) {
      const detail = upstreamErrorMessage(secretJson, secretRes.status)
      console.error('Live secret failed:', secretRes.status, detail)
      return res.status(502).json({ error: 'Não consegui abrir o modo ao vivo.', detail })
    }

    const callRes = await fetch('https://api.openai.com/v1/realtime/translations/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/sdp',
        'OpenAI-Safety-Identifier': 'tradutor-app',
      },
      body: sdp,
    })

    const answer = await callRes.text()
    if (!callRes.ok || !answer.includes('v=0')) {
      let detail = `OpenAI respondeu ${callRes.status}`
      try {
        detail = upstreamErrorMessage(JSON.parse(answer), callRes.status)
      } catch {
        if (answer && !answer.includes('v=0')) detail = 'A resposta de áudio não veio no formato esperado.'
      }
      console.error('Live call failed:', callRes.status, detail)
      return res.status(502).json({ error: 'Não consegui conectar o áudio ao vivo.', detail })
    }

    res.status(200).json({ answer })
  } catch (err) {
    console.error('Live call error:', err?.message || err)
    res.status(500).json({ error: 'Deu ruim no modo ao vivo.' })
  }
}
