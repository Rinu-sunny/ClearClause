import { useState, useRef, useEffect } from "react"
import type { ChatMessage } from "../App"

interface Props {
  history: ChatMessage[]
  onSend: (message: string) => void
  loading: boolean
  language: string
}

const STARTER_QUESTIONS: Record<string, string[]> = {
  English: [
    "What is the riskiest clause?",
    "Explain clause 2 simply",
    "Is this normal for a rental agreement?",
  ],
  Malayalam: [
    "ഏറ്റവും അപകടകരമായ വ്യവസ്ഥ ഏതാണ്?",
    "രണ്ടാമത്തെ വ്യവസ്ഥ ലളിതമായി വിശദീകരിക്കൂ",
    "ഇത് ഒരു വാടക കരാറിന് സ്വാഭാവികമാണോ?",
  ],
}

export default function ChatPanel({ history, onSend, loading, language }: Props) {
  const [input, setInput] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const starters = STARTER_QUESTIONS[language] ?? STARTER_QUESTIONS["English"]

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [history, loading])

  const send = () => {
    if (!input.trim() || loading) return
    onSend(input.trim())
    setInput("")
  }

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      {/* Header — fixed */}
      <div className="px-4 py-3 border-b border-slate-100 shrink-0">
        <h2 className="text-sm font-semibold text-slate-700">Ask about this document</h2>
        <p className="text-xs text-slate-400 mt-0.5">Ask questions in any language</p>
      </div>

      {/* Messages — scrollable */}
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 space-y-3 min-h-0">
        {history.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-slate-400 text-center mb-3">Try asking:</p>
            {starters.map(q => (
              <button
                key={q}
                onClick={() => onSend(q)}
                className="w-full text-left text-xs text-blue-600 border border-blue-100
                           bg-blue-50 rounded-lg px-3 py-2 hover:bg-blue-100 transition"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {history.map((msg, i) => (
          <div key={i} className={`flex min-w-0 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] min-w-0 break-words whitespace-pre-wrap rounded-2xl px-3 py-2 text-xs leading-relaxed
              ${msg.role === "user"
                ? "bg-blue-600 text-white rounded-br-sm"
                : "bg-slate-100 text-slate-700 rounded-bl-sm"}`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-3 py-2">
              <div className="flex gap-1 items-center h-4">
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input — fixed at bottom */}
      <div className="p-3 border-t border-slate-100 shrink-0">
        <div className="flex min-w-0 gap-2">
          <input
            className="min-w-0 flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs
                       focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
            placeholder={
              language === "Malayalam" ? "മലയാളത്തിൽ ചോദിക്കൂ..." :
              "Ask in English..."
            }
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="bg-blue-600 text-white rounded-xl px-3 py-2 text-xs font-medium
                       hover:bg-blue-700 disabled:opacity-40 transition shrink-0"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}