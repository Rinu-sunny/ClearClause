import type { Statement } from "../App"

interface Result {
  summary: string
  statements: Statement[]
  disclaimer: string
}

interface Props {
  result: Result
}

const config = {
  Green: { bg: "bg-green-50", border: "border-green-400", badge: "bg-green-100 text-green-700", label: "Low risk" },
  Yellow: { bg: "bg-yellow-50", border: "border-yellow-400", badge: "bg-yellow-100 text-yellow-700", label: "Review carefully" },
  Red: { bg: "bg-red-50", border: "border-red-400", badge: "bg-red-100 text-red-700", label: "High risk" },
}

export default function ClauseCard({ result }: Props) {
  const highRisk = result.statements.filter(statement => statement.risk_rating === "Red")
  const review = result.statements.filter(statement => statement.risk_rating === "Yellow")

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-slate-800">Analysis summary</h2>
          <div className="flex gap-2 text-xs font-semibold">
            <span className="rounded-full bg-red-100 text-red-700 px-3 py-1">{highRisk.length} high risk</span>
            <span className="rounded-full bg-yellow-100 text-yellow-700 px-3 py-1">{review.length} to review</span>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-slate-700">{result.summary}</p>
      </div>

      {highRisk.length > 0 && <StatementGroup title="High-risk statements" statements={highRisk} />}
      {review.length > 0 && <StatementGroup title="Statements to review" statements={review} />}
      {result.statements.filter(statement => statement.risk_rating === "Green").length > 0 && (
        <StatementGroup
          title="Low-risk statements"
          statements={result.statements.filter(statement => statement.risk_rating === "Green")}
        />
      )}

      <p className="text-xs text-slate-400 italic px-2">
        {result.disclaimer}
      </p>
    </div>
  )
}

function StatementGroup({ title, statements }: { title: string; statements: Statement[] }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {statements.map((statement, index) => {
        const c = config[statement.risk_rating]
        return (
          <article key={`${statement.statement}-${index}`} className={`rounded-2xl border-l-4 shadow-sm p-5 space-y-3 ${c.bg} ${c.border}`}>
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium leading-relaxed text-slate-800">“{statement.statement}”</p>
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${c.badge}`}>{c.label}</span>
            </div>
            <p className="text-sm leading-relaxed text-slate-700">{statement.explanation}</p>
            {statement.flag && <p className="rounded-xl bg-white/80 border border-slate-200 p-3 text-sm leading-relaxed text-slate-700">Legal flag: {statement.flag}</p>}
          </article>
        )
      })}
    </section>
  )
}