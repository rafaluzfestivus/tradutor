import { useState, useRef } from 'react'
import './App.css'

const MicIcon = ({ active }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
)

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
)

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

const ClearIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const ArrowIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <polyline points="19 12 12 19 5 12"/>
  </svg>
)

const LANGS = {
  es: { flag: '🇪🇸', label: 'Espanhol' },
  pt: { flag: '🇧🇷', label: 'Português' },
}

export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [copied, setCopied] = useState(false)
  const [detectedLang, setDetectedLang] = useState(null)
  const [forceLang, setForceLang] = useState(null)

  // Fix #3 + #5: refs keep closures (debounce, mic onresult) reading the current value
  const forceLangRef = useRef(null)
  const detectedLangRef = useRef(null)
  const recognitionRef = useRef(null)
  const debounceRef = useRef(null)
  // Fix #4: AbortController lets us cancel the previous in-flight request
  const abortRef = useRef(null)

  const clearOutput = () => {
    setOutput('')
    setDetectedLang(null)
    detectedLangRef.current = null
  }

  const translate = async (text, force) => {
    if (!text.trim()) { clearOutput(); return }

    // Cancel any previous request so stale responses never overwrite the latest
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, forceLang: force }),
        signal: controller.signal,
      })
      // Fix #1 (frontend side): surface server errors instead of silently showing blank
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.translation) throw new Error('bad response shape')
      setOutput(data.translation)
      setDetectedLang(data.detected || null)
      detectedLangRef.current = data.detected || null
    } catch (err) {
      // AbortError means a newer request took over — leave loading/output untouched
      if (err.name === 'AbortError') return
      setOutput('Deu ruim! Verifica a internet e tenta de novo.')
    }
    setLoading(false)
  }

  const handleInput = (val) => {
    setInput(val)
    clearTimeout(debounceRef.current)
    if (!val.trim()) { clearOutput(); return }
    // Fix #3: read forceLangRef.current at fire time, not at schedule time
    debounceRef.current = setTimeout(() => translate(val, forceLangRef.current), 700)
  }

  const handleForce = (lang) => {
    const next = forceLang === lang ? null : lang
    forceLangRef.current = next
    setForceLang(next)
    if (input.trim()) translate(input, next)
  }

  const startRecording = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Teu navegador não manja de voz. Tenta no Chrome!'); return }
    const r = new SR()
    // Fix #5: use detectedLangRef so mic honors auto-detected language, not just forced one
    const langKey = forceLangRef.current || detectedLangRef.current
    r.lang = langKey === 'pt' ? 'pt-BR' : 'es-ES'
    r.onresult = (e) => {
      const t = e.results[0][0].transcript
      setInput(t)
      // Fix #3: read forceLangRef.current at result time, not at recording-start time
      translate(t, forceLangRef.current)
    }
    const stop = () => setRecording(false)
    r.onend = stop
    r.onerror = stop
    r.start()
    recognitionRef.current = r
    setRecording(true)
  }

  const stopRecording = () => { recognitionRef.current?.stop(); setRecording(false) }

  // Fix #6: await clipboard write before showing "Copiado!" — don't flash if it fails
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // write failed (HTTP page, tab not focused, etc.) — stay silent
    }
  }

  const inputLangKey = forceLang || detectedLang
  const targetLangKey = inputLangKey === 'es' ? 'pt' : inputLangKey === 'pt' ? 'es' : null

  return (
    <div className="app">
      <header className="header">
        <h1>Tradutor ES ↔ PT</h1>
        <p>Espanhol de Madrid · Português do Brasil</p>
      </header>

      <main className="main">

        <div className="lang-bar">
          <span className="lang-bar-label">De:</span>
          {Object.entries(LANGS).map(([code, { flag, label }]) => (
            <button
              key={code}
              className={`lang-pill${forceLang === code ? ' active' : ''}`}
              onClick={() => handleForce(code)}
            >
              <span>{flag}</span> {label}
            </button>
          ))}
        </div>

        <div className="card">
          <div className="card-header">
            {inputLangKey ? (
              <span className="card-lang">
                <span className="card-lang-flag">{LANGS[inputLangKey]?.flag}</span>
                {LANGS[inputLangKey]?.label}
                {!forceLang && detectedLang && <span className="detected-badge">detectado</span>}
              </span>
            ) : (
              <span className="card-lang">Digita ou fala...</span>
            )}
          </div>
          <div className="card-body">
            <textarea
              value={input}
              onChange={e => handleInput(e.target.value)}
              placeholder="Fala aí, no idioma que quiser..."
              rows={5}
            />
          </div>
          <div className="card-footer">
            <button
              className={`btn-mic${recording ? ' recording' : ''}`}
              onClick={recording ? stopRecording : startRecording}
            >
              <MicIcon active={recording} />
              {recording ? 'Para aí' : 'Falar'}
            </button>
            <div className="spacer" />
            {input && (
              <button className="btn-clear" onClick={() => { setInput(''); clearOutput() }}>
                <ClearIcon /> Limpar
              </button>
            )}
          </div>
        </div>

        <div className="divider">
          <ArrowIcon />
        </div>

        <div className="card">
          <div className="card-header">
            {targetLangKey ? (
              <span className="card-lang">
                <span className="card-lang-flag">{LANGS[targetLangKey].flag}</span>
                {LANGS[targetLangKey].label}
              </span>
            ) : (
              <span className="card-lang">Tradução</span>
            )}
          </div>
          <div className="card-body">
            {loading ? (
              <div className="loading-dots">
                <span /><span /><span />
              </div>
            ) : output ? (
              <div className="output-text">{output}</div>
            ) : (
              <div className="output-placeholder">A tradução vai aparecer aqui...</div>
            )}
          </div>
          {output && !loading && (
            <div className="card-footer">
              <div className="spacer" />
              <button className={`btn-copy${copied ? ' copied' : ''}`} onClick={copy}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          )}
        </div>

        <div className="footer">Powered by Claude · Anthropic</div>
      </main>
    </div>
  )
}
