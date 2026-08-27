import { useState } from "react"

interface Props {
  onAnalyze: (text: string) => void
  loading: boolean
  error: string
  hasResult: boolean
  language: string
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"

export default function DocumentPanel({ onAnalyze, loading, error, hasResult, language }: Props) {
  const [text, setText] = useState("")
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState("")

  const handlePDF = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setPdfError("Please choose a PDF agreement.")
      return
    }
    setPdfLoading(true)
    setPdfError("")
    try {
      const form = new FormData()
      form.append("file", file)
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 50000)
      const res = await fetch(`${API_BASE_URL}/upload?language=${encodeURIComponent(language)}`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeout))
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.detail ?? `PDF upload failed (${res.status})`)
      }
      if (typeof data?.text !== "string" || !data.text.trim()) {
        throw new Error("No readable text was found. Please use a text-based PDF.")
      }
      setText(data.text)
    } catch (err) {
      setPdfError(err instanceof DOMException && err.name === "AbortError"
        ? "PDF reading timed out. Check the OCR service or try a smaller PDF."
        : err instanceof Error ? err.message : "Could not read this PDF.")
    } finally {
      setPdfLoading(false)
      e.target.value = ""
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

        {pdfError && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-600">
            {pdfError}
          </div>
        )}

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