export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  res.setHeader('Cache-Control', 'no-store')
  const openai = Boolean(process.env.OPENAI_API_KEY)
  res.status(200).json({
    translate: Boolean(process.env.ANTHROPIC_API_KEY),
    speech: openai,
    live: openai,
  })
}
