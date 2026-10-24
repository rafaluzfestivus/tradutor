import { useEffect, useRef, useState } from 'react'
import { MAX_TEXT_LENGTH, polishTranslation, targetLang } from '../lib/conversation.js'
import {
  blobToBase64,
  browserSpeak,
  canRecord,
  micErrorMessage,
  openMic,
  playBase64Audio,
  startBrowserRecognition,
  startRecorder,
  startTableLive,
  stopPlayback,
  unlockAudio,
} from './speech.js'

const BR = {
  grad: 'linear-gradient(135deg,#009c3b,#4dc87a)',
  solid: '#009c3b', light: '#f0faf4', border: '#009c3b',
  text: '#005c23', badge: '#ffdf00', badgeText: '#5a4200', flag: '🇧🇷', name: 'Português',
}
const ES = {
  grad: 'linear-gradient(135deg,#aa151b,#e84040)',
  solid: '#aa151b', light: '#fdf2f2', border: '#aa151b',
  text: '#6b0d10', badge: '#f1bf00', badgeText: '#5a3d00', flag: '🇪🇸', name: 'Espanhol',
}

const themeFor = (lang) => (lang === 'pt' ? BR : lang === 'es' ? ES : null)

const MicIcon = ({ active }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
)

const SpeakerIcon = ({ muted }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
    {muted
      ? <><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></>
      : <><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></>}
  </svg>
)

export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [recordingSide, setRecordingSide] = useState(null)
  const [busySide, setBusySide] = useState(null)
  const [liveOn, setLiveOn] = useState(false)
  const [livePhase, setLivePhase] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const [detectedLang, setDetectedLang] = useState(null)
  const [caps, setCaps] = useState(null)
  const [seconds, setSeconds] = useState(0)

  const liveOnRef = useRef(false)
  const capsRef = useRef(null)
  const startingLive = useRef(false)
  const abortRef = useRef(null)
  const debounceRef = useRef(null)
  const recorderRef = useRef(null)
  const browserRef = useRef(null)
  const liveRef = useRef(null)
  const genRef = useRef(0)
  const speakGen = useRef(0)
  const outputRef = useRef(null)

  useEffect(() => {
    if (!output) return
    outputRef.current?.scrollIntoView({ block: 'nearest' })
  }, [output])

  useEffect(() => {
    try { localStorage.removeItem('tradutor.history.v1') } catch { /* private mode */ }
    window.speechSynthesis?.getVoices()
    const onVoices = () => window.speechSynthesis?.getVoices()
    window.speechSynthesis?.addEventListener?.('voiceschanged', onVoices)
    let cancelled = false
    fetch('/api/capabilities')
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        capsRef.current = data
        setCaps(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      window.speechSynthesis?.removeEventListener?.('voiceschanged', onVoices)
      genRef.current += 1
      clearTimeout(debounceRef.current)
      abortRef.current?.abort()
      recorderRef.current?.stop()
      browserRef.current?.stop()
      liveRef.current?.stop()
      stopPlayback()
    }
  }, [])

  async function ensureCaps() {
    if (capsRef.current) return capsRef.current
    try {
      const data = await fetch('/api/capabilities').then(res => res.json())
      capsRef.current = data
      setCaps(data)
      return data
    } catch {
      const fallback = { translate: false, speech: false, live: false }
      capsRef.current = fallback
      setCaps(fallback)
      return fallback
    }
  }

  async function speakTranslation(text, lang) {
    if (!text || !lang) return
    const generation = ++speakGen.current
    stopPlayback()
    liveRef.current?.setPaused(true)
    setSpeaking(true)
    try {
      const available = capsRef.current || await ensureCaps()
      let played = false
      if (available.speech) {
        try {
          const res = await fetch('/api/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, language: lang }),
          })
          const data = await res.json().catch(() => ({}))
          if (generation !== speakGen.current) return
          if (res.ok && data.audio) played = await playBase64Audio(data.audio, data.mime)
        } catch {
          /* phone voice below */
        }
      }
      if (!played && generation === speakGen.current) {
        await browserSpeak(text, lang)
      }
    } finally {
      if (generation === speakGen.current) {
        setSpeaking(false)
        liveRef.current?.setPaused(false)
      }
    }
  }

  async function translateText(text, sourceLang) {
    const trimmed = text.trim()
    if (!trimmed) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed.slice(0, MAX_TEXT_LENGTH),
          ...(sourceLang ? { sourceLang } : {}),
        }),
        signal: controller.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (controller.signal.aborted) return
      if (!res.ok) throw new Error(data.error || 'Deu ruim na tradução.')
      const detected = data.detected || sourceLang
      setOutput(data.translation || '')
      setDetectedLang(detected)
    } catch (err) {
      if (err.name === 'AbortError') return
      setOutput('')
      setDetectedLang(null)
      setError(err.message || 'Deu ruim! Verifica a internet e tenta de novo.')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  function handleInput(value) {
    const clamped = value.slice(0, MAX_TEXT_LENGTH)
    setInput(clamped)
    clearTimeout(debounceRef.current)
    if (!clamped.trim()) {
      abortRef.current?.abort()
      stopPlayback()
      setOutput('')
      setError(null)
      setDetectedLang(null)
      setLoading(false)
      setSpeaking(false)
      return
    }
    debounceRef.current = setTimeout(() => {
      translateText(clamped, null)
    }, 700)
  }

  function clearCurrent() {
    clearTimeout(debounceRef.current)
    abortRef.current?.abort()
    stopPlayback()
    setInput('')
    setOutput('')
    setError(null)
    setDetectedLang(null)
    setLoading(false)
    setSpeaking(false)
  }

  async function cancelCapture() {
    genRef.current += 1
    const recorder = recorderRef.current
    recorderRef.current = null
    browserRef.current?.stop()
    browserRef.current = null
    setRecordingSide(null)
    setSeconds(0)
    if (recorder) {
      try { await recorder.stop() } catch { /* already stopped */ }
    }
  }

  async function runServerRecording(side, sourceLang, generation) {
    setRecordingSide(side)
    setSeconds(0)
    const recorder = await startRecorder({
      maxMs: 45000,
      onTick: (elapsed) => {
        if (generation === genRef.current) setSeconds(Math.floor(elapsed / 1000))
      },
    })
    if (generation !== genRef.current) {
      recorder.stop()
      return
    }
    recorderRef.current = recorder
    const blob = await recorder.done
    recorderRef.current = null
    if (generation !== genRef.current) return
    setRecordingSide(null)
    setSeconds(0)
    if (!blob.size) {
      setError('Nenhuma fala detectada. Tente de novo.')
      return
    }
    setBusySide(side)
    setLoading(true)
    try {
      const audio = await blobToBase64(blob)
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio, mime: blob.type, language: sourceLang }),
      })
      const data = await res.json().catch(() => ({}))
      if (generation !== genRef.current) return
      if (!res.ok) throw new Error(data.error || 'Não consegui entender o áudio.')
      const text = (data.text || '').trim()
      if (!text) {
        setError('Nenhuma fala detectada. Tente de novo.')
        setLoading(false)
        return
      }
      setInput(text)
      await translateText(text, sourceLang)
    } catch (err) {
      if (generation === genRef.current) setError(err.message || 'Não consegui entender o áudio.')
      setLoading(false)
    } finally {
      if (generation === genRef.current) setBusySide(null)
    }
  }

  async function runBrowserRecording(side, sourceLang, generation) {
    const session = startBrowserRecognition(sourceLang)
    if (!session) {
      setError('Este navegador não oferece microfone. No iPhone, a chave da OpenAI libera o microfone. Dá para digitar mesmo assim.')
      return
    }
    browserRef.current = session
    setRecordingSide(side)
    try {
      const text = (await session.result).trim()
      if (generation !== genRef.current) return
      if (!text) {
        setError('Nenhuma fala detectada. Tente de novo.')
        return
      }
      setInput(text)
      await translateText(text, sourceLang)
    } catch (err) {
      if (generation === genRef.current) setError(micErrorMessage(err))
    } finally {
      if (generation === genRef.current) {
        browserRef.current = null
        setRecordingSide(null)
      }
    }
  }

  function applyTableEvent(event) {
    if (event.type === 'status' && event.phase) {
      setLivePhase(event.phase)
      if (event.phase === 'translating') setLoading(true)
      if (event.phase === 'listening') setLoading(false)
    }
    if (event.type === 'error' && event.message) {
      setError(event.message)
      setLoading(false)
    }
    if (event.type !== 'caption' && event.type !== 'turn') return
    const sourceLang = event.sourceLang === 'es' || event.sourceLang === 'pt' ? event.sourceLang : null
    if (sourceLang) setDetectedLang(sourceLang)
    if (event.original) setInput(event.original)
    if (event.translation) {
      setOutput(polishTranslation(event.translation, sourceLang ? targetLang(sourceLang) : null))
      setLoading(false)
      setError(null)
    }
  }

  function stopTableLive() {
    genRef.current += 1
    startingLive.current = false
    liveOnRef.current = false
    liveRef.current?.stop()
    liveRef.current = null
    setLiveOn(false)
    setLivePhase('')
  }

  async function handleMic(side) {
    unlockAudio()
    const sourceLang = side === 'you' ? 'es' : 'pt'
    if (recordingSide === side) {
      if (recorderRef.current) recorderRef.current.stop()
      else browserRef.current?.stop()
      return
    }
    if (recordingSide) await cancelCapture()
    clearTimeout(debounceRef.current)
    abortRef.current?.abort()
    stopPlayback()
    setSpeaking(false)
    setError(null)
    const generation = ++genRef.current
    const known = capsRef.current
    try {
      if (canRecord() && known?.speech !== false) {
        await runServerRecording(side, sourceLang, generation)
        return
      }
      const available = known || await ensureCaps()
      if (available.speech && canRecord()) {
        await runServerRecording(side, sourceLang, generation)
        return
      }
      await runBrowserRecording(side, sourceLang, generation)
    } catch (err) {
      if (generation === genRef.current) {
        setError(micErrorMessage(err))
        setRecordingSide(null)
        setBusySide(null)
        setLoading(false)
      }
    }
  }

  async function toggleLive() {
    unlockAudio()
    if (liveOnRef.current) {
      stopTableLive()
      setInput('')
      setOutput('')
      setDetectedLang(null)
      setLoading(false)
      return
    }
    if (startingLive.current) return
    startingLive.current = true
    let stream = null
    try {
      if (!canRecord()) {
        setError('Este navegador não oferece o microfone do modo ao vivo. Dá para digitar, ou usar Eu falo e Você fala.')
        return
      }
      if (capsRef.current && !capsRef.current.live) {
        setError('O modo ao vivo precisa da chave da OpenAI na Vercel. O tradutor normal continua funcionando.')
        return
      }
      stream = await openMic()
      const available = capsRef.current || await ensureCaps()
      if (!available.live) {
        stream.getTracks().forEach(track => track.stop())
        setError('O modo ao vivo precisa da chave da OpenAI na Vercel. O tradutor normal continua funcionando.')
        return
      }
      await beginLive(stream)
    } catch (err) {
      stream?.getTracks().forEach(track => track.stop())
      setError(micErrorMessage(err))
    } finally {
      startingLive.current = false
    }
  }

  async function beginLive(stream) {
    if (recordingSide) await cancelCapture()
    clearTimeout(debounceRef.current)
    abortRef.current?.abort()
    stopPlayback()
    setSpeaking(false)
    setError(null)
    setInput('')
    setOutput('')
    setDetectedLang(null)
    liveOnRef.current = true
    setLiveOn(true)
    setLivePhase('connecting')
    const generation = ++genRef.current
    try {
      const session = await startTableLive({
        stream,
        onEvent: (event) => {
          if (generation !== genRef.current) return
          applyTableEvent(event)
        },
      })
      if (generation !== genRef.current) {
        session.stop()
        return
      }
      liveRef.current = session
    } catch (err) {
      if (generation === genRef.current) {
        setError(micErrorMessage(err))
        stopTableLive()
      }
    }
  }

  const inTheme = themeFor(detectedLang)
  const outLang = targetLang(detectedLang)
  const outTheme = themeFor(outLang)
  const charWarn = input.length > MAX_TEXT_LENGTH * 0.85
  const captureLabel = recordingSide
    ? `Ouvindo ${recordingSide === 'you' ? 'espanhol' : 'português'} · ${seconds}s`
    : liveOn
      ? (livePhase === 'connecting'
        ? 'Conectando o ao vivo…'
        : livePhase === 'translating'
          ? 'Traduzindo nos dois sentidos'
          : 'Ouvindo os dois')
      : null

  return (
    <div className="app-shell">
      <div className="app-scroll">
        <div className="app-column">
          <header style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '18px 2px 12px' }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12, flex: 'none',
              background: 'linear-gradient(135deg,#009c3b,#aa151b)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, boxShadow: '0 2px 8px rgba(0,0,0,.15)',
            }}>🌐</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#111', lineHeight: 1.2 }}>Tradutor</div>
              <div style={{ fontSize: 12, color: '#888' }}>Brasil ↔ Espanha</div>
            </div>
          </header>

          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            background: '#fff', borderRadius: 14, padding: '10px 12px', marginBottom: 12,
            boxShadow: '0 1px 6px rgba(0,0,0,.06)',
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#222' }}>Ao vivo</div>
              <div style={{ fontSize: 12, color: '#888', lineHeight: 1.35 }}>Ouve os dois e escreve a tradução</div>
            </div>
            <button type="button" role="switch" aria-checked={liveOn} aria-label="Modo ao vivo" onPointerDown={unlockAudio} onClick={toggleLive} style={{
              width: 52, height: 32, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative',
              background: liveOn ? '#009c3b' : '#d0d0d0', transition: 'background .15s', flex: 'none',
            }}>
              <span style={{
                position: 'absolute', top: 3, left: liveOn ? 23 : 3, width: 26, height: 26, borderRadius: '50%',
                background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.2)', transition: 'left .15s',
              }}/>
            </button>
          </div>

          {caps && !caps.speech && (
            <p style={{ margin: '0 4px 12px', fontSize: 12, color: '#777', lineHeight: 1.45 }}>
              Sem a chave da OpenAI, o microfone usa o navegador. No iPhone ele fica mais firme com essa chave.
            </p>
          )}

          {error && (
            <div role="alert" style={{
              padding: '12px 14px', borderRadius: 14, marginBottom: 12,
              background: '#fef2f2', border: '1.5px solid #fca5a5',
              fontSize: 14, color: '#b91c1c', lineHeight: 1.45,
            }}>{error}</div>
          )}

          {captureLabel && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 4px 10px', color: '#b91c1c', fontSize: 13, fontWeight: 700 }}>
              <span className="rec-dot"/> {captureLabel}
            </div>
          )}

          <ExchangeCard
            theme={inTheme}
            label={inTheme ? `${inTheme.flag} ${inTheme.name.toUpperCase()}` : '✍️ ENTRADA'}
            hint={liveOn ? 'ao vivo' : inTheme ? 'detectado' : null}
          >
            <textarea
              value={input}
              onChange={event => handleInput(event.target.value)}
              placeholder="Ou digite aqui, no idioma que quiser..."
              rows={3}
              disabled={Boolean(recordingSide || liveOn)}
              aria-label="Texto para traduzir"
              style={{
                width: '100%', border: 'none', outline: 'none', resize: 'none',
                fontSize: 17, background: 'transparent', color: '#111', fontFamily: 'inherit',
                lineHeight: 1.55, padding: '12px 14px', display: 'block',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 12px 10px' }}>
              <span style={{ fontSize: 11, color: charWarn ? '#e05' : '#aaa' }}>
                {input.length > 0 ? `${input.length}/${MAX_TEXT_LENGTH}` : ''}
              </span>
              {input && (
                <button type="button" onClick={clearCurrent} style={textButton}>Limpar</button>
              )}
            </div>
          </ExchangeCard>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 4px 10px' }}>
            <div style={{ flex: 1, height: 1, background: '#ddd' }}/>
            <div style={{ fontSize: 16, color: '#ccc' }}>↓</div>
            <div style={{ flex: 1, height: 1, background: '#ddd' }}/>
          </div>

          <div ref={outputRef}>
          <ExchangeCard
            theme={outTheme}
            label={outTheme ? `${outTheme.flag} ${outTheme.name.toUpperCase()}` : '🔤 TRADUÇÃO'}
          >
            <div style={{ padding: '12px 14px', minHeight: 72 }}>
              {loading ? <Dots color={outTheme?.solid}/> : (
                <p style={{ margin: 0, fontSize: 17, color: output ? '#111' : '#bbb', lineHeight: 1.55 }}>
                  {output || 'A tradução aparece aqui. Toque em Ouvir para escutar.'}
                </p>
              )}
            </div>
            {output && !loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 10px 10px' }}>
                <button type="button" onPointerDown={unlockAudio} onClick={() => speakTranslation(output, outLang)} style={pill(outTheme, speaking)}>
                  <SpeakerIcon muted={false}/> {speaking ? 'Falando' : 'Ouvir'}
                </button>
                <CopyButton text={output} theme={outTheme}/>
              </div>
            )}
          </ExchangeCard>
          </div>
        </div>
      </div>

      <div className="app-footer">
        {liveOn ? (
          <div className="app-column" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 64 }}>
            <span className="rec-dot"/>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>
              {livePhase === 'connecting' ? 'Conectando…' : livePhase === 'translating' ? 'Traduzindo…' : 'Ouvindo os dois'}
            </span>
          </div>
        ) : (
          <div className="app-column" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <MicButton
              label="Eu falo"
              hint="português"
              theme={BR}
              active={recordingSide === 'me'}
              disabled={Boolean(busySide) || (recordingSide && recordingSide !== 'me')}
              onClick={() => handleMic('me')}
            />
            <MicButton
              label="Você fala"
              hint="espanhol"
              theme={ES}
              active={recordingSide === 'you'}
              disabled={Boolean(busySide) || (recordingSide && recordingSide !== 'you')}
              onClick={() => handleMic('you')}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function ExchangeCard({ theme, label, hint, children }) {
  return (
    <section style={{
      borderRadius: 18, overflow: 'hidden', marginBottom: 4,
      background: theme ? theme.light : '#fff',
      boxShadow: theme
        ? `0 2px 16px ${theme.solid}30, 0 0 0 2px ${theme.border}`
        : '0 2px 12px rgba(0,0,0,.08), 0 0 0 1.5px #e0e0e0',
    }}>
      <div style={{
        padding: '10px 14px',
        background: theme ? theme.grad : 'linear-gradient(135deg,#e8e8e8,#d4d4d4)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 10px', borderRadius: 20,
          background: theme ? theme.badge : '#fff',
          color: theme ? theme.badgeText : '#888',
          fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
        }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: '#fff', opacity: .85 }}>{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function MicButton({ label, hint, theme, active, disabled, onClick }) {
  return (
    <button
      type="button"
      onPointerDown={unlockAudio}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
        minHeight: 64, borderRadius: 16, border: 'none', cursor: disabled ? 'default' : 'pointer',
        background: active ? '#ef4444' : theme.solid, color: '#fff',
        opacity: disabled ? 0.45 : 1,
        boxShadow: `0 2px 8px ${active ? '#ef444440' : theme.solid + '55'}`,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 16, fontWeight: 700 }}>
        <MicIcon active={active}/> {active ? 'Parar' : label}
      </span>
      <span style={{ fontSize: 11, opacity: .85 }}>{theme.flag} {hint}</span>
    </button>
  )
}

function CopyButton({ text, theme }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" onClick={async () => {
      try {
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      } catch {
        setDone(false)
      }
    }} style={pill(theme, false, done)}>
      {done ? 'Copiado!' : 'Copiar'}
    </button>
  )
}

function Dots({ color }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingTop: 6 }} aria-label="Traduzindo">
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: '50%', background: color || '#ccc',
          animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
        }}/>
      ))}
    </div>
  )
}

const textButton = {
  fontSize: 13, color: '#888', border: 'none', background: 'none', cursor: 'pointer', padding: '6px 4px',
}

function pill(theme, speaking, copied) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    fontSize: 13, cursor: 'pointer', padding: '7px 12px', borderRadius: 10, fontWeight: 600, border: 'none',
    background: copied ? '#dcfce7' : speaking ? (theme?.solid || '#555') : (theme ? theme.badge : '#eee'),
    color: copied ? '#16a34a' : speaking ? '#fff' : (theme?.badgeText || '#555'),
  }
}
