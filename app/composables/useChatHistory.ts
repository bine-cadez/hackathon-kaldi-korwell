// Past Ask conversations, kept in this browser's localStorage. Nothing is sent
// to the server: chats stay private to the browser they were asked in. The key
// includes the Access email, so two people sharing a computer don't see each
// other's chats.

export interface ChatSource {
  kind: 'document' | 'slack'
  title: string
  url: string
  detail?: string
}

export interface ToolActivity {
  id: string
  name: string
  input: Record<string, unknown>
  done: boolean
  ok: boolean
  count: number
  title?: string
}

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools: ToolActivity[]
  sources: ChatSource[]
  status: 'streaming' | 'done' | 'stopped' | 'error'
  error?: unknown
}

export interface SavedChat {
  id: string
  title: string
  /** ISO time of the last question. */
  updatedAt: string
  turns: ChatTurn[]
}

const MAX_CHATS = 50
const TITLE_LENGTH = 80

function storageKey (email: string | null) {
  return `korwell-chats:v1:${email ?? 'shared'}`
}

function isSavedChat (value: unknown): value is SavedChat {
  if (!value || typeof value !== 'object') return false
  const chat = value as Partial<SavedChat>
  return typeof chat.id === 'string' && typeof chat.title === 'string' && typeof chat.updatedAt === 'string' && Array.isArray(chat.turns)
}

function readAll (key: string): SavedChat[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed.filter(isSavedChat) : []
  } catch {
    return []
  }
}

// Writes the list, dropping the oldest chats if the browser runs out of room.
function writeAll (key: string, chats: SavedChat[]): SavedChat[] {
  let list = chats.slice(0, MAX_CHATS)
  while (list.length) {
    try {
      localStorage.setItem(key, JSON.stringify(list))
      return list
    } catch {
      list = list.slice(0, -1)
    }
  }
  localStorage.removeItem(key)
  return []
}

// Errors are stored as plain data (an Error object would serialise to {}).
function storableTurn (turn: ChatTurn): ChatTurn {
  const copy: ChatTurn = JSON.parse(JSON.stringify({ ...turn, error: undefined }))
  if (turn.error !== undefined) {
    copy.error = { statusCode: errorStatus(turn.error), message: errorMessage(turn.error), data: { message: errorMessage(turn.error) } }
  }
  return copy
}

// A chat saved mid-answer (tab closed, page reloaded) comes back as stopped.
function restoredTurn (turn: ChatTurn): ChatTurn {
  if (turn.status !== 'streaming') return turn
  return { ...turn, status: 'stopped', tools: turn.tools.map(tool => ({ ...tool, done: true })) }
}

function chatTitle (turns: ChatTurn[]) {
  const question = turns.find(turn => turn.role === 'user')?.text.replace(/\s+/g, ' ').trim() || 'New chat'
  return question.length > TITLE_LENGTH ? `${question.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : question
}

export function useChatHistory () {
  const session = useSession()
  const chats = useState<SavedChat[]>('korwell-chat-history', () => [])
  const key = () => storageKey(session.value.email)

  /** Re-reads the list, picking up chats saved in other tabs. Client only. */
  function refresh () {
    if (import.meta.server) return
    chats.value = readAll(key())
  }

  /** Saves a conversation and moves it to the top of the list. */
  function save (id: string, turns: ChatTurn[]) {
    if (import.meta.server || !turns.length) return
    const existing = readAll(key()).filter(chat => chat.id !== id)
    const chat: SavedChat = { id, title: chatTitle(turns), updatedAt: new Date().toISOString(), turns: turns.map(storableTurn) }
    chats.value = writeAll(key(), [chat, ...existing])
  }

  /** The turns of a saved chat, ready to show and continue. */
  function open (id: string): ChatTurn[] | null {
    const chat = readAll(key()).find(item => item.id === id)
    return chat ? chat.turns.map(restoredTurn) : null
  }

  function remove (id: string) {
    if (import.meta.server) return
    chats.value = writeAll(key(), readAll(key()).filter(chat => chat.id !== id))
  }

  function clear () {
    if (import.meta.server) return
    localStorage.removeItem(key())
    chats.value = []
  }

  return { chats, refresh, save, open, remove, clear }
}

/** The conversation on the Ask page and the saved chat it belongs to. */
export function useCurrentChat () {
  return {
    turns: useState<ChatTurn[]>('korwell-chat', () => []),
    // null until the first question.
    chatId: useState<string | null>('korwell-chat-id', () => null),
    // Bumped by startNewChat so a mounted Ask page can stop its answer.
    resets: useState('korwell-chat-resets', () => 0)
  }
}

/**
 * Click handler for links to the home page (logo, Ask): they open a new chat.
 * The current one is already in the history. Modified clicks open a new tab
 * and leave it alone.
 */
export function useStartNewChat () {
  const { turns, chatId, resets } = useCurrentChat()
  return (event?: MouseEvent) => {
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return
    turns.value = []
    chatId.value = null
    resets.value += 1
  }
}
