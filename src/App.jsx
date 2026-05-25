import { useState, useRef } from 'react'

const MicIcon = ({ active }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
)

const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
)

const ClearIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const SwapIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/>
  </svg>
)

export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [copied, setCopied] = useState(false)
  const [detectedLang, setDetectedLang] = useState(null)
  const [forceLang, setForceLang] = useState(null)
  const recognitionRef = useRef(null)
  const debounceRef = useRef(null)

  const translate = async (text, force) => {
    if (!text.trim()) { setOutput(''); setDetectedLang(null); return }
    setLoading(true)
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, forceLang: force })
      })
      const parsed = await res.json()
      setOutput(parsed.translation || '')
      setDetectedLang(parsed.detected || null)
    } catch {
      setOutput('Deu ruim aqui! Dá uma olhada na tua internet e tenta de novo.')
    }
    setLoading(false)
  }

  const handleInput = (val) => {
    setInput(val)
    clearTimeout(debounceRef.current)
    if (!val.trim()) { setOutput(''); setDetectedLang(null); return }
    debounceRef.current = setTimeout(() => translate(val, forceLang), 700)
  }

  const handleForce = (lang) => {
    const next = forceLang === lang ? null : lang
    setForceLang(next)
    if (input.trim()) translate(input, next)
  }

  const startRecording = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Seu navegador não manja de voz. Tenta no Chrome!'); return }
    const r = new SR()
    r.continuous = false
    r.interimResults = false
    r.lang = forceLang === 'pt' ? 'pt-BR' : 'es-ES'
    r.onresult = (e) => {
      const t = e.results[0][0].transcript
      setInput(t)
      translate(t, forceLang)
    }
    r.onend = () => setRecording(false)
    r.onerror = () => setRecording(false)
    r.start()
    recognitionRef.current = r
    setRecording(true)
  }

  const stopRecording = () => {
    recognitionRef.current?.stop()
    setRecording(false)
  }

  const copy = () => {
    navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const targetLang = detectedLang === 'es' ? 'pt' : detectedLang === 'pt' ? 'es' : null

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'system-ui, sans-serif', maxWidth: 480, margin: '0 auto' }}>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: '#888' }}>Idioma:</span>
        {['es', 'pt'].map(l => (
          <button key={l} onClick={() => handleForce(l)} style={{
            fontSize: 12, padding: '4px 12px',
            border: `1px solid ${forceLang === l ? '#555' : '#ddd'}`,
            borderRadius: 8,
            background: forceLang === l ? '#f0f0f0' : 'transparent',
            color: forceLang === l ? '#111' : '#888',
            cursor: 'pointer', fontWeight: forceLang === l ? 600 : 400
          }}>
            {l === 'es' ? '🇪🇸 Espanhol' : '🇧🇷 Português'}
          </button>
        ))}
      </div>

      <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: '0.75rem 1rem', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>
          {forceLang === 'es' ? '🇪🇸 Espanhol' : forceLang === 'pt' ? '🇧🇷 Português' : detectedLang === 'es' ? '🇪🇸 Espanhol (detectado)' : detectedLang === 'pt' ? '🇧🇷 Português (detectado)' : 'Joga o texto aqui'}
        </div>
        <textarea
          value={input}
          onChange={e => handleInput(e.target.value)}
          placeholder="Fala aí, no idioma que quiser..."
          rows={4}
          style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', fontSize: 16, background: 'transparent', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <button onClick={recording ? stopRecording : startRecording} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8,
            border: `1px solid ${recording ? '#ffaaaa' : '#ddd'}`,
            background: recording ? '#fff0f0' : 'transparent',
            color: recording ? '#cc0000' : '#555',
            cursor: 'pointer', fontSize: 13
          }}>
            <MicIcon active={recording} />
            {recording ? 'Para aí' : 'Falar'}
          </button>
          {input && (
            <button onClick={() => { setInput(''); setOutput(''); setDetectedLang(null) }} style={{
              display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
              color: '#aaa', border: 'none', background: 'none', cursor: 'pointer'
            }}>
              <ClearIcon /> Limpar
            </button>
          )}
        </div>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 8, color: '#ccc' }}>
        <SwapIcon />
      </div>

      <div style={{ background: '#f9f9f9', border: '1px solid #e0e0e0', borderRadius: 12, padding: '0.75rem 1rem', minHeight: 100 }}>
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>
          {targetLang === 'pt' ? '🇧🇷 Português' : targetLang === 'es' ? '🇪🇸 Espanhol' : 'Tradução'}
        </div>
        {loading
          ? <div style={{ color: '#aaa', fontSize: 14 }}>Na hora...</div>
          : <div style={{ fontSize: 16, lineHeight: 1.5, minHeight: 60 }}>{output}</div>
        }
        {output && !loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button onClick={copy} style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 12,
              color: copied ? 'green' : '#888',
              border: `1px solid ${copied ? 'green' : '#ddd'}`,
              background: 'transparent', borderRadius: 8, padding: '4px 10px', cursor: 'pointer'
            }}>
              <CopyIcon /> {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
