import assert from 'node:assert/strict'
import test from 'node:test'
import { applyLiveEvent, buildAnthropicRequest, normalizeHistory, parseTranslation, polishTranslation, readEphemeralToken, TRANSLATION_MODEL } from '../lib/conversation.js'
import capabilities from '../api/capabilities.js'
import liveCall from '../api/live-call.js'
import speak from '../api/speak.js'
import transcribe from '../api/transcribe.js'
import translate from '../api/translate.js'

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; return this },
    status(code) { this.statusCode = code; return this },
    json(data) { this.body = data; return this },
    end() { return this },
  }
}

test('everyday Spanish drops inverted punctuation and keeps names', () => {
  assert.equal(polishTranslation('¿Dónde está João?', 'es'), 'Dónde está João?')
  assert.equal(polishTranslation('não, amanhã', 'pt'), 'não, amanhã')
})

test('parseTranslation reads fenced and messy JSON', () => {
  assert.deepEqual(parseTranslation('```json\n{"translation":"hola","detected":"pt"}\n```'), {
    translation: 'hola',
    detected: 'pt',
  })
  assert.equal(parseTranslation('Claro: {"translation":"oi","detected":"es"}').translation, 'oi')
  assert.equal(parseTranslation('sem json'), null)
})

test('history context is capped and the model request stays on Haiku 5.5', () => {
  const history = Array.from({ length: 8 }, (_, i) => ({
    sourceLang: i % 2 ? 'es' : 'pt',
    original: 'frase ' + i,
    translation: 'frase traduzida ' + i,
  }))
  const request = buildAnthropicRequest({ text: 'sim', sourceLang: 'pt', history })
  assert.equal(request.model, TRANSLATION_MODEL)
  assert.equal(request.temperature, undefined)
  assert.equal(request.top_p, undefined)
  assert.equal(request.thinking.type, 'disabled')
  assert.equal(request.output_config.effort, 'low')
  assert.equal(normalizeHistory(history).length, 6)
  assert.match(request.messages[0].content, /frase 7/)
  assert.doesNotMatch(request.messages[0].content, /frase 0/)
  assert.match(request.messages[0].content, /Idioma de origem: pt/)
  assert.match(request.messages[0].content, /sim/)
})

test('translate handler calls Haiku and forces the mic language', async () => {
  const previous = process.env.ANTHROPIC_API_KEY
  const previousFetch = globalThis.fetch
  process.env.ANTHROPIC_API_KEY = 'test-key'
  let sent
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body)
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: '{"translation":"hola","detected":"es"}' }] }),
    }
  }
  try {
    const res = mockRes()
    await translate({
      method: 'POST',
      body: { text: 'oi', sourceLang: 'pt', history: [{ sourceLang: 'es', original: '¿y él?', translation: 'e ele?' }] },
    }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.translation, 'hola')
    assert.equal(res.body.detected, 'pt')
    assert.equal(res.body.target, 'es')
    assert.equal(sent.model, 'claude-haiku-5-5')
    assert.equal('temperature' in sent, false)
    assert.match(sent.messages[0].content, /e ele\?/)
  } finally {
    process.env.ANTHROPIC_API_KEY = previous
    globalThis.fetch = previousFetch
  }
})

test('missing keys degrade without calling the providers', async () => {
  const anthropic = process.env.ANTHROPIC_API_KEY
  const openai = process.env.OPENAI_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.OPENAI_API_KEY
  const previousFetch = globalThis.fetch
  let called = false
  globalThis.fetch = async () => { called = true }
  try {
    const caps = mockRes()
    capabilities({ method: 'GET' }, caps)
    assert.deepEqual(caps.body, { translate: false, speech: false, live: false })

    const translated = mockRes()
    await translate({ method: 'POST', body: { text: 'oi' } }, translated)
    assert.equal(translated.statusCode, 503)

    const heard = mockRes()
    await transcribe({ method: 'POST', body: { audio: 'YQ==', language: 'pt' } }, heard)
    assert.equal(heard.statusCode, 503)

    const spoken = mockRes()
    await speak({ method: 'POST', body: { text: 'oi', language: 'pt' } }, spoken)
    assert.equal(spoken.statusCode, 503)

    const live = mockRes()
    await liveCall({ method: 'POST', body: { targetLanguage: 'es', sdp: 'v=0\r\n' } }, live)
    assert.equal(live.statusCode, 503)
    assert.equal(called, false)
  } finally {
    if (anthropic === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = anthropic
    if (openai === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = openai
    globalThis.fetch = previousFetch
  }
})

test('ephemeral token is accepted in every documented shape', () => {
  assert.equal(readEphemeralToken({ value: 'ek_value' }), 'ek_value')
  assert.equal(readEphemeralToken({ client_secret: 'ek_string' }), 'ek_string')
  assert.equal(readEphemeralToken({ client_secret: { value: 'ek_nested' } }), 'ek_nested')
  assert.equal(readEphemeralToken({}), null)
})

test('live transcript deltas accumulate and a final transcript replaces them', () => {
  let state = applyLiveEvent({ input: '', output: '' }, { type: 'session.input_transcript.delta', delta: 'olá' })
  state = applyLiveEvent(state, { type: 'session.output_transcript.delta', delta: 'hola' })
  assert.equal(state.input, 'olá')
  assert.equal(state.output, 'hola')
  state = applyLiveEvent(state, { type: 'session.input_transcript.done', transcript: 'olá, tudo bem?' })
  assert.equal(state.input, 'olá, tudo bem?')
})

test('live call rejects a bad language before using the key', async () => {
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-key'
  const previousFetch = globalThis.fetch
  let called = false
  globalThis.fetch = async () => { called = true }
  try {
    const res = mockRes()
    await liveCall({ method: 'POST', body: { targetLanguage: 'fr', sdp: 'v=0\r\n' } }, res)
    assert.equal(res.statusCode, 400)
    assert.equal(called, false)
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
    globalThis.fetch = previousFetch
  }
})
