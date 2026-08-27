import { useEffect, useState, useCallback } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

type Rule = {
  id: number;
  clause_type: string;
  rule: string;
  source: string;
  state: string;
  risk_level: string;
};

type FormState = {
  clause_type: string;
  rule: string;
  source: string;
  state: string;
  risk_level: string;
};

const EMPTY_FORM: FormState = {
  clause_type: "",
  rule: "",
  source: "",
  state: "",
  risk_level: "Yellow",
};

export default function AdminPanel({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [status, setStatus] = useState("");
  const [pdfSource, setPdfSource] = useState("");
  const [pdfState, setPdfState] = useState("All India");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfStatus, setPdfStatus] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadInProgress, setUploadInProgress] = useState(false);

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const loadRules = useCallback(async () => {
    const res = await fetch(`${API_BASE_URL}/admin/rules`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (res.status === 401) {
      onLogout();
      return;
    }
    const data = await res.json();
    setRules(data.rules);
  }, [token, onLogout]);

  useEffect(() => {
    const loadRulesTimer = window.setTimeout(() => {
      void loadRules();
    }, 0);
    return () => window.clearTimeout(loadRulesTimer);
  }, [loadRules]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("Embedding and saving...");
    const res = await fetch(`${API_BASE_URL}/admin/rules`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      setStatus("Failed to add rule.");
      return;
    }
    setForm(EMPTY_FORM);
    setStatus("Rule added.");
    loadRules();
  };
  const handlePdfUpload = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!pdfFile || !pdfSource.trim()) {
    setPdfStatus("Choose a PDF and enter a source name first.");
    return;
  }
  setUploadProgress(1);
  setUploadInProgress(true);
  setPdfStatus("Extracting, chunking, and embedding — this may take a minute for long documents...");
  const form = new FormData();
  form.append("file", pdfFile);
  form.append("source", pdfSource);
  form.append("state", pdfState);

  try {
    const data = await new Promise<{ chunks_inserted: number }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE_URL}/admin/upload-document`);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.max(1, Math.min(70, Math.round((e.loaded / e.total) * 70))));
        }
      };
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error());
          return;
        }
        setUploadProgress(100);
        resolve(JSON.parse(xhr.responseText));
      };
      xhr.onerror = () => reject(new Error());
      xhr.send(form);
    });
    setPdfStatus(`Added ${data.chunks_inserted} chunks to the database.`);
    setPdfFile(null);
    loadRules();
  } catch {
    setPdfStatus("Upload failed. Check the file and try again.");
  } finally {
    setUploadInProgress(false);
    setUploadProgress(0);
  }
};
  const handleDelete = async (id: number) => {
    await fetch(`${API_BASE_URL}/admin/rules/${id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    loadRules();
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-4 shrink-0">
        <h1 className="text-xl font-semibold">ClearClause — Admin: Legal Rules</h1>
        <button onClick={onLogout} className="text-sm text-gray-500 underline">
          Log out
        </button>
      </div>

      <form onSubmit={handleAdd} className="grid grid-cols-2 gap-2 mb-4 bg-gray-50 p-3 rounded-xl shrink-0">
        <input
          placeholder="Clause type"
          value={form.clause_type}
          onChange={(e) => setForm({ ...form, clause_type: e.target.value })}
          className="border rounded-lg px-3 py-1.5 col-span-2 text-sm"
          required
        />
        <textarea
          placeholder="Rule text (this gets embedded)"
          value={form.rule}
          onChange={(e) => setForm({ ...form, rule: e.target.value })}
          className="border rounded-lg px-3 py-1.5 col-span-2 text-sm"
          rows={2}
          required
        />
        <input
          placeholder="Source (e.g. Kerala Rent Control Act 1965)"
          value={form.source}
          onChange={(e) => setForm({ ...form, source: e.target.value })}
          className="border rounded-lg px-3 py-1.5 text-sm"
          required
        />
        <input
          placeholder="State"
          value={form.state}
          onChange={(e) => setForm({ ...form, state: e.target.value })}
          className="border rounded-lg px-3 py-1.5 text-sm"
          required
        />
        <select
          value={form.risk_level}
          onChange={(e) => setForm({ ...form, risk_level: e.target.value })}
          className="border rounded-lg px-3 py-1.5 col-span-2 text-sm"
        >
          <option>Green</option>
          <option>Yellow</option>
          <option>Red</option>
        </select>
        <button type="submit" className="col-span-2 bg-black text-white rounded-lg py-1.5 text-sm">
          Add rule to RAG
        </button>
        {status && <p className="col-span-2 text-xs text-gray-500">{status}</p>}
      </form>
      <form onSubmit={handlePdfUpload} className="grid grid-cols-2 gap-2 mb-4 bg-gray-50 p-3 rounded-xl shrink-0">
  <h3 className="col-span-2 text-sm font-medium text-gray-600">Upload a legal PDF (bare act, notification, etc.)</h3>
  <input
    type="file"
    accept=".pdf"
    onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
    className="border rounded-lg px-3 py-1.5 col-span-2 text-sm"
  />
  <input
    placeholder="Source name (e.g. Kerala Rent Control Act 1965 — full text)"
    value={pdfSource}
    onChange={(e) => setPdfSource(e.target.value)}
    className="border rounded-lg px-3 py-1.5 col-span-2 text-sm"
  />
  <input
    placeholder="State (e.g. Kerala, All India)"
    value={pdfState}
    onChange={(e) => setPdfState(e.target.value)}
    className="border rounded-lg px-3 py-1.5 col-span-2 text-sm"
  />
  <button type="submit" className="col-span-2 bg-slate-700 text-white rounded-lg py-1.5 text-sm">
    Upload & embed PDF
  </button>
  {uploadProgress > 0 && uploadInProgress && (
    <>
      <div className="w-full bg-slate-200 rounded-full h-2 mt-2">
        <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
      </div>
      <p className="text-xs text-slate-500 mt-1">{uploadProgress}% uploaded</p>
    </>
  )}
  {pdfStatus && <p className="col-span-2 text-xs text-gray-500">{pdfStatus}</p>}
</form>
      <h2 className="text-sm font-medium text-gray-500 mb-2 shrink-0">
        Existing rules ({rules.length})
      </h2>

      <div className="flex-1 min-h-0 overflow-y-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white shadow-sm">
            <tr className="text-left border-b">
              <th className="py-2 px-2">Type</th>
              <th className="py-2 px-2">Rule</th>
              <th className="py-2 px-2">Source</th>
              <th className="py-2 px-2">State</th>
              <th className="py-2 px-2">Risk</th>
              <th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="py-2 px-2">{r.clause_type}</td>
                <td className="py-2 px-2 max-w-xs truncate">{r.rule}</td>
                <td className="py-2 px-2">{r.source}</td>
                <td className="py-2 px-2">{r.state}</td>
                <td className="py-2 px-2">{r.risk_level}</td>
                <td className="py-2 px-2">
                  <button onClick={() => handleDelete(r.id)} className="text-red-500">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}