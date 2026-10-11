const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

let currentAudio = null
let currentUrl = null
let settlePlayback = null
let audioContext = null
let sharedAudio = null
let liveAudio = null

function player(kind) {
  if (kind === 'live') {
    if (!liveAudio) {
      liveAudio = new Audio()
      liveAudio.autoplay = true
      liveAudio.playsInline = true
      liveAudio.setAttribute('playsinline', 'true')
    }
    return liveAudio
  }
  if (!sharedAudio) {
    sharedAudio = new Audio()
    sharedAudio.setAttribute('playsinline', 'true')
    sharedAudio.playsInline = true
  }
  return sharedAudio
}

export function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (Ctx && !audioContext) audioContext = new Ctx()
  audioContext?.resume?.().catch(() => {})
  for (const audio of [player('speech'), player('live')]) {
    audio.src = SILENT_WAV
    audio.play().catch(() => {})
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
  const audio = player('speech')
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

function waitForIce(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      pc.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    const check = () => {
      if (pc.iceGatheringState === 'complete') finish()
    }
    pc.addEventListener('icegatheringstatechange', check)
    setTimeout(finish, 1500)
  })
}

export async function startLiveCall({ targetLanguage, muted, onEvent }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  })
  const pc = new RTCPeerConnection()
  pc.addTrack(stream.getAudioTracks()[0], stream)
  const audio = player('live')
  audio.muted = Boolean(muted)
  audio.src = ''
  pc.ontrack = (event) => {
    audio.srcObject = event.streams[0]
    audio.play().catch(() => {})
  }
  const channel = pc.createDataChannel('oai-events')
  channel.onmessage = (event) => {
    try { onEvent(JSON.parse(event.data)) } catch { /* ignore */ }
  }

  try {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await waitForIce(pc)
    const res = await fetch('/api/live-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetLanguage,
        sdp: pc.localDescription?.sdp || offer.sdp,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Modo ao vivo indisponível.')
    await pc.setRemoteDescription({ type: 'answer', sdp: data.answer })
  } catch (error) {
    stream.getTracks().forEach(track => track.stop())
    pc.close()
    throw error
  }

  return {
    setMuted(value) { audio.muted = Boolean(value) },
    stop() {
      try { channel.close() } catch { /* already closed */ }
      pc.close()
      stream.getTracks().forEach(track => track.stop())
      audio.srcObject = null
    },
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
