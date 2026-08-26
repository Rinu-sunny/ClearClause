import { useState } from "react"

interface Props {
  onAnalyze: (text: string) => void
  loading: boolean
  error: string
  hasResult: boolean
}

export default function DocumentPanel({ onAnalyze, loading, error, hasResult }: Props) {
  const [text, setText] = useState("")
  const [pdfLoading, setPdfLoading] = useState(false)

  const handlePDF = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPdfLoading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("http://localhost:8000/upload", { method: "POST", body: form })
      const data = await res.json()
      setText(data.text)
    } catch {
      // silently fail — user can paste manually
    } finally {
      setPdfLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 gap-3">
      {/* Title — fixed */}
      <div className="shrink-0">
        <h2 className="text-sm font-semibold text-slate-700">Document</h2>
        <p className="text-xs text-slate-400 mt-0.5">Paste text or upload a PDF in any language</p>
      </div>

      {/* Textarea — scrollable, fills available space */}
      <textarea
        className="flex-1 min-h-0 w-full border border-slate-200 rounded-xl p-3 text-xs
                   text-slate-700 resize-none focus:outline-none focus:ring-2
                   focus:ring-blue-500 overflow-y-auto"
        placeholder="Paste your rental agreement, employment letter, loan document, or any legal text here..."
        value={text}
        onChange={e => setText(e.target.value)}
      />

      {/* Bottom controls — fixed */}
      <div className="shrink-0 space-y-2">
        <label className={`cursor-pointer text-xs border rounded-lg px-3 py-2 transition text-center block
          ${pdfLoading
            ? "text-slate-400 border-slate-200 bg-slate-50"
            : "text-blue-600 border-blue-200 hover:bg-blue-50"}`}>
          {pdfLoading ? "Reading PDF..." : "Upload PDF"}
          <input
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handlePDF}
            disabled={pdfLoading}
          />
        </label>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-600">
            {error}
          </div>
        )}

        <button
          onClick={() => onAnalyze(text)}
          disabled={!text.trim() || loading}
          className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium
                     hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {loading ? "Analysing..." : hasResult ? "Re-analyse" : "Analyse Document"}
        </button>

        <p className="text-xs text-slate-400 text-center leading-relaxed">
          For informational purposes only. Consult a lawyer before making legal decisions.
        </p>
      </div>
    </div>
  )
}