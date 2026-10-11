import { isStoredTurn, MAX_STORED_TURNS } from '../lib/conversation.js'

const HISTORY_KEY = 'tradutor.history.v1'
const MUTE_KEY = 'tradutor.muted.v1'

export function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isStoredTurn).slice(-MAX_STORED_TURNS)
  } catch {
    return []
  }
}

export function saveHistory(turns) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(turns.slice(-MAX_STORED_TURNS)))
  } catch {
    /* storage full or private mode */
  }
}

export function loadMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}

export function saveMuted(muted) {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* ignore */ }
}
