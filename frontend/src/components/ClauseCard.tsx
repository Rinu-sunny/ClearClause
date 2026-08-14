interface Result {
  clause_type: string
  plain_explanation: string
  risk_rating: "Green" | "Yellow" | "Red"
  flag: string
  disclaimer: string
}

interface Props {
  result: Result
}

const config = {
  Green:  { bg: "bg-green-50",  border: "border-green-400",  badge: "bg-green-100 text-green-700",  label: "✓ Low Risk" },
  Yellow: { bg: "bg-yellow-50", border: "border-yellow-400", badge: "bg-yellow-100 text-yellow-700", label: "⚠ Review Carefully" },
  Red:    { bg: "bg-red-50",    border: "border-red-400",    badge: "bg-red-100 text-red-700",       label: "✕ High Risk" },
}

export default function ClauseCard({ result }: Props) {
  const c = config[result.risk_rating] ?? config["Yellow"]

  return (
    <div className={`rounded-2xl border-l-4 shadow-sm p-6 space-y-4 ${c.bg} ${c.border}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm font-medium text-slate-500">{result.clause_type}</span>
        <span className={`text-xs font-semibold px-3 py-1 rounded-full ${c.badge}`}>
          {c.label}
        </span>
      </div>

      <p className="text-slate-800 text-sm leading-relaxed">
        {result.plain_explanation}
      </p>

      {result.flag && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            ⚠ Legal Flag
          </p>
          <p className="text-sm text-slate-700 leading-relaxed">{result.flag}</p>
        </div>
      )}

      <p className="text-xs text-slate-400 italic border-t border-slate-200 pt-3">
        {result.disclaimer}
      </p>
    </div>
  )
}