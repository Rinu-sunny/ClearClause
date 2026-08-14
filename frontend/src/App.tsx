import { useState } from "react"
import UploadSection from "./components/UploadSection"
import ClauseCard from "./components/ClauseCard"

interface Result {
  clause_type: string
  plain_explanation: string
  risk_rating: "Green" | "Yellow" | "Red"
  flag: string
  disclaimer: string
}

const LANGUAGES = ["English", "Malayalam", "Hindi", "Tamil", "Telugu"]

export default function App() {
  const [result, setResult] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [language, setLanguage] = useState("English")
  const [error, setError] = useState("")

  const analyze = async (text: string) => {
    setLoading(true)
    setError("")
    setResult(null)
    try {
      const res = await fetch("http://localhost:8000/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language }),
      })
      if (!res.ok) throw new Error("Server error")
      const data = await res.json()
      setResult(data)
    } catch {
      setError("Something went wrong. Make sure the backend is running.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <div className="bg-blue-700 text-white px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ClearClause</h1>
            <p className="text-blue-200 text-sm">Know what you sign</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {LANGUAGES.map(lang => (
              <button
                key={lang}
                onClick={() => setLanguage(lang)}
                className={`px-3 py-1 rounded text-sm font-medium transition
                  ${language === lang
                    ? "bg-white text-blue-700"
                    : "border border-white text-white hover:bg-blue-600"}`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <UploadSection onAnalyze={analyze} loading={loading} />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">
            {error}
          </div>
        )}

        {loading && (
          <div className="text-center py-8 text-slate-400 text-sm animate-pulse">
            Analysing clause...
          </div>
        )}

        {result && <ClauseCard result={result} />}
      </div>

      <p className="text-center text-xs text-slate-400 pb-8">
        For informational purposes only. Consult a qualified lawyer before making legal decisions.
      </p>
    </div>
  )
}