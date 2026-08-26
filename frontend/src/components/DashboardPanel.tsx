import type { AnalysisResult, Statement } from "../App"

interface Props {
  result: AnalysisResult | null
  loading: boolean
}

const RISK_CONFIG = {
  Red:    { bg: "bg-red-50",   border: "border-red-400",   badge: "bg-red-100 text-red-700",     dot: "bg-red-500",   label: "High Risk" },
  Yellow: { bg: "bg-amber-50", border: "border-amber-400", badge: "bg-amber-100 text-amber-700", dot: "bg-amber-500", label: "Review" },
  Green:  { bg: "bg-green-50", border: "border-green-400", badge: "bg-green-100 text-green-700", dot: "bg-green-500", label: "Low Risk" },
}

export default function DashboardPanel({ result, loading }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-400">Analysing your document...</p>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2 px-8">
          <div className="text-4xl">📄</div>
          <p className="text-sm font-medium text-slate-600">No document analysed yet</p>
          <p className="text-xs text-slate-400">Paste or upload a document on the left to get started</p>
        </div>
      </div>
    )
  }

  const red = result.statements.filter(s => s.risk_rating === "Red")
  const yellow = result.statements.filter(s => s.risk_rating === "Yellow")
  const green = result.statements.filter(s => s.risk_rating === "Green")

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 shrink-0">
        <StatCard count={red.length} label="High Risk" color="text-red-600" bg="bg-red-50" border="border-red-200" />
        <StatCard count={yellow.length} label="Review" color="text-amber-600" bg="bg-amber-50" border="border-amber-200" />
        <StatCard count={green.length} label="Low Risk" color="text-green-600" bg="bg-green-50" border="border-green-200" />
      </div>

      {/* Summary */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Document Summary</h3>
        <p className="text-sm text-slate-700 leading-relaxed">{result.summary}</p>
      </div>

      {/* Clauses */}
      {red.length > 0 && <ClauseGroup title="High Risk Clauses" statements={red} />}
      {yellow.length > 0 && <ClauseGroup title="Clauses to Review" statements={yellow} />}
      {green.length > 0 && <ClauseGroup title="Low Risk Clauses" statements={green} />}

      <p className="text-xs text-slate-400 italic pb-2">{result.disclaimer}</p>
    </div>
  )
}

function StatCard({ count, label, color, bg, border }: {
  count: number; label: string; color: string; bg: string; border: string
}) {
  return (
    <div className={`rounded-2xl border ${bg} ${border} p-4 text-center`}>
      <p className={`text-3xl font-bold ${color}`}>{count}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
    </div>
  )
}

function ClauseGroup({ title, statements }: { title: string; statements: Statement[] }) {
  const c = RISK_CONFIG[statements[0].risk_rating]
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${c.dot}`} />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      </div>
      {statements.map((s, i) => (
        <div key={i} className={`rounded-2xl border-l-4 ${c.bg} ${c.border} p-4 space-y-2`}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-medium text-slate-600 leading-relaxed italic">"{s.statement}"</p>
            <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${c.badge}`}>
              {c.label}
            </span>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">{s.explanation}</p>
          {s.flag && (
            <div className="rounded-lg bg-white/70 border border-slate-200 px-3 py-2">
              <p className="text-xs text-slate-500">
                <span className="font-semibold">⚠ Legal flag: </span>{s.flag}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}