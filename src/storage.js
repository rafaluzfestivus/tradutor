import { isStoredTurn, MAX_STORED_TURNS } from '../lib/conversation.js'

const HISTORY_KEY = 'tradutor.history.v1'

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

