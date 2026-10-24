import { createEndpoint, detectSpokenLang, releaseEndpoint, stepEndpoint } from '../lib/conversation.js'

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

function runningContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  if (!audioContext || audioContext.state === 'closed') audioContext = new Ctx()
  const resume = () => {
    if (audioContext && (audioContext.state === 'suspended' || audioContext.state === 'interrupted')) {
      audioContext.resume?.().catch(() => {})
    }
  }
  if (!audioContext.__tradutorResume) {
    audioContext.__tradutorResume = true
    audioContext.addEventListener?.('statechange', resume)
  }
  resume()
  audioContext.resume?.().catch(() => {})
  return audioContext
}

export function unlockAudio() {
  runningContext()
  const audio = player()
  audio.src = SILENT_WAV
  const played = audio.play?.()
  if (played?.catch) played.catch(() => {})
}

export async function openMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error('Este navegador não oferece microfone.')
    error.code = 'audio-capture'
    throw error
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    })
  } catch (error) {
    if (error?.name === 'OverconstrainedError' || error?.name === 'ConstraintError') {
      return navigator.mediaDevices.getUserMedia({ audio: true })
    }
    throw error
  }
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

export async function startRecorder({ maxMs = 45000, onTick, stream } = {}) {
  const owned = stream || await openMic()
  stream = owned
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
    rec.onstop = () => setTimeout(finish, 60)
    timer = setInterval(() => onTick?.(Date.now() - started), 250)
    auto = setTimeout(() => {
      if (rec.state !== 'inactive') stopRecorder(rec)
      else finish()
    }, maxMs)
  })

  return {
    done,
    stop() { stopRecorder(rec) },
  }
}

function stopRecorder(rec) {
  if (!rec || rec.state === 'inactive') return
  try { rec.requestData() } catch { /* optional on older Safari */ }
  try { rec.stop() } catch { /* already stopped */ }
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

function blobAfterStop(rec, chunks) {
  return new Promise(resolve => {
    const finish = () => {
      const type = rec.mimeType || chunks.find(part => part?.type)?.type || 'audio/webm'
      resolve(new Blob(chunks, { type }))
    }
    rec.onstop = () => setTimeout(finish, 60)
    if (!rec || rec.state === 'inactive') {
      setTimeout(finish, 60)
      return
    }
    stopRecorder(rec)
  })
}

async function startUtteranceLive({ onEvent, stream }) {
  const mic = stream || await openMic()
  const ctx = runningContext()
  if (!ctx) {
    mic.getTracks().forEach(track => track.stop())
    throw new Error('Este navegador não consegue ouvir ao vivo.')
  }
  await ctx.resume?.().catch(() => {})
  let analysis = mic
  try { analysis = mic.clone() } catch { analysis = mic }
  const source = ctx.createMediaStreamSource(analysis)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  const silent = ctx.createGain()
  silent.gain.value = 0
  source.connect(analyser)
  analyser.connect(silent)
  silent.connect(ctx.destination)

  let stopped = false
  let paused = false
  let busy = false
  let recorder = null
  let bucket = []
  let endpoint = createEndpoint(Date.now())

  const listen = () => {
    if (!stopped) onEvent({ type: 'status', phase: 'listening' })
  }

  const discardRecording = () => {
    const rec = recorder
    recorder = null
    bucket = []
    endpoint = releaseEndpoint(endpoint, Date.now())
    if (!rec || rec.state === 'inactive') return
    rec.ondataavailable = null
    rec.onstop = null
    stopRecorder(rec)
  }

  const begin = () => {
    const mine = []
    bucket = mine
    const mime = pickRecorderMime()
    try {
      recorder = new MediaRecorder(mic, mime ? { mimeType: mime } : undefined)
    } catch {
      recorder = new MediaRecorder(mic)
    }
    recorder.ondataavailable = (event) => {
      if (event.data?.size) mine.push(event.data)
    }
    try { recorder.start(250) } catch { recorder.start() }
    onEvent({ type: 'status', phase: 'listening' })
  }

  const finishUtterance = async (rec, mine) => {
    let blob = new Blob()
    try {
      if (rec && rec.state !== 'inactive') blob = await blobAfterStop(rec, mine)
      else blob = new Blob(mine, { type: rec?.mimeType || 'audio/webm' })
    } catch {
      blob = new Blob()
    }
    if (stopped) return
    if (blob.size < 400) {
      listen()
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
      if (!original) {
        listen()
        return
      }
      const sourceLang = heard.language || detectSpokenLang(original)
      onEvent({ type: 'caption', sourceLang, original, translation: '' })
      const translatedRes = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sourceLang ? { text: original, sourceLang } : { text: original }),
      })
      const translated = await translatedRes.json().catch(() => ({}))
      if (!translatedRes.ok) throw new Error(translated.error || 'Deu ruim na tradução.')
      const translation = (translated.translation || '').trim()
      const detected = translated.detected || sourceLang
      if (!translation) throw new Error('Tradução não encontrada.')
      onEvent({ type: 'turn', sourceLang: detected, original, translation })
    } catch (error) {
      if (!stopped) onEvent({ type: 'error', message: error?.message || 'Deu ruim no modo ao vivo.' })
    } finally {
      busy = false
      if (!stopped && !paused) listen()
    }
  }

  const timer = setInterval(() => {
    if (stopped || paused || busy) return
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume?.().catch(() => {})
    const now = Date.now()
    const { state, action } = stepEndpoint(endpoint, outputRms(analyser), now)
    endpoint = state
    if (action === 'start' && !recorder) {
      try { begin() } catch (error) {
        recorder = null
        bucket = []
        endpoint = releaseEndpoint(endpoint, now)
        onEvent({ type: 'error', message: error?.message || 'Não consegui gravar o áudio.' })
      }
      return
    }
    if (action === 'stop' && recorder) {
      const rec = recorder
      const mine = bucket
      recorder = null
      bucket = []
      busy = true
      finishUtterance(rec, mine)
    }
  }, 80)

  onEvent({ type: 'engine', engine: 'turns' })
  listen()

  return {
    setPaused(value) {
      paused = Boolean(value)
      if (paused) discardRecording()
      else listen()
    },
    stop() {
      stopped = true
      busy = false
      clearInterval(timer)
      discardRecording()
      mic.getTracks().forEach(track => track.stop())
      analysis.getTracks().forEach(track => track.stop())
      try { source.disconnect() } catch { /* already disconnected */ }
    },
  }
}

export async function startTableLive({ onEvent, stream } = {}) {
  unlockAudio()
  onEvent({ type: 'status', phase: 'listening' })
  try {
    return await startUtteranceLive({ onEvent, stream })
  } catch (error) {
    stream?.getTracks?.().forEach(track => track.stop())
    throw error
  }
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
