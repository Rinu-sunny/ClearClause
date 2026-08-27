import { useState } from "react"
import DocumentPanel from "./components/DocumentPanel"
import DashboardPanel from "./components/DashboardPanel"
import ChatPanel from "./components/ChatPanel"

export interface Statement {
  statement: string
  risk_rating: "Green" | "Yellow" | "Red"
  explanation: string
  flag: string
}

export interface AnalysisResult {
  summary: string
  statements: Statement[]
  disclaimer: string
}

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

const LANGUAGES = ["English", "Malayalam"]
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"

export default function App() {
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [language, setLanguage] = useState("English")
  const [error, setError] = useState("")
  const [documentText, setDocumentText] = useState("")
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)

  const analyze = async (text: string) => {
    setLoading(true)
    setError("")
    setResult(null)
    setChatHistory([])
    setDocumentText(text)
    try {
      const response = await fetch(`${API_BASE_URL}/analyze-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.detail ?? `Request failed with status ${response.status}`)
      }
      if (!data?.summary || !Array.isArray(data?.statements)) {
        throw new Error("The backend returned an incomplete analysis.")
      }
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setLoading(false)
    }
  }

  const sendChat = async (message: string) => {
    if (!documentText) return
    const newHistory: ChatMessage[] = [...chatHistory, { role: "user", content: message }]
    setChatHistory(newHistory)
    setChatLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          document_context: documentText,
          history: chatHistory,
          language,
        }),
      })
      const data = await res.json()
      setChatHistory([...newHistory, { role: "assistant", content: data.response }])
    } catch {
      setChatHistory([...newHistory, { role: "assistant", content: "Something went wrong. Please try again." }])
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <div className="h-screen overflow-hidden bg-slate-100 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center text-xs font-bold">CC</div>
          <div>
            <span className="font-semibold text-sm tracking-tight">ClearClause</span>
            <span className="text-slate-400 text-xs ml-2">Legal document assistant</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/call"
            className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium transition shadow-sm"
            title="Launch phone call helpline simulation"
          >
            <span>📞</span>
            <span>Helpline Call (PoC)</span>
          </a>
          <div className="h-4 w-px bg-slate-700 mx-1" />
          <div className="flex gap-1">
            {LANGUAGES.map(lang => (
              <button
                key={lang}
                onClick={() => setLanguage(lang)}
                className={`px-3 py-1 rounded text-xs font-medium transition
                  ${language === lang
                    ? "bg-blue-500 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-700"}`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main — three columns, fixed height */}
      <main className="flex-1 flex overflow-hidden min-h-0">
        {/* Left — document input */}
        <div className="w-72 shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
          <DocumentPanel
            onAnalyze={analyze}
            loading={loading}
            error={error}
            hasResult={!!result}
            language={language}
          />
        </div>

        {/* Center — dashboard, scrolls internally */}
        <div className="flex-1 overflow-hidden bg-slate-100">
          <DashboardPanel result={result} loading={loading} />
        </div>

        {/* Right — chat, scrolls internally */}
        {result && (
          <div className="w-80 max-w-full min-w-0 shrink-0 border-l border-slate-200 bg-white flex flex-col overflow-hidden">
            <ChatPanel
              history={chatHistory}
              onSend={sendChat}
              loading={chatLoading}
              language={language}
            />
          </div>
        )}
      </main>
    </div>
  )
}