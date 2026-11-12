import assert from 'node:assert/strict'
import test from 'node:test'
import { startBrowserLive } from '../src/speech.js'

function installRecognition() {
  const sessions = []
  class FakeRecognition {
    constructor() {
      this.lang = ''
      this.started = false
      sessions.push(this)
    }
    start() { this.started = true }
    stop() { this.onend?.() }
  }
  globalThis.window = {
    SpeechRecognition: FakeRecognition,
    speechSynthesis: { cancel() {} },
  }
  return sessions
}

test('browser live translates a phrase and listens next in the other language', async () => {
  const sessions = installRecognition()
  const events = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.equal(body.text, 'olá, bom dia')
    assert.equal(body.sourceLang, 'pt')
    return { ok: true, json: async () => ({ translation: 'hola, buenos días', detected: 'pt' }) }
  }
  try {
    const live = startBrowserLive({
      initialLang: 'pt',
      onEvent: (event) => events.push(event),
    })
    assert.equal(sessions[0].lang, 'pt-BR')
    assert.equal(sessions[0].started, true)
    sessions[0].onresult({ results: [[{ transcript: 'olá, bom dia' }]] })
    await new Promise(resolve => setTimeout(resolve, 30))
    const turn = events.find(event => event.type === 'turn')
    assert.equal(turn.original, 'olá, bom dia')
    assert.equal(turn.translation, 'hola, buenos días')
    assert.equal(turn.sourceLang, 'pt')
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(sessions.at(-1).lang, 'es-ES')
    assert.equal(sessions.at(-1).started, true)
    live.stop()
  } finally {
    globalThis.fetch = previousFetch
    delete globalThis.window
  }
})
