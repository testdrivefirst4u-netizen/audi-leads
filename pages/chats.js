import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Layout from "../components/Layout";
import CompanySwitcher from "../components/CompanySwitcher";
import { useToast } from "../components/ToastProvider";
import { getSessionFromCookieHeader } from "../lib/auth";
import { getCompanyBranding } from "../lib/companyBranding";
import { apiFetch } from "../lib/apiFetch";
import { WhatsAppIcon } from "../components/icons";

// WhatsApp inbox on the company's official number. Agents see and answer
// their own leads' conversations; admins see everything and can reassign.
// Free-text replies work inside WhatsApp's 24-hour window after the
// customer's last message; after that an approved template re-opens it.
export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  const branding = session.role === "super_admin" ? {} : await getCompanyBranding(session.companyId);
  return { props: { username: session.username, role: session.role || "admin", ...branding } };
}

const LIST_POLL_MS = 5000;
const THREAD_POLL_MS = 4000;

function timeAgo(d) {
  if (!d) return "";
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function dayLabel(d) {
  const dt = new Date(d);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (dt.toDateString() === today.toDateString()) return "Today";
  if (dt.toDateString() === yest.toDateString()) return "Yesterday";
  return dt.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function Ticks({ status }) {
  if (status === "failed") return <span className="text-danger" title="Failed">!</span>;
  if (status === "read") return <span className="text-[#53bdeb]" title="Read">✓✓</span>;
  if (status === "delivered") return <span className="text-muted" title="Delivered">✓✓</span>;
  if (status === "sent") return <span className="text-muted" title="Sent">✓</span>;
  return <span className="text-muted" title="Sending">◌</span>;
}

function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export default function ChatsPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const isSuperAdmin = role === "super_admin";
  const isAgent = role === "agent";
  const router = useRouter();
  const toast = useToast();
  const [companyId, setCompanyId] = useState(() => (typeof router.query.companyId === "string" ? router.query.companyId : ""));
  const ready = !isSuperAdmin || Boolean(companyId);
  const qs = useCallback(
    (extra = {}) => {
      const p = new URLSearchParams();
      if (isSuperAdmin && companyId) p.set("companyId", companyId);
      for (const [k, v] of Object.entries(extra)) if (v) p.set(k, String(v));
      const s = p.toString();
      return s ? `?${s}` : "";
    },
    [isSuperAdmin, companyId]
  );

  const [conversations, setConversations] = useState(null);
  const [box, setBox] = useState("all");
  const [q, setQ] = useState("");
  const [activeLead, setActiveLead] = useState(() => (typeof router.query.lead === "string" ? router.query.lead : ""));
  const [thread, setThread] = useState(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState("");
  const [agents, setAgents] = useState([]);
  const bottomRef = useRef(null);
  const lastCountRef = useRef(0);

  const loadList = useCallback(async () => {
    if (!ready) return;
    const res = await apiFetch(`/api/chats${qs({ q, box })}`);
    if (res.ok) setConversations((await res.json()).conversations || []);
  }, [ready, qs, q, box]);

  const loadThread = useCallback(async () => {
    if (!ready || !activeLead) return;
    const res = await apiFetch(`/api/chats/${activeLead}${qs()}`);
    if (res.ok) {
      const t = await res.json();
      setThread(t);
      if (t.messages.length !== lastCountRef.current) {
        lastCountRef.current = t.messages.length;
        setTimeout(() => bottomRef.current?.scrollIntoView({ block: "end" }), 50);
      }
    } else if (res.status === 404) {
      setThread(null);
    }
  }, [ready, activeLead, qs]);

  useEffect(() => {
    setConversations(null);
    const t = setTimeout(loadList, q ? 250 : 0);
    const i = setInterval(loadList, LIST_POLL_MS);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [loadList, q]);

  useEffect(() => {
    setThread(null);
    lastCountRef.current = 0;
    loadThread();
    const i = setInterval(loadThread, THREAD_POLL_MS);
    return () => clearInterval(i);
  }, [loadThread]);

  useEffect(() => {
    if (!ready) return;
    apiFetch(`/api/messaging/templates${qs({ channel: "whatsapp" })}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = (d?.templates || []).filter((t) => !t.waStatus || t.waStatus === "APPROVED");
        setTemplates(list);
        if (list[0]) setTemplateId(list[0]._id);
      })
      .catch(() => {});
    if (!isAgent) {
      apiFetch(`/api/agents${qs()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setAgents((d?.agents || []).filter((a) => a.active !== false)))
        .catch(() => {});
    }
  }, [ready, qs, isAgent]);

  async function send() {
    if (!activeLead || sending) return;
    const body = thread?.conversation.windowOpen ? { text } : { templateId };
    if (thread?.conversation.windowOpen && !text.trim()) return;
    if (!thread?.conversation.windowOpen && !templateId) return toast("Pick a template", { type: "err" });
    setSending(true);
    try {
      const res = await apiFetch(`/api/chats/${activeLead}${qs()}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return toast(d.error || "Could not send", { type: "err" });
      setText("");
      await loadThread();
      loadList();
    } finally {
      setSending(false);
    }
  }

  async function reassign(agentId) {
    const res = await apiFetch(`/api/chats/${activeLead}${qs()}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || "Could not reassign", { type: "err" });
    toast("Conversation reassigned", { type: "ok" });
    loadThread();
    loadList();
  }

  const grouped = useMemo(() => {
    const out = [];
    let last = "";
    for (const m of thread?.messages || []) {
      const label = dayLabel(m.timestamp);
      if (label !== last) {
        out.push({ divider: label, key: `d-${label}` });
        last = label;
      }
      out.push(m);
    }
    return out;
  }, [thread]);

  const unreadTotal = (conversations || []).reduce((n, c) => n + (c.unread > 0 ? 1 : 0), 0);
  const active = (conversations || []).find((c) => String(c.leadId) === String(activeLead));

  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div>
          <h1 className="page-title mb-1">Chats</h1>
          <p className="hint mb-4">
            WhatsApp conversations on the company number. {isAgent ? "You see the customers assigned to you." : "Replies go to the agent who owns the lead; new numbers are auto-assigned."}
          </p>
        </div>
      </div>

      {isSuperAdmin && <CompanySwitcher companyId={companyId} onChange={setCompanyId} editable />}

      {ready && (
        <div className="panel overflow-hidden" style={{ height: isSuperAdmin ? 640 : "calc(100vh - 230px)", minHeight: 520 }}>
          <div className="grid h-full" style={{ gridTemplateColumns: "minmax(260px, 340px) minmax(0, 1fr)" }}>
            {/* Conversation list */}
            <div className={`border-r border-border flex flex-col min-h-0 ${activeLead ? "hidden md:flex" : "flex"}`}>
              <div className="p-3 border-b border-border">
                <input className="search-input w-full" placeholder="Search name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
                <div className="flex gap-1.5 mt-2">
                  {[
                    ["all", "All"],
                    ["unread", `Unread${unreadTotal ? ` (${unreadTotal})` : ""}`],
                    ...(isAgent ? [] : [["unassigned", "Unassigned"]]),
                  ].map(([k, l]) => (
                    <button key={k} className={`report-type-tab !mb-0 !px-2.5 !py-1 !text-[12px] ${box === k ? "active" : ""}`} onClick={() => setBox(k)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {conversations === null ? (
                  <div className="hint p-4">Loading…</div>
                ) : conversations.length === 0 ? (
                  <div className="p-6 text-center">
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#e7f9ee] text-[#128c7e] mb-2">
                      <WhatsAppIcon />
                    </div>
                    <div className="text-[13px] text-muted">
                      {box === "unread" ? "No unread chats." : "No conversations yet. When a customer messages the company number or replies to a campaign, it appears here."}
                    </div>
                  </div>
                ) : (
                  conversations.map((c) => {
                    const isActive = String(c.leadId) === String(activeLead);
                    return (
                      <button
                        key={c._id}
                        type="button"
                        onClick={() => setActiveLead(String(c.leadId))}
                        className={`w-full text-left flex items-start gap-3 px-3.5 py-3 border-b border-border/70 cursor-pointer transition-colors ${isActive ? "bg-accent-soft" : "bg-transparent hover:bg-bg"}`}
                      >
                        <span className={`flex-none inline-flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-bold ${c.unread ? "bg-accent text-white" : "bg-bg text-muted"}`}>{initials(c.lead?.name || c.phone)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className={`truncate text-[13.5px] ${c.unread ? "font-bold text-ink" : "font-semibold text-ink"}`}>{c.lead?.name || c.phone}</span>
                            <span className={`flex-none text-[11px] ${c.unread ? "text-accent font-bold" : "text-muted"}`}>{timeAgo(c.lastMessageAt)}</span>
                          </span>
                          <span className="flex items-center justify-between gap-2 mt-0.5">
                            <span className={`truncate text-[12.5px] ${c.unread ? "text-ink" : "text-muted"}`}>
                              {c.lastDirection === "out" && <span className="text-muted">You: </span>}
                              {c.lastMessageText || "…"}
                            </span>
                            {c.unread > 0 && <span className="flex-none inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-accent text-white text-[10.5px] font-bold px-1">{c.unread}</span>}
                          </span>
                          <span className="flex items-center gap-1.5 mt-1 text-[11px] text-muted truncate">
                            {c.lead?.canonicalModel && <span>{c.lead.canonicalModel}</span>}
                            {c.lead?.canonicalModel && <span>·</span>}
                            <span className={c.agent ? "" : "text-[#b45309] font-semibold"}>{c.agent?.name || "Unassigned"}</span>
                            {!c.windowOpen && <span title="24-hour reply window closed — template needed">· ⏱</span>}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Thread */}
            <div className={`flex flex-col min-h-0 min-w-0 ${activeLead ? "flex" : "hidden md:flex"}`}>
              {!activeLead ? (
                <div className="flex-1 flex items-center justify-center text-center p-8">
                  <div>
                    <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#e7f9ee] text-[#128c7e] mb-3">
                      <WhatsAppIcon width={26} height={26} />
                    </div>
                    <div className="font-bold text-ink">Pick a conversation</div>
                    <div className="hint m-0 mt-1">Customer replies land here in real time.</div>
                  </div>
                </div>
              ) : !thread ? (
                <div className="hint p-5">Loading conversation…</div>
              ) : (
                <>
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
                    <button className="btn-icon md:hidden" onClick={() => setActiveLead("")} aria-label="Back">
                      ‹
                    </button>
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-bg text-muted text-[12px] font-bold">{initials(thread.lead?.name || thread.conversation.phone)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-ink text-[14px] truncate">{thread.lead?.name || thread.conversation.phone}</div>
                      <div className="hint m-0 truncate">
                        +{thread.conversation.phone}
                        {thread.lead?.canonicalModel && ` · ${thread.lead.canonicalModel}`}
                        {thread.lead?.status && ` · ${thread.lead.status}`}
                        {thread.lead?.whatsappOptOut && <span className="text-danger"> · opted out</span>}
                      </div>
                    </div>
                    {!isAgent ? (
                      <select className="search-input !w-auto !text-[12.5px]" value={thread.conversation.agent?._id || ""} onChange={(e) => reassign(e.target.value)} title="Assigned agent">
                        <option value="">Unassigned</option>
                        {agents.map((a) => (
                          <option key={a._id} value={a._id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      thread.conversation.agent && <span className="pill bg-bg text-muted">{thread.conversation.agent.name}</span>
                    )}
                    <Link href={`/leads?q=${encodeURIComponent(thread.lead?.phone || thread.conversation.phone)}${isSuperAdmin && companyId ? `&companyId=${companyId}` : ""}`} className="btn-sm no-underline">
                      Open lead
                    </Link>
                  </div>

                  <div className="flex-1 overflow-y-auto px-4 py-4" style={{ background: "#efeae2" }}>
                    {grouped.map((m) =>
                      m.divider ? (
                        <div key={m.key} className="flex justify-center my-3">
                          <span className="rounded-md bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-muted shadow-sm">{m.divider}</span>
                        </div>
                      ) : (
                        <div key={m._id} className={`flex mb-1.5 ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[78%] rounded-xl px-3 py-2 text-[13.5px] text-ink shadow-sm whitespace-pre-wrap ${m.direction === "out" ? "bg-[#d9fdd3]" : "bg-white"}`} style={{ lineHeight: 1.45 }}>
                            {m.kind === "template" && <div className="text-[10.5px] font-bold uppercase tracking-wide text-[#128c7e] mb-0.5">{m.campaignId ? "Campaign" : "Template"}</div>}
                            {m.text}
                            <div className="flex items-center justify-end gap-1 mt-0.5 text-[10.5px] text-muted">
                              {m.direction === "out" && m.sentBy && <span className="truncate max-w-[160px]">{m.sentBy} ·</span>}
                              <span>{new Date(m.timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                              {m.direction === "out" && <Ticks status={m.status} />}
                            </div>
                            {m.error && <div className="text-[11px] text-danger mt-0.5">{m.error}</div>}
                          </div>
                        </div>
                      )
                    )}
                    <div ref={bottomRef} />
                  </div>

                  <div className="border-t border-border bg-card p-3">
                    {thread.lead?.whatsappOptOut ? (
                      <div className="hint m-0 text-danger">This customer has opted out of WhatsApp messages. Remove the opt-out from the lead if they ask to be contacted again.</div>
                    ) : thread.conversation.windowOpen ? (
                      <div className="flex items-end gap-2">
                        <textarea
                          className="flex-1 resize-none rounded-xl border border-border bg-bg px-3.5 py-2.5 text-[13.5px] focus:outline-none focus:border-accent"
                          rows={2}
                          placeholder="Type a reply… (Enter to send, Shift+Enter for a new line)"
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              send();
                            }
                          }}
                        />
                        <button className="btn" disabled={sending || !text.trim()} onClick={send}>
                          {sending ? "…" : "Send"}
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div className="hint mb-2">
                          The 24-hour reply window has closed{thread.conversation.windowClosesAt ? ` (${new Date(thread.conversation.windowClosesAt).toLocaleString()})` : ""}. Send an approved template to re-open it — the customer's reply lets you chat freely again.
                        </div>
                        <div className="flex items-center gap-2">
                          <select className="search-input flex-1" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                            {templates.length === 0 && <option value="">No approved templates — add one under Campaigns → Templates</option>}
                            {templates.map((t) => (
                              <option key={t._id} value={t._id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                          <button className="btn" disabled={sending || !templateId} onClick={send}>
                            {sending ? "…" : "Send template"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
