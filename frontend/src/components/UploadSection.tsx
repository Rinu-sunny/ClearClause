import { useState } from "react"

interface Props {
  onAnalyze: (text: string) => void
  loading: boolean
}

export default function UploadSection({ onAnalyze, loading }: Props) {
  const [text, setText] = useState("")

  const handlePDF = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append("file", file)
    const res = await fetch("http://localhost:8000/upload", {
      method: "POST", body: form,
    })
    const data = await res.json()
    setText(data.text)
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
      <h2 className="font-semibold text-slate-700 text-lg">
        Paste a clause or upload a document
      </h2>
      <textarea
        className="w-full border border-slate-200 rounded-xl p-3 text-sm
                   text-slate-700 resize-none focus:outline-none focus:ring-2
                   focus:ring-blue-500 h-40"
        placeholder="Paste a clause from your rental agreement, employment letter, or loan document..."
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <label className="cursor-pointer text-sm text-blue-600 border border-blue-300
                          rounded-lg px-3 py-2 hover:bg-blue-50 transition">
          Upload PDF
          <input type="file" accept=".pdf" className="hidden" onChange={handlePDF} />
        </label>
        <span className="text-slate-400 text-xs">or paste text above</span>
      </div>
      <button
        onClick={() => onAnalyze(text)}
        disabled={!text.trim() || loading}
        className="w-full bg-blue-700 text-white rounded-xl py-3 font-medium
                   hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        {loading ? "Analysing..." : "Analyse Clause"}
      </button>
    </div>
  )
}