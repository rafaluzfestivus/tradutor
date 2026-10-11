import { detectSpokenLang } from '../lib/conversation.js'

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

let currentAudio = null
let currentUrl = null
let settlePlayback = null
let audioContext = null
let sharedAudio = null

function makeAudio() {
  const audio = new Audio()
  audio.autoplay = true
  audio.playsInline = true
  audio.setAttribute('playsinline', 'true')
  return audio
}

function player() {
  if (!sharedAudio) sharedAudio = makeAudio()
  return sharedAudio
}

export function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (Ctx && !audioContext) audioContext = new Ctx()
  audioContext?.resume?.().catch(() => {})
  const audio = player()
  audio.src = SILENT_WAV
  audio.play().catch(() => {})
}

export function stopPlayback() {
  const settle = settlePlayback
  settlePlayback = null
  window.speechSynthesis?.cancel()
  if (currentAudio) {
    currentAudio.onended = null
    currentAudio.onerror = null
    currentAudio.pause()
    currentAudio.removeAttribute('src')
    currentAudio.srcObject = null
    currentAudio.load?.()
  }
  if (currentUrl) URL.revokeObjectURL(currentUrl)
  currentAudio = null
  currentUrl = null
  settle?.(false)
}

export function playBase64Audio(base64, mime) {
  stopPlayback()
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/mpeg' }))
  const audio = player()
  audio.src = url
  currentAudio = audio
  currentUrl = url
  return new Promise((resolve) => {
    settlePlayback = resolve
    audio.onended = () => {
      if (settlePlayback !== resolve) return
      settlePlayback = null
      resolve(true)
    }
    audio.onerror = () => {
      if (settlePlayback !== resolve) return
      settlePlayback = null
      resolve(false)
    }
    audio.play().catch(() => {
      if (settlePlayback !== resolve) return
      settlePlayback = null
      resolve(false)
    })
  })
}

export function browserSpeak(text, lang) {
  stopPlayback()
  const synth = window.speechSynthesis
  if (!synth || !text) return Promise.resolve(false)
  return new Promise((resolve) => {
    settlePlayback = resolve
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = lang === 'es' ? 'es-ES' : 'pt-BR'
    const wanted = utter.lang.slice(0, 2)
    const match = synth.getVoices().find(voice => voice.lang?.toLowerCase().startsWith(wanted))
    if (match) utter.voice = match
    const finish = (ok) => {
      if (settlePlayback !== resolve) return
      settlePlayback = null
      resolve(ok)
    }
    utter.onend = () => finish(true)
    utter.onerror = () => finish(false)
    synth.speak(utter)
  })
}

export function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || ''
}

export function canRecord() {
  return typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
}

export async function startRecorder({ maxMs = 45000, onTick } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  })
  const mime = pickRecorderMime()
  let rec
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  } catch {
    rec = new MediaRecorder(stream)
  }
  const chunks = []
  rec.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data)
  }
  try {
    try { rec.start(250) } catch { rec.start() }
  } catch (error) {
    stream.getTracks().forEach(track => track.stop())
    throw error
  }
  const started = Date.now()
  let timer = 0
  let auto = 0
  let settled = false

  const done = new Promise((resolve) => {
    const finish = () => {
      if (settled) return
      settled = true
      clearInterval(timer)
      clearTimeout(auto)
      stream.getTracks().forEach(track => track.stop())
      const type = rec.mimeType || mime || 'audio/webm'
      resolve(new Blob(chunks, { type }))
    }
    rec.onstop = finish
    timer = setInterval(() => onTick?.(Date.now() - started), 250)
    auto = setTimeout(() => {
      if (rec.state !== 'inactive') rec.stop()
      else finish()
    }, maxMs)
  })

  return {
    done,
    stop() {
      if (rec.state !== 'inactive') rec.stop()
    },
  }
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result || '')
      resolve(value.slice(value.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error || new Error('audio'))
    reader.readAsDataURL(blob)
  })
}

export function startBrowserRecognition(sourceLang) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) return null
  const recognition = new SR()
  recognition.continuous = false
  recognition.interimResults = false
  recognition.lang = sourceLang === 'es' ? 'es-ES' : 'pt-BR'
  let settled = false
  const result = new Promise((resolve, reject) => {
    recognition.onresult = (event) => {
      if (settled) return
      settled = true
      resolve(event.results?.[0]?.[0]?.transcript || '')
    }
    recognition.onerror = (event) => {
      if (settled) return
      settled = true
      if (event.error === 'aborted') { resolve(''); return }
      const error = new Error(event.error || 'mic')
      error.code = event.error
      reject(error)
    }
    recognition.onend = () => {
      if (settled) return
      settled = true
      resolve('')
    }
  })
  recognition.start()
  return {
    result,
    stop() { recognition.stop() },
  }
}

function outputRms(analyser) {
  const data = new Uint8Array(analyser.fftSize)
  analyser.getByteTimeDomainData(data)
  let sum = 0
  for (let i = 0; i < data.length; i += 1) {
    const sample = (data[i] - 128) / 128
    sum += sample * sample
  }
  return Math.sqrt(sum / data.length)
}

async function startUtteranceLive({ onEvent }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (Ctx && !audioContext) audioContext = new Ctx()
  await audioContext?.resume?.().catch(() => {})
  const source = audioContext.createMediaStreamSource(stream)
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 2048
  const silent = audioContext.createGain()
  silent.gain.value = 0
  source.connect(analyser)
  analyser.connect(silent)
  silent.connect(audioContext.destination)

  let stopped = false
  let paused = false
  let mode = 'listen'
  let voiceSince = 0
  let quietSince = 0
  let recorder = null
  const chunks = []

  const arm = () => {
    if (stopped) return
    mode = 'listen'
    voiceSince = 0
    quietSince = 0
    onEvent({ type: 'status', phase: 'listening' })
  }

  const discardRecording = () => {
    const rec = recorder
    recorder = null
    chunks.splice(0)
    mode = 'listen'
    voiceSince = 0
    quietSince = 0
    if (!rec || rec.state === 'inactive') return
    rec.ondataavailable = null
    rec.onstop = null
    try { rec.stop() } catch { /* already stopped */ }
  }

  const finishUtterance = async () => {
    const rec = recorder
    recorder = null
    if (!rec || rec.state === 'inactive') {
      arm()
      return
    }
    const blob = await new Promise(resolve => {
      rec.onstop = () => resolve(new Blob(chunks.splice(0), { type: rec.mimeType || 'audio/webm' }))
      try { rec.stop() } catch { resolve(new Blob()) }
    })
    if (stopped) return
    if (blob.size < 200) {
      arm()
      return
    }
    onEvent({ type: 'status', phase: 'translating' })
    try {
      const audio = await blobToBase64(blob)
      const heardRes = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio, mime: blob.type }),
      })
      const heard = await heardRes.json().catch(() => ({}))
      if (!heardRes.ok) throw new Error(heard.error || 'Não consegui entender o áudio.')
      const original = (heard.text || '').trim()
      const sourceLang = heard.language || detectSpokenLang(original)
      if (!original || !sourceLang) {
        arm()
        return
      }
      onEvent({ type: 'caption', sourceLang, original, translation: '' })
      const translatedRes = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: original, sourceLang }),
      })
      const translated = await translatedRes.json().catch(() => ({}))
      if (!translatedRes.ok) throw new Error(translated.error || 'Deu ruim na tradução.')
      const translation = (translated.translation || '').trim()
      const detected = translated.detected || sourceLang
      onEvent({ type: 'caption', sourceLang: detected, original, translation })
      onEvent({ type: 'turn', sourceLang: detected, original, translation })
    } catch (error) {
      if (!stopped) onEvent({ type: 'error', message: error?.message || 'Deu ruim no modo ao vivo.' })
    } finally {
      if (!stopped) arm()
    }
  }

  const begin = () => {
    chunks.splice(0)
    const mime = pickRecorderMime()
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    } catch {
      recorder = new MediaRecorder(stream)
    }
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data)
    }
    try { recorder.start(250) } catch { recorder.start() }
    mode = 'record'
    onEvent({ type: 'status', phase: 'listening' })
  }

  const timer = setInterval(() => {
    if (stopped || mode === 'busy' || paused) return
    const loud = outputRms(analyser) > 0.03
    const now = Date.now()
    if (mode === 'listen' && loud) {
      voiceSince = now
      quietSince = 0
      begin()
      return
    }
    if (mode !== 'record') return
    if (loud) {
      quietSince = 0
      if (now - voiceSince > 20000) {
        mode = 'busy'
        finishUtterance()
      }
      return
    }
    if (!quietSince) quietSince = now
    if (now - voiceSince > 350 && now - quietSince > 650) {
      mode = 'busy'
      finishUtterance()
    }
  }, 100)

  onEvent({ type: 'engine', engine: 'turns' })
  onEvent({ type: 'status', phase: 'listening' })

  return {
    setPaused(value) {
      paused = Boolean(value)
      if (paused) discardRecording()
    },
    stop() {
      stopped = true
      clearInterval(timer)
      discardRecording()
      stream.getTracks().forEach(track => track.stop())
      try { source.disconnect() } catch { /* already disconnected */ }
    },
  }
}

export async function startTableLive({ onEvent }) {
  unlockAudio()
  onEvent({ type: 'status', phase: 'listening' })
  return startUtteranceLive({ onEvent })
}

export function micErrorMessage(error) {
  const code = error?.code || error?.name
  if (code === 'NotAllowedError' || code === 'PermissionDeniedError' || code === 'not-allowed') {
    return 'Permissão do microfone negada. Libera nas configurações do navegador.'
  }
  if (code === 'NotFoundError' || code === 'audio-capture') return 'Microfone não encontrado ou indisponível.'
  if (code === 'no-speech') return 'Nenhuma fala detectada. Tente de novo.'
  if (code === 'network') return 'Erro de rede no reconhecimento de voz.'
  return error?.message || 'Não consegui usar o microfone.'
}
