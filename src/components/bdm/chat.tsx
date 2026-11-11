"use client";

import { useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";

type Msg = { role: "user" | "assistant"; text: string; error?: boolean };

const SUGGESTIONS = [
  "Which 10 companies should I contact today?",
  "Which proposals are pending follow-up?",
  "Which deals have the highest closing potential?",
  "Which leads haven't been contacted in 30 days?",
  "Which companies replied but haven't received a response?",
  "Which industries are generating the most opportunities?",
  "What should I do to improve this month's sales?",
];

export function SalesChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const history = messages.filter((m) => !m.error).slice(-6).map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { role: "user", text }]);
    setQ("");
    setBusy(true);
    try {
      const res = await fetch("/api/bdm/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, history }) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; answer?: string; error?: string };
      setMessages((m) => [...m, body.ok && body.answer ? { role: "assistant", text: body.answer } : { role: "assistant", text: body.error ?? "Something went wrong.", error: true }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Could not reach the server. Check your connection and try again.", error: true }]);
    } finally {
      setBusy(false);
      setTimeout(() => end.current?.scrollIntoView({ block: "nearest" }), 50);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-5">
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-border-strong hover:text-foreground">{s}</button>
          ))}
        </div>
      )}
      {messages.length > 0 && (
        <div className="max-h-96 space-y-3 overflow-y-auto pr-1" aria-live="polite">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex"}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-btn-primary text-btn-primary-foreground" : m.error ? "border border-danger/30 bg-danger-soft text-danger" : "border border-border bg-surface-muted/60"}`}>
                {m.text}
              </div>
            </div>
          ))}
          {busy && <p className="text-xs text-muted">Reading your CRM data…</p>}
          <div ref={end} />
        </div>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about leads, proposals, deals…" aria-label="Ask the AI sales assistant" maxLength={500} />
        <Button type="submit" variant="primary" loading={busy} aria-label="Send"><Send className="h-4 w-4" aria-hidden /></Button>
      </form>
      <p className="flex items-center gap-1 text-xs text-muted"><Sparkles className="h-3 w-3" aria-hidden />Answers use your live CRM data. Estimates are not guarantees. Nothing is sent or changed from here.</p>
    </div>
  );
}
