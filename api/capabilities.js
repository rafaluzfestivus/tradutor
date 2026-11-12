import { capabilitiesFor, isOpenAiAuthStatus, TRANSCRIBE_MODEL } from '../lib/conversation.js'

async function probeOpenAi() {
  try {
    const response = await fetch(`https://api.openai.com/v1/models/${TRANSCRIBE_MODEL}`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    })
    if (response.ok) return 'ok'
    if (isOpenAiAuthStatus(response.status)) return 'expired'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  res.setHeader('Cache-Control', 'no-store')
  const translate = Boolean(process.env.ANTHROPIC_API_KEY)
  if (!process.env.OPENAI_API_KEY) {
    res.status(200).json(capabilitiesFor({ translate, openai: 'missing' }))
    return
  }
  const openai = await probeOpenAi()
  res.status(200).json(capabilitiesFor({ translate, openai }))
}
