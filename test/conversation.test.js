import assert from 'node:assert/strict'
import test from 'node:test'
import { applyLiveEvent, buildAnthropicRequest, buildLiveSession, buildTranslationPrompt, chooseLiveTarget, createEndpoint, detectSpokenLang, emptyLiveBuffers, languageFromTranscript, liveDirectionTarget, parseTranslation, polishTranslation, readEphemeralToken, stepEndpoint, TRANSLATION_MODEL, translationRepeatsSource, UTTERANCE_LIMIT_MS } from '../lib/conversation.js'
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

test('each translation is independent and stays on Haiku 5.5', () => {
  const request = buildAnthropicRequest({
    text: 'sim',
    sourceLang: 'pt',
    history: [{ original: 'frase antiga', translation: 'frase vieja' }],
  })
  assert.equal(request.model, TRANSLATION_MODEL)
  assert.equal(request.temperature, undefined)
  assert.equal(request.top_p, undefined)
  assert.equal(request.thinking.type, 'disabled')
  assert.equal(request.output_config.effort, 'low')
  assert.match(request.messages[0].content, /Idioma de origem: pt/)
  assert.match(request.messages[0].content, /sim/)
  assert.doesNotMatch(request.messages[0].content, /frase antiga/)
  assert.doesNotMatch(request.messages[0].content, /frase vieja/)
  assert.doesNotMatch(request.messages[0].content, /Contexto/)
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
    assert.match(sent.messages[0].content, /oi/)
    assert.doesNotMatch(sent.messages[0].content, /e ele/)
    assert.equal(sent.messages[0].content, buildTranslationPrompt({ text: 'oi', sourceLang: 'pt' }))
  } finally {
    process.env.ANTHROPIC_API_KEY = previous
    globalThis.fetch = previousFetch
  }
})

const USER_PT = 'Vendo o povo se matar no brasil por causa de politica.'
const USER_PT_ES = 'Viendo a la gente matarse en Brasil por culpa de la política.'

test('typed Portuguese is sent to Spanish even without a source language', async () => {
  const previous = process.env.ANTHROPIC_API_KEY
  const previousFetch = globalThis.fetch
  process.env.ANTHROPIC_API_KEY = 'test-key'
  const sent = []
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body))
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ translation: USER_PT_ES, detected: 'es' }) }] }),
    }
  }
  try {
    const res = mockRes()
    await translate({
      method: 'POST',
      body: { text: USER_PT, history: [{ original: 'frase antiga', translation: 'frase vieja' }] },
    }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.translation, USER_PT_ES)
    assert.equal(res.body.detected, 'pt')
    assert.equal(res.body.target, 'es')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].messages[0].content, buildTranslationPrompt({ text: USER_PT, sourceLang: 'pt' }))
    assert.doesNotMatch(sent[0].messages[0].content, /frase antiga/)
    assert.doesNotMatch(JSON.stringify(sent[0]), /history/)
  } finally {
    process.env.ANTHROPIC_API_KEY = previous
    globalThis.fetch = previousFetch
  }
})

test('typed Spanish is sent to Portuguese even without a source language', async () => {
  const previous = process.env.ANTHROPIC_API_KEY
  const previousFetch = globalThis.fetch
  process.env.ANTHROPIC_API_KEY = 'test-key'
  let sent
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body)
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '{"translation":"Onde fica o banheiro?","detected":"pt"}' }] }),
    }
  }
  try {
    const res = mockRes()
    await translate({ method: 'POST', body: { text: 'Donde esta el bano?' } }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.translation, 'Onde fica o banheiro?')
    assert.equal(res.body.detected, 'es')
    assert.equal(res.body.target, 'pt')
    assert.equal(sent.messages[0].content, buildTranslationPrompt({ text: 'Donde esta el bano?', sourceLang: 'es' }))
  } finally {
    process.env.ANTHROPIC_API_KEY = previous
    globalThis.fetch = previousFetch
  }
})

test('typed Spanish congratulations ask for Portuguese', async () => {
  const previous = process.env.ANTHROPIC_API_KEY
  const previousFetch = globalThis.fetch
  process.env.ANTHROPIC_API_KEY = 'test-key'
  const text = 'Ganó Lula! Enhorabuena no?'
  const translation = 'Lula ganhou! Parabéns, né?'
  const sent = []
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body))
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ translation, detected: 'pt' }) }] }),
    }
  }
  try {
    const res = mockRes()
    await translate({
      method: 'POST',
      body: { text, history: [{ original: 'frase antiga', translation: 'frase vieja' }] },
    }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.translation, translation)
    assert.equal(res.body.detected, 'es')
    assert.equal(res.body.target, 'pt')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].messages[0].content, buildTranslationPrompt({ text, sourceLang: 'es' }))
    assert.doesNotMatch(sent[0].messages[0].content, /frase antiga/)
    assert.doesNotMatch(JSON.stringify(sent[0]), /history/)
  } finally {
    process.env.ANTHROPIC_API_KEY = previous
    globalThis.fetch = previousFetch
  }
})

test('an explicit mic language wins over the written-language guess', async () => {
  const previous = process.env.ANTHROPIC_API_KEY
  const previousFetch = globalThis.fetch
  process.env.ANTHROPIC_API_KEY = 'test-key'
  let sent
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body)
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '{"translation":"Já estava em português.","detected":"es"}' }] }),
    }
  }
  try {
    const res = mockRes()
    await translate({ method: 'POST', body: { text: USER_PT, sourceLang: 'es' } }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.detected, 'es')
    assert.equal(res.body.target, 'pt')
    assert.equal(sent.messages[0].content, buildTranslationPrompt({ text: USER_PT, sourceLang: 'es' }))
  } finally {
    process.env.ANTHROPIC_API_KEY = previous
    globalThis.fetch = previousFetch
  }
})

test('a same-language paraphrase is retried with an explicit target', async () => {
  const previous = process.env.ANTHROPIC_API_KEY
  const previousFetch = globalThis.fetch
  process.env.ANTHROPIC_API_KEY = 'test-key'
  const replies = [
    '{"translation":"Vendo a gente se matar no Brasil por causa de política.","detected":"pt"}',
    JSON.stringify({ translation: USER_PT_ES, detected: 'pt' }),
  ]
  const sent = []
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body))
    const text = replies[sent.length - 1]
    return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) }
  }
  try {
    const res = mockRes()
    await translate({ method: 'POST', body: { text: USER_PT } }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.translation, USER_PT_ES)
    assert.equal(res.body.detected, 'pt')
    assert.equal(res.body.target, 'es')
    assert.equal(sent.length, 2)
    assert.equal(sent[1].messages[0].content, buildTranslationPrompt({ text: USER_PT, sourceLang: 'pt', strict: true }))
    assert.match(sent[1].messages[0].content, /tentativa anterior/)
    assert.doesNotMatch(sent[0].messages[0].content, /tentativa anterior/)
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

test('spoken language detects Portuguese and Spanish without a fixed direction', () => {
  assert.equal(detectSpokenLang('Olá, bom dia. Onde está o João?'), 'pt')
  assert.equal(detectSpokenLang('cadê ele?'), 'pt')
  assert.equal(detectSpokenLang('não, amanhã'), 'pt')
  assert.equal(detectSpokenLang('sim'), 'pt')
  assert.equal(detectSpokenLang('Hola, buenos días. Dónde está João?'), 'es')
  assert.equal(detectSpokenLang('gracias'), 'es')
  assert.equal(detectSpokenLang('no, mañana'), 'es')
  assert.equal(detectSpokenLang('sí'), 'es')
  assert.equal(detectSpokenLang('ok'), null)
  assert.equal(detectSpokenLang('Vendo o povo se matar no brasil por causa de politica.'), 'pt')
  assert.equal(detectSpokenLang('Quero um cafe sem acucar, por favor.'), 'pt')
  assert.equal(detectSpokenLang('Amanha eu vou para o trabalho de onibus.'), 'pt')
  assert.equal(detectSpokenLang('Onde fica o banheiro?'), 'pt')
  assert.equal(detectSpokenLang('A casa é grande.'), 'pt')
  assert.equal(detectSpokenLang('La casa es grande.'), 'es')
  assert.equal(detectSpokenLang('Estoy viendo a la gente matarse en Brasil por la politica.'), 'es')
  assert.equal(detectSpokenLang('Quiero un cafe sin azucar, por favor.'), 'es')
  assert.equal(detectSpokenLang('Donde esta el bano?'), 'es')
  assert.equal(detectSpokenLang('Ganó Lula! Enhorabuena no?'), 'es')
  assert.equal(detectSpokenLang('Enhorabuena'), 'es')
  assert.equal(detectSpokenLang('O Lula ganhou! Parabéns!'), 'pt')
  assert.equal(detectSpokenLang('Manana voy al trabajo en autobus.'), 'es')
  assert.equal(detectSpokenLang('Puedes ayudarme con esto ahora?'), 'es')
  assert.equal(detectSpokenLang('No entendi lo que dijo en la reunion.'), 'es')
  assert.equal(detectSpokenLang('Brasil'), null)
})

test('ambiguous text still names both target languages', () => {
  const prompt = buildTranslationPrompt({ text: 'Brasil' })
  assert.match(prompt, /Se o texto estiver em português, traduza para espanhol da Espanha/)
  assert.match(prompt, /Se o texto estiver em espanhol, traduza para português do Brasil/)
  assert.doesNotMatch(prompt, /Idioma de origem: pt\./)
  assert.doesNotMatch(prompt, /tentativa anterior/)
})

test('same-language echoes are not treated as translations', () => {
  assert.equal(translationRepeatsSource(
    'Vendo o povo se matar no brasil por causa de politica.',
    'Vendo a gente se matar no Brasil por causa de política.',
  ), true)
  assert.equal(translationRepeatsSource(
    'Amanha eu vou para o trabalho de onibus.',
    'Amanhã eu vou para o trabalho de ônibus.',
  ), true)
  assert.equal(translationRepeatsSource(
    'Quero um cafe sem acucar, por favor.',
    'Quero um café sem açúcar, por favor.',
  ), true)
  assert.equal(translationRepeatsSource('Onde fica o banheiro?', 'Onde fica o banheiro?'), true)
  assert.equal(translationRepeatsSource(
    'Vendo o povo se matar no brasil por causa de politica.',
    'Viendo a la gente matarse en Brasil por culpa de la política.',
  ), false)
  assert.equal(translationRepeatsSource(
    'Estoy viendo a la gente matarse en Brasil por la política.',
    'Estou vendo as pessoas se matando no Brasil por causa da política.',
  ), false)
  assert.equal(translationRepeatsSource('oi', 'hola'), false)
  assert.equal(translationRepeatsSource('Bom dia, tudo bem?', 'Buenos días, todo bien?'), false)
})

test('live direction follows whichever language was just spoken', () => {
  const buffers = emptyLiveBuffers()
  buffers.es.input = 'Olá, bom dia. Onde está o João?'
  buffers.pt.input = 'Olá, bom dia. Onde está o João?'
  assert.equal(chooseLiveTarget(buffers), 'es')
  assert.equal(liveDirectionTarget(buffers, null), 'es')
  assert.equal(liveDirectionTarget(buffers, 'es'), 'es')
  buffers.es.input = 'Hola, buenos días. Dónde está João?'
  buffers.pt.input = 'Hola, buenos días. Dónde está João?'
  assert.equal(liveDirectionTarget(buffers, 'es'), 'pt')
})

test('live session is one output language at a time, for a table mic', () => {
  const session = buildLiveSession('pt')
  assert.equal(session.model, 'gpt-realtime-translate')
  assert.equal(session.audio.output.language, 'pt')
  assert.equal(session.audio.input.transcription.model, 'gpt-realtime-whisper')
  assert.equal(session.audio.input.noise_reduction.type, 'far_field')
  assert.equal(buildLiveSession('es').audio.output.language, 'es')
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

test('live call asks OpenAI for the chosen output language only', async () => {
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-key'
  const previousFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: options.body })
    if (String(url).includes('client_secrets')) {
      return { ok: true, json: async () => ({ value: 'ek_test' }) }
    }
    return { ok: true, text: async () => 'v=0\r\n' }
  }
  try {
    const res = mockRes()
    const sdp = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n'
    await liveCall({ method: 'POST', body: { targetLanguage: 'pt', sdp } }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.answer, 'v=0\r\n')
    const secret = JSON.parse(calls[0].body)
    assert.equal(secret.session.audio.output.language, 'pt')
    assert.equal(secret.session.audio.input.noise_reduction.type, 'far_field')
    assert.match(calls[1].url, /\/realtime\/translations\/calls$/)
    assert.equal(calls[1].body, sdp)
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
    globalThis.fetch = previousFetch
  }
})

test('transcribe can detect the language when the mic is shared', async () => {
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-key'
  const previousFetch = globalThis.fetch
  const bodies = []
  globalThis.fetch = async (_url, options) => {
    bodies.push(options.body)
    return { ok: true, json: async () => ({ text: 'hola, buenos días', language: 'spanish' }) }
  }
  try {
    const forced = mockRes()
    await transcribe({ method: 'POST', body: { audio: 'YQ==', mime: 'audio/webm', language: 'pt' } }, forced)
    assert.equal(forced.statusCode, 200)
    assert.equal(forced.body.language, 'pt')
    assert.equal(bodies[0].get('languages[]'), 'pt')

    const open = mockRes()
    await transcribe({ method: 'POST', body: { audio: 'YQ==', mime: 'audio/wav' } }, open)
    assert.equal(open.statusCode, 200)
    assert.equal(open.body.text, 'hola, buenos días')
    assert.equal(open.body.language, 'es')
    assert.equal(bodies[1].get('languages[]'), null)

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ text: 'ok', languages: [{ code: 'es' }] }),
    })
    const listed = mockRes()
    await transcribe({ method: 'POST', body: { audio: 'YQ==', mime: 'audio/mp4' } }, listed)
    assert.equal(listed.statusCode, 200)
    assert.equal(listed.body.language, 'es')
    assert.equal(languageFromTranscript({ text: 'ok' }, 'ok'), null)
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
    globalThis.fetch = previousFetch
  }
})

function runEndpoint(levels) {
  let state = createEndpoint(0)
  const actions = []
  for (const [time, level] of levels) {
    const step = stepEndpoint(state, level, time)
    state = step.state
    if (step.action) actions.push({ action: step.action, time })
  }
  return { state, actions }
}

test('live mode starts on speech and ends on a short pause', () => {
  const quiet = []
  for (let time = 0; time <= 500; time += 80) quiet.push([time, 0.004])
  for (let time = 580; time <= 1100; time += 80) quiet.push([time, 0.08])
  quiet.push([1180, 0.03])
  for (let time = 1260; time <= 2000; time += 80) quiet.push([time, 0.004])
  const { actions } = runEndpoint(quiet)
  assert.equal(actions[0]?.action, 'start')
  assert.ok(actions[0].time < 1000)
  assert.equal(actions.at(-1)?.action, 'stop')
  assert.ok(actions.at(-1).time - actions[0].time < 2000)
})

test('room noise alone does not open a live utterance', () => {
  const noise = []
  for (let time = 0; time <= 3000; time += 80) noise.push([time, 0.03])
  const { actions } = runEndpoint(noise)
  assert.deepEqual(actions, [])
})

test('continuous speech is cut well before the old twenty second wait', () => {
  const speech = []
  for (let time = 0; time <= 400; time += 80) speech.push([time, 0.005])
  for (let time = 480; time <= 480 + UTTERANCE_LIMIT_MS + 600; time += 100) speech.push([time, 0.1])
  const { actions } = runEndpoint(speech)
  assert.equal(actions[0]?.action, 'start')
  assert.equal(actions[1]?.action, 'stop')
  assert.ok(actions[1].time - actions[0].time <= UTTERANCE_LIMIT_MS + 150)
  assert.ok(actions[1].time < 20000)
})
