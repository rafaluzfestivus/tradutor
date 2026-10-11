import { applyLiveEvent, detectSpokenLang, emptyLiveBuffers, liveDirectionTarget, targetLang } from '../lib/conversation.js'

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
const OUTPUT_HOLD_SEC = 1.3

let currentAudio = null
let currentUrl = null
let settlePlayback = null
let audioContext = null
let sharedAudio = null
const liveSlots = [null, null]
const outputGraphs = new WeakMap()

function makeAudio() {
  const audio = new Audio()
  audio.autoplay = true
  audio.playsInline = true
  audio.setAttribute('playsinline', 'true')
  return audio
}

function player(kind) {
  if (!sharedAudio) sharedAudio = makeAudio()
  return sharedAudio
}

function liveSlot(index) {
  if (!liveSlots[index]) liveSlots[index] = makeAudio()
  return liveSlots[index]
}

export function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (Ctx && !audioContext) audioContext = new Ctx()
  audioContext?.resume?.().catch(() => {})
  for (const audio of [player('speech'), liveSlot(0), liveSlot(1)]) {
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
    setTimeout(finish, 4000)
  })
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

function buildOutputGraph(audio) {
  const cached = outputGraphs.get(audio)
  if (cached) return cached
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  if (!audioContext) audioContext = new Ctx()
  try {
    audioContext.resume?.()
    const mediaSource = audioContext.createMediaElementSource(audio)
    const delay = audioContext.createDelay(4)
    delay.delayTime.value = OUTPUT_HOLD_SEC
    const gain = audioContext.createGain()
    gain.gain.value = 0
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 1024
    mediaSource.connect(delay)
    delay.connect(gain)
    gain.connect(analyser)
    analyser.connect(audioContext.destination)
    const graph = {
      mediaSource,
      delay,
      gain,
      analyser,
      setAudible(on) { gain.gain.value = on ? 1 : 0 },
      flush() {
        try { mediaSource.disconnect() } catch { /* already disconnected */ }
        try { delay.disconnect() } catch { /* already disconnected */ }
        const next = audioContext.createDelay(4)
        next.delayTime.value = OUTPUT_HOLD_SEC
        mediaSource.connect(next)
        next.connect(gain)
        graph.delay = next
      },
    }
    outputGraphs.set(audio, graph)
    return graph
  } catch {
    return null
  }
}

async function openLiveSession({ targetLanguage, stream, onEvent }) {
  const pc = new RTCPeerConnection()
  pc.addTrack(stream.getAudioTracks()[0], stream)
  const audio = liveSlot(targetLanguage === 'pt' ? 1 : 0)
  audio.autoplay = true
  audio.volume = 1
  const graph = buildOutputGraph(audio)
  if (!graph) audio.muted = true
  audio.play().catch(() => {})
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') {
      onEvent({ type: 'error', message: 'A conexão de áudio ao vivo caiu.' })
    }
  }
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
    if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(' ') || 'Modo ao vivo indisponível.')
    await pc.setRemoteDescription({ type: 'answer', sdp: data.answer })
  } catch (error) {
    try { channel.close() } catch { /* already closed */ }
    pc.close()
    audio.srcObject = null
    throw error
  }

  return {
    targetLanguage,
    analyser: graph?.analyser || null,
    setAudible(on) {
      if (graph) graph.setAudible(on)
      else audio.muted = !on
    },
    flush() { graph?.flush() },
    stop() {
      try { channel.close() } catch { /* already closed */ }
      pc.close()
      audio.srcObject = null
      if (graph) graph.setAudible(false)
      else audio.muted = true
    },
  }
}

function bindLiveDirection(sessions, { stream, muted, onEvent }) {
  const buffers = emptyLiveBuffers()
  let active = null
  let sealed = false
  let userMuted = Boolean(muted)
  let stopped = false
  let quietSince = 0
  const micTrack = stream.getAudioTracks()[0]

  const publish = () => {
    const heard = [buffers.es.input, buffers.pt.input]
      .filter(text => text && text.trim())
      .sort((a, b) => b.trim().length - a.trim().length)[0] || ''
    const side = active ? buffers[active] : null
    const sourceLang = active ? targetLang(active) : detectSpokenLang(heard)
    onEvent({
      type: 'caption',
      sourceLang,
      original: (side?.input || heard).trim(),
      translation: (side?.output || '').trim(),
    })
  }

  const applyAudible = () => {
    if (stopped) return
    for (const session of sessions) {
      session.setAudible(!userMuted && session.targetLanguage === active)
    }
  }

  const commit = (target) => {
    const side = buffers[target]
    const original = side?.input?.trim() || ''
    const translation = side?.output?.trim() || ''
    if (!translation || sealed) return
    onEvent({
      type: 'turn',
      sourceLang: targetLang(target),
      original,
      translation,
    })
    sealed = true
  }

  const onSessionEvent = (target, event) => {
    if (stopped || !event || typeof event !== 'object') return
    const type = typeof event.type === 'string' ? event.type : ''
    if (type === 'error' || event.error) {
      onEvent({ type: 'error', message: event.error?.message || event.message || 'Erro no modo ao vivo.' })
      return
    }
    if (!type.includes('transcript')) return
    const finished = type.endsWith('.done')
    if (sealed && !finished) {
      buffers.es = { input: '', output: '' }
      buffers.pt = { input: '', output: '' }
      sealed = false
    }
    buffers[target] = applyLiveEvent(buffers[target], event)
    const wanted = liveDirectionTarget(buffers, active)
    let held = false
    if (wanted && wanted !== active) {
      if (active && buffers[active]?.output?.trim()) {
        commit(active)
        held = true
      }
      const previous = active
      active = wanted
      if (previous) sessions.find(session => session.targetLanguage === previous)?.flush()
      onEvent({ type: 'status', phase: 'translating' })
    }
    applyAudible()
    if (!held && !(sealed && finished)) publish()
    if (!held && finished && type.includes('output') && target === active) commit(target)
  }

  const gate = setInterval(() => {
    if (stopped || !micTrack) return
    const analyser = sessions.find(session => session.targetLanguage === active)?.analyser
    if (!analyser || userMuted || !active) {
      if (micTrack.enabled === false) micTrack.enabled = true
      quietSince = 0
      return
    }
    const loud = outputRms(analyser) > 0.02
    if (loud) {
      micTrack.enabled = false
      quietSince = 0
      return
    }
    if (micTrack.enabled) return
    if (!quietSince) quietSince = Date.now()
    if (Date.now() - quietSince > 700) micTrack.enabled = true
  }, 120)

  applyAudible()

  return {
    setMuted(value) {
      userMuted = Boolean(value)
      applyAudible()
    },
    stop() {
      stopped = true
      clearInterval(gate)
      for (const session of sessions) session.stop()
      stream.getTracks().forEach(track => track.stop())
    },
    onSessionEvent,
  }
}

async function startBidirectional(stream, options) {
  const opened = []
  const queued = { es: [], pt: [] }
  let sink = null
  const fan = (target, event) => {
    if (sink) sink(target, event)
    else queued[target].push(event)
  }
  try {
    const sessions = await Promise.all(['es', 'pt'].map(async targetLanguage => {
      const session = await openLiveSession({
        targetLanguage,
        stream,
        onEvent: (event) => fan(targetLanguage, event),
      })
      opened.push(session)
      return session
    }))
    const bound = bindLiveDirection(sessions, { stream, ...options })
    sink = (target, event) => bound.onSessionEvent(target, event)
    for (const target of ['es', 'pt']) {
      for (const event of queued[target]) sink(target, event)
    }
    return {
      setMuted: bound.setMuted,
      stop: bound.stop,
    }
  } catch (error) {
    for (const session of opened) session.stop()
    throw error
  }
}

async function startUtteranceLive({ muted, onEvent, stream: existing }) {
  const stream = existing || await navigator.mediaDevices.getUserMedia({
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

  let userMuted = Boolean(muted)
  let stopped = false
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
      if (!userMuted && translation) {
        const spokenRes = await fetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: translation, language: targetLang(detected) }),
        })
        const spoken = await spokenRes.json().catch(() => ({}))
        if (spokenRes.ok && spoken.audio && !userMuted && !stopped) {
          await playBase64Audio(spoken.audio, spoken.mime)
        }
      }
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
    if (stopped || mode === 'busy') return
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
    setMuted(value) { userMuted = Boolean(value) },
    stop() {
      stopped = true
      clearInterval(timer)
      try { if (recorder && recorder.state !== 'inactive') recorder.stop() } catch { /* already stopped */ }
      stream.getTracks().forEach(track => track.stop())
      try { source.disconnect() } catch { /* already disconnected */ }
    },
  }
}

export async function startTableLive({ muted, onEvent }) {
  unlockAudio()
  onEvent({ type: 'status', phase: 'connecting' })
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  try {
    const session = await startBidirectional(stream, { muted, onEvent })
    onEvent({ type: 'engine', engine: 'realtime' })
    onEvent({ type: 'status', phase: 'listening' })
    return session
  } catch (error) {
    const message = error?.message || ''
    if (/permiss|notallowed|not found|microfone/i.test(message) || error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') {
      stream.getTracks().forEach(track => track.stop())
      throw error
    }
    return startUtteranceLive({ muted, onEvent, stream })
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
