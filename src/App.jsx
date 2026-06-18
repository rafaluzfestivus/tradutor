import { useState, useRef } from 'react'

const MicIcon = ({ active }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
)

const CopyIcon = ({ done }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {done
      ? <polyline points="20 6 9 17 4 12"/>
      : <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>
    }
  </svg>
)

const ClearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const BR = {
  grad: 'linear-gradient(135deg,#009c3b,#4dc87a)',
  solid: '#009c3b', light: '#f0faf4', border: '#009c3b',
  text: '#005c23', badge: '#ffdf00', badgeText: '#5a4200', flag: '🇧🇷'
}

const ES = {
  grad: 'linear-gradient(135deg,#aa151b,#e84040)',
  solid: '#aa151b', light: '#fdf2f2', border: '#aa151b',
  text: '#6b0d10', badge: '#f1bf00', badgeText: '#5a3d00', flag: '🇪🇸'
}

export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [copied, setCopied] = useState(false)
  const [detectedLang, setDetectedLang] = useState(null)
  const recognitionRef = useRef(null)
  const debounceRef = useRef(null)
  const abortRef = useRef(null)
  const detectedLangRef = useRef(null)

  const translate = async (text) => {
    if (!text.trim()) { setOutput(''); setDetectedLang(null); detectedLangRef.current = null; return }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal
      })
      const parsed = await res.json()
      if (!res.ok) throw new Error(parsed.error || `HTTP ${res.status}`)
      setOutput(parsed.translation || '')
      setDetectedLang(parsed.detected || null)
      detectedLangRef.current = parsed.detected || null
    } catch (err) {
      if (err.name === 'AbortError') return
      setOutput('Deu ruim! Verifica a internet e tenta de novo.')
    }
    setLoading(false)
  }

  const handleInput = (val) => {
    setInput(val)
    clearTimeout(debounceRef.current)
    if (!val.trim()) { setOutput(''); setDetectedLang(null); detectedLangRef.current = null; return }
    debounceRef.current = setTimeout(() => translate(val), 700)
  }

  const startRecording = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Tenta no Chrome!'); return }
    const r = new SR()
    r.continuous = false; r.interimResults = false
    r.lang = detectedLangRef.current === 'pt' ? 'pt-BR' : detectedLangRef.current === 'es' ? 'es-ES' : navigator.language?.startsWith('pt') ? 'pt-BR' : 'es-ES'
    r.onresult = (e) => {
      clearTimeout(debounceRef.current)
      const t = e.results[0][0].transcript
      setInput(t)
      translate(t)
    }
    r.onend = () => setRecording(false)
    r.onerror = () => setRecording(false)
    r.start(); recognitionRef.current = r; setRecording(true)
  }

  const stopRecording = () => { recognitionRef.current?.stop(); setRecording(false) }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable/denied — nothing to recover from here
    }
  }

  const inTheme  = detectedLang === 'pt' ? BR : detectedLang === 'es' ? ES : null
  const outTheme = detectedLang === 'pt' ? ES : detectedLang === 'es' ? BR : null
  const outLang  = detectedLang === 'es' ? 'pt' : detectedLang === 'pt' ? 'es' : null

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f0f2f5',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: 'env(safe-area-inset-top, 16px) 16px 32px',
    }}>
      <div style={{ width: '100%', maxWidth: 500 }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 4px 18px' }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'linear-gradient(135deg,#009c3b,#aa151b)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, boxShadow: '0 2px 8px rgba(0,0,0,.15)'
          }}>🌐</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111', lineHeight: 1.2 }}>Tradutor</div>
            <div style={{ fontSize: 12, color: '#999' }}>ES ↔ PT · automático</div>
          </div>
        </div>

        <div style={{
          borderRadius: 18, overflow: 'hidden',
          boxShadow: inTheme
            ? `0 2px 16px ${inTheme.solid}30, 0 0 0 2px ${inTheme.border}`
            : '0 2px 12px rgba(0,0,0,.08), 0 0 0 1.5px #e0e0e0',
          marginBottom: 12, transition: 'box-shadow .3s'
        }}>
          <div style={{
            padding: '10px 14px',
            background: inTheme ? inTheme.grad : 'linear-gradient(135deg,#e8e8e8,#d4d4d4)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
          }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 10px', borderRadius: 20,
              background: inTheme ? inTheme.badge : '#fff',
              color: inTheme ? inTheme.badgeText : '#888',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.05em'
            }}>
              {inTheme ? `${inTheme.flag} ${detectedLang === 'pt' ? 'PORTUGUÊS' : 'ESPANHOL'}` : '✍️ ENTRADA'}
            </span>
            {inTheme && <span style={{ fontSize: 11, color: '#fff', opacity: .8 }}>detectado</span>}
          </div>

          <textarea
            value={input}
            onChange={e => handleInput(e.target.value)}
            placeholder="Fala aí, no idioma que quiser..."
            rows={5}
            style={{
              width: '100%', border: 'none', outline: 'none', resize: 'none',
              fontSize: 17, background: inTheme ? inTheme.light : '#fff',
              color: '#111', fontFamily: 'inherit', lineHeight: 1.65,
              padding: '14px 16px', display: 'block', transition: 'background .3s'
            }}
          />

          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px',
            background: inTheme ? inTheme.light : '#f9f9f9',
            borderTop: `1px solid ${inTheme ? inTheme.border + '22' : '#ececec'}`
          }}>
            <button onClick={recording ? stopRecording : startRecording} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 20px', borderRadius: 12, fontSize: 14,
              fontWeight: 600, cursor: 'pointer', border: 'none',
              background: recording ? '#ef4444' : (inTheme ? inTheme.solid : '#555'),
              color: '#fff', transition: 'all .15s',
              boxShadow: `0 2px 8px ${recording ? '#ef444440' : (inTheme ? inTheme.solid + '40' : '#55555540')}`
            }}>
              <MicIcon active={recording}/>
              {recording ? 'Para aí' : 'Falar'}
            </button>
            {input && (
              <button onClick={() => { setInput(''); setOutput(''); setDetectedLang(null) }} style={{
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 13,
                color: '#aaa', border: 'none', background: 'none', cursor: 'pointer', padding: '6px 8px'
              }}>
                <ClearIcon/> Limpar
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 4px 12px' }}>
          <div style={{ flex: 1, height: 1, background: '#ddd' }}/>
          <div style={{ fontSize: 16, color: '#ccc' }}>↓</div>
          <div style={{ flex: 1, height: 1, background: '#ddd' }}/>
        </div>

        <div style={{
          borderRadius: 18, overflow: 'hidden',
          boxShadow: outTheme
            ? `0 2px 16px ${outTheme.solid}30, 0 0 0 2px ${outTheme.border}`
            : '0 2px 12px rgba(0,0,0,.08), 0 0 0 1.5px #e0e0e0',
          transition: 'box-shadow .3s'
        }}>
          <div style={{
            padding: '10px 14px',
            background: outTheme ? outTheme.grad : 'linear-gradient(135deg,#e8e8e8,#d4d4d4)',
            display: 'flex', alignItems: 'center'
          }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 10px', borderRadius: 20,
              background: outTheme ? outTheme.badge : '#fff',
              color: outTheme ? outTheme.badgeText : '#888',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.05em'
            }}>
              {outTheme ? `${outTheme.flag} ${outLang === 'pt' ? 'PORTUGUÊS' : 'ESPANHOL'}` : '🔤 TRADUÇÃO'}
            </span>
          </div>

          <div style={{
            padding: '14px 16px', minHeight: 100,
            background: outTheme ? outTheme.light : '#fafafa',
            transition: 'background .3s'
          }}>
            {loading ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingTop: 4 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: outTheme ? outTheme.solid : '#ccc',
                    animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`
                  }}/>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 17, color: output ? '#111' : '#ccc', lineHeight: 1.65 }}>
                {output || 'A tradução aparece aqui...'}
              </p>
            )}
          </div>

          {output && !loading && (
            <div style={{
              display: 'flex', justifyContent: 'flex-end', padding: '10px 12px',
              background: outTheme ? outTheme.light : '#fafafa',
              borderTop: `1px solid ${outTheme ? outTheme.border + '22' : '#ececec'}`
            }}>
              <button onClick={copy} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 13, cursor: 'pointer', padding: '7px 14px',
                borderRadius: 10, fontWeight: 600, border: 'none',
                background: copied ? '#dcfce7' : (outTheme ? outTheme.badge : '#eee'),
                color: copied ? '#16a34a' : (outTheme ? outTheme.badgeText : '#555'),
                transition: 'all .15s'
              }}>
                <CopyIcon done={copied}/> {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
