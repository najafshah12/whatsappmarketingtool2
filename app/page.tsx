"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Archive, Bell, CalendarClock, CalendarDays, Check, ChevronRight, CircleHelp, Clock3, ContactRound, FileText, KeyRound, LayoutDashboard, LoaderCircle, LogOut, Menu, MessageCircle, MessageSquare, Pencil, Phone, Plus, QrCode, RefreshCw, Search, Send, Settings, ShieldCheck, Sparkles, Trash2, Users, X } from "lucide-react";

type Contact = { id: string; name: string; phone: string; email: string | null; groupName: string | null; tags: string[]; optedOut: boolean; marketingOptIn: boolean };
type TemplateButton = { type: "QUICK_REPLY"; text: string } | { type: "URL"; text: string; url: string } | { type: "PHONE_NUMBER"; text: string; phoneNumber: string };
type Account = { id: string; name: string; phone: string; status: string; provider?: string; bridgeSessionId?: string | null; phoneNumberId?: string | null; businessAccountId?: string | null; tokenExpiresAt?: string | null; webhookSubscribedAt?: string | null; _count?: { campaignAssignments: number } };
type Group = { id: string; name: string; description?: string | null; _count: { members: number }; members?: { contactId: string }[] };
type Campaign = { id: string; name: string; message: string; rotationIntervalSeconds?: number; status: string; total: number; delivered: number; read: number; failed: number; createdAt: string; scheduledAt?: string | null; accountAssignments?: { account: Account }[]; audienceGroup?: Group | null; template?: { id: string; name: string; body: string; status: string; language: string; accountId?: string | null } | null };
type Template = { id: string; name: string; body: string; status: string; language: string; category?: string; buttons?: TemplateButton[] | null; accountId?: string | null; account?: { id: string; name: string; status: string } | null };
type MetaConfig = { enabled: boolean; cronConfigured: boolean; appId: string; configId: string; graphVersion: string; missing: string[] };
type Conversation = { id: string; status: string; unreadCount: number; lastMessageAt: string; contact: { id: string; name: string; phone: string }; messages: { body: string; direction: string; createdAt: string }[] };
type InboxDetail = { id: string; status: string; contact: { name: string; phone: string }; messages: { id: string; body: string; direction: string; createdAt: string }[] };
type AudienceData = { groups: Group[]; contacts: number; optedOut: number; eligible: number };
type Stats = { contacts: number; campaigns: number; messages: number; failed: number; delivered: number; running: number; accounts: number; unread: number; recent: Campaign[] };

type MetaSignupDetails = { wabaId: string; phoneNumberId: string; businessId?: string };
type MetaSignupSdk = { init: (config: { appId: string; xfbml?: boolean; version: string }) => void; login: (callback: (response: { authResponse?: { code?: string }; code?: string }) => void, options: Record<string, unknown>) => void };
declare global { interface Window { FB?: MetaSignupSdk } }

const nav = [
  { id: "Dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "Inbox", label: "Inbox", icon: MessageSquare },
  { id: "Previous Campaign Records", label: "Campaign History", icon: Archive },
  { id: "Campaign Reports", label: "Campaign Reports", icon: FileText },
  { id: "Accounts", label: "WhatsApp Accounts", icon: Phone },
  { id: "Create Campaign", label: "Create Campaign", icon: Send },
  { id: "Audience Pool", label: "Contacts & Audience", icon: Users },
  { id: "Campaign Designer", label: "Message Templates", icon: Sparkles },
  { id: "Sending & Schedule", label: "Schedule & Queue", icon: CalendarClock },
];
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as T;
}
function Pill({ children, tone = "" }: { children: React.ReactNode; tone?: string }) { return <span className={`pill ${tone}`}>{children}</span>; }
function date(value?: string | null) { return value ? new Date(value).toLocaleString() : "—"; }

export default function Home() {
  const [section, setSection] = useState("Dashboard"), [mobileOpen, setMobileOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]), [accounts, setAccounts] = useState<Account[]>([]), [groups, setGroups] = useState<Group[]>([]), [campaigns, setCampaigns] = useState<Campaign[]>([]), [templates, setTemplates] = useState<Template[]>([]), [conversations, setConversations] = useState<Conversation[]>([]), [stats, setStats] = useState<Stats | null>(null), [audience, setAudience] = useState<AudienceData | null>(null);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [metaConfig, setMetaConfig] = useState<MetaConfig | null>(null), [signupCode, setSignupCode] = useState(""), [signupDetails, setSignupDetails] = useState<MetaSignupDetails | null>(null), [metaSdkReady, setMetaSdkReady] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<InboxDetail | null>(null), [search, setSearch] = useState(""), [toast, setToast] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [accountForm, setAccountForm] = useState(false), [groupForm, setGroupForm] = useState(false), [templateForm, setTemplateForm] = useState(false), [contactForm, setContactForm] = useState(false), [replyBusy, setReplyBusy] = useState(false);
  const [tokenForm, setTokenForm] = useState(false), [tokenMode, setTokenMode] = useState<"connect" | "update">("connect"), [tokenAccountId, setTokenAccountId] = useState(""), [tokenAccountName, setTokenAccountName] = useState(""), [tokenPhoneId, setTokenPhoneId] = useState(""), [tokenWabaId, setTokenWabaId] = useState("");
  const [bridgeForm, setBridgeForm] = useState(false);
  const [qrAccount, setQrAccount] = useState<Account | null>(null), [qrState, setQrState] = useState<{ status: string; bridgeStatus: string; qr: string | null; phone: string | null } | null>(null), [qrError, setQrError] = useState("");
  const [health, setHealth] = useState<{ status: string; checks: Record<string, string>; responseTimeMs: number } | null>(null), [healthBusy, setHealthBusy] = useState(false);
  const [verifyingId, setVerifyingId] = useState("");
  const [testingId, setTestingId] = useState("");
  const [origin, setOrigin] = useState("");
  const [importAudience, setImportAudience] = useState("");
  const [importOptIn, setImportOptIn] = useState(false);
  const [pastePhones, setPastePhones] = useState("");
  const [templateButtons, setTemplateButtons] = useState<TemplateButton[]>([]);
  const refresh = useCallback(async () => {
    setError("");
    try {
      const [s, c, a, g, ca, t, i, config] = await Promise.all([api<Stats>("/api/stats"), api<Contact[]>("/api/contacts"), api<Account[]>("/api/accounts"), api<AudienceData>("/api/audiences"), api<Campaign[]>("/api/campaigns"), api<Template[]>("/api/templates"), api<Conversation[]>("/api/inbox"), api<MetaConfig>("/api/whatsapp/config")]);
      setStats(s); setContacts(c); setAccounts(a); setGroups(g.groups); setAudience(g); setCampaigns(ca); setTemplates(t); setConversations(i); setMetaConfig(config);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load workspace data"); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), Math.min(10000, Math.max(3000, toast.length * 55))); return () => clearTimeout(id); }, [toast]);

  const filteredConversations = useMemo(() => conversations.filter(x => `${x.contact.name} ${x.contact.phone} ${x.messages[0]?.body ?? ""}`.toLowerCase().includes(search.toLowerCase())), [conversations, search]);
  const loadConversation = async (id: string) => { try { const data = await api<InboxDetail>(`/api/inbox/${id}`, { method: "PATCH", body: JSON.stringify({ status: "open" }) }); const detail = await api<InboxDetail>(`/api/inbox/${id}`); setSelectedConversation(detail); await refresh(); } catch (e) { setToast(e instanceof Error ? e.message : "Could not open conversation"); } };
  const runHealthCheck = async () => { setHealthBusy(true); try { const response = await fetch("/api/health", { cache: "no-store" }); const result = await response.json(); setHealth(result); setToast(result.status === "ok" ? "All systems healthy." : "Some checks need attention."); } catch (e) { setHealth(null); setToast(e instanceof Error ? e.message : "Health check failed"); } finally { setHealthBusy(false); } };
  const createAccount = async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); try { await api("/api/accounts", { method: "POST", body: JSON.stringify({ name: form.get("name"), phone: form.get("phone"), phoneNumberId: form.get("phoneNumberId"), businessAccountId: form.get("businessAccountId") }) }); setAccountForm(false); setToast("Sender record saved. Connect it with Meta before sending."); await refresh(); } catch (e) { setToast(e instanceof Error ? e.message : "Could not save account"); } finally { setBusy(false); } };
  const disconnectAccount = async (account: Account) => { if (!confirm(`Disconnect ${account.name} from WhatsApp?`)) return; try { await api(`/api/accounts/${account.id}/disconnect`, { method: "POST" }); await refresh(); } catch (e) { setToast(e instanceof Error ? e.message : "Could not disconnect account"); } };
  const addBridgeAccount = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const account = await api<Account>("/api/accounts", { method: "POST", body: JSON.stringify({ name: form.get("name"), phone: form.get("phone"), provider: "bridge", bridgeSessionId: form.get("bridgeSessionId") }) });
      setBridgeForm(false);
      setToast("QR sender saved. Scan its QR code to connect WhatsApp.");
      await refresh();
      setQrAccount(account); setQrState(null); setQrError("");
    } catch (err) { setToast(err instanceof Error ? err.message : "Could not add the QR sender"); } finally { setBusy(false); }
  };
  const openQr = (account: Account) => { setQrAccount(account); setQrState(null); setQrError(""); };
  useEffect(() => {
    if (!qrAccount) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const data = await api<{ status: string; bridgeStatus: string; qr: string | null; phone: string | null }>(`/api/accounts/${qrAccount.id}/qr`);
        if (cancelled) return;
        setQrState(data); setQrError("");
        if (data.status === "connected") { setToast(`${qrAccount.name} is connected${data.phone ? ` as ${data.phone}` : ""}.`); await refresh(); return; }
      } catch (err) {
        if (cancelled) return;
        setQrError(err instanceof Error ? err.message : "Could not load the QR code");
      }
      timer = setTimeout(() => void load(), 3000);
    };
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [qrAccount, refresh]);
  const verifyAccount = async (account: Account) => {
    setVerifyingId(account.id);
    try {
      const res = await api<{ ok: boolean; phone?: string; verifiedName?: string; qualityRating?: string | null; isPermanent: boolean; daysRemaining: number | null; expiresAt: string | null; provider?: string; message?: string }>(`/api/accounts/${account.id}/verify`, { method: "POST" });
      if (res.provider === "bridge") {
        setToast(res.message || `QR sender connected${res.phone ? ` as ${res.phone}` : ""}.`);
        await refresh();
        return;
      }
      const expiry = res.isPermanent
        ? "permanent token"
        : res.daysRemaining != null
          ? `token valid ${res.daysRemaining} more day(s)`
          : "token expiry unknown";
      setToast(`Live ✓ ${res.verifiedName || account.name} · ${res.phone || account.phone} · quality ${res.qualityRating || "not rated"} · ${expiry}`);
      await refresh();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Could not check this sender");
    } finally {
      setVerifyingId("");
    }
  };
  const sendTestMessage = async (account: Account) => {
    const to = prompt(`Send a WhatsApp test message from ${account.name} to which number?\n\nInclude the country code, for example +923001234567`, "");
    if (!to) return;
    setTestingId(account.id);
    try {
      const res = await api<{ message?: string }>(`/api/accounts/${account.id}/test-send`, { method: "POST", body: JSON.stringify({ to }) });
      setToast(res.message || "Test message accepted by Meta.");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Could not send the test message");
    } finally {
      setTestingId("");
    }
  };
  const handleTokenSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const accessToken = String(form.get("accessToken") || "").trim();
    if (!accessToken) { setToast("Please enter a WhatsApp Access Token"); return; }
    setBusy(true);
    try {
      if (tokenMode === "update" && tokenAccountId) {
        const res = await api<{ message?: string }>(`/api/accounts/${tokenAccountId}/token`, {
          method: "POST",
          body: JSON.stringify({ accessToken }),
        });
        setToast(res.message || "Access token updated successfully!");
      } else {
        const res = await api<{ message?: string; account: Account }>(`/api/accounts/connect-token`, {
          method: "POST",
          body: JSON.stringify({
            name: form.get("name") || undefined,
            phone: form.get("phone") || undefined,
            phoneNumberId: form.get("phoneNumberId") || undefined,
            businessAccountId: form.get("businessAccountId"),
            accessToken,
          }),
        });
        setToast(res.message || "WhatsApp Account connected with 60-day token!");
      }
      setTokenForm(false);
      await refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Failed to connect token");
    } finally {
      setBusy(false);
    }
  };
  const createGroup = async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const form = new FormData(e.currentTarget); const contactIds = form.getAll("contactIds").map(String); setBusy(true); try { await api("/api/audiences", { method: "POST", body: JSON.stringify({ name: form.get("name"), description: form.get("description"), contactIds }) }); setGroupForm(false); setToast("Audience list saved"); await refresh(); } catch (e) { setToast(e instanceof Error ? e.message : "Could not save audience"); } finally { setBusy(false); } };
  const createTemplate = async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); try { await api("/api/templates", { method: "POST", body: JSON.stringify({ name: form.get("name"), body: form.get("body"), language: form.get("language"), category: form.get("category"), buttons: templateButtons, status: "draft" }) }); setTemplateForm(false); setTemplateButtons([]); setToast("Draft saved in the database"); await refresh(); } catch (e) { setToast(e instanceof Error ? e.message : "Could not save template"); } finally { setBusy(false); } };
  const createCampaign = async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const form = new FormData(e.currentTarget); const groupId = String(form.get("groupId") || ""); const group = groups.find(x => x.id === groupId); const pickedContactIds = form.getAll("contactIds").map(String); const contactIds = group ? [] : (pickedContactIds.length ? pickedContactIds : contacts.filter(c => c.marketingOptIn && !c.optedOut).map(c => c.id)); const accountIds = form.getAll("accountIds").map(String); const rotationIntervalSeconds = form.get("rotateSenders") === "on" ? Number(form.get("rotationIntervalSeconds") || 10) : 0; const scheduledAt = String(form.get("scheduledAt") || ""); const templateId = String(form.get("templateId") || ""); setBusy(true); try { await api("/api/campaigns", { method: "POST", body: JSON.stringify({ name: form.get("name"), message: form.get("message"), templateId: templateId || undefined, contactIds, accountIds, rotationIntervalSeconds, ...(group ? { audienceGroupId: group.id } : {}), ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}) }) }); setToast("Campaign and recipient records saved"); await refresh(); setSection("Previous Campaign Records"); } catch (e) { setToast(e instanceof Error ? e.message : "Could not save campaign"); } finally { setBusy(false); } };
  const campaignStatus = async (campaign: Campaign, status: string) => { try { await api(`/api/campaigns/${campaign.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); await refresh(); } catch (e) { setToast(e instanceof Error ? e.message : "Could not update campaign"); } };
  const deleteCampaign = async (campaign: Campaign) => { if (!confirm(`Delete campaign “${campaign.name}” and its message records? This cannot be undone.`)) return; setBusy(true); try { await api(`/api/campaigns/${campaign.id}`, { method: "DELETE" }); setToast("Campaign deleted"); await refresh(); } catch (e) { setToast(e instanceof Error ? e.message : "Could not delete campaign"); } finally { setBusy(false); } };
  const sendCampaign = async (campaign: Campaign) => { const interval = campaign.rotationIntervalSeconds || 0; if (!confirm(interval ? `Start rotating this campaign across its assigned WhatsApp numbers, sending one consented recipient every ${interval} seconds? Keep this page open until the campaign finishes.` : `Send the next batch of up to 5 consented recipients for “${campaign.name}”?`)) return; setBusy(true); let sent = 0; let failed = 0; try { let remaining = 1; while (remaining > 0) { const result = await api<{ sent: number; failed: number; remaining: number; status: string }>(`/api/campaigns/${campaign.id}/send`, { method: "POST", body: JSON.stringify({ batchSize: interval ? 1 : 5 }) }); sent += result.sent; failed += result.failed; remaining = result.remaining; setToast(interval ? `Campaign loop running: ${sent} accepted, ${failed} failed, ${remaining} remaining.` : `Batch finished: ${result.sent} accepted, ${result.failed} failed, ${result.remaining} remaining.`); await refresh(); if (interval > 0 && remaining > 0) await new Promise(resolve => setTimeout(resolve, interval * 1000)); if (!interval) break; } if (interval) setToast(`Campaign loop finished: ${sent} accepted, ${failed} failed.`); } catch (e) { setToast(e instanceof Error ? e.message : "Could not send campaign"); } finally { setBusy(false); } };
  const deleteAccount = async (account: Account) => { if (!confirm(`Remove ${account.name}?`)) return; try { await api(`/api/accounts/${account.id}`, { method: "DELETE" }); await refresh(); } catch (e) { setToast(e instanceof Error ? e.message : "Could not remove account"); } };
  const deleteGroup = async (group: Group) => { if (!confirm(`Delete audience ${group.name}?`)) return; try { await api(`/api/audiences/${group.id}`, { method: "DELETE" }); await refresh(); } catch (e) { setToast(e instanceof Error ? e.message : "Could not delete audience"); } };
  const createContact = async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); try { await api("/api/contacts", { method: "POST", body: JSON.stringify({ name: form.get("name"), phone: form.get("phone"), email: form.get("email") || "", marketingOptIn: form.get("marketingOptIn") === "on" }) }); setContactForm(false); setToast("Contact saved. Only confirmed opt-ins can receive marketing sends."); await refresh(); } catch (e) { setToast(e instanceof Error ? e.message : "Could not save contact"); } finally { setBusy(false); } };
  const importContactsFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      if (importAudience.trim()) body.append("groupName", importAudience.trim());
      if (importOptIn) body.append("marketingOptIn", "true");
      const res = await fetch("/api/contacts/import-file", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not import this file");
      const bits = [`Imported ${data.created} contact${data.created === 1 ? "" : "s"} from ${data.rows} row${data.rows === 1 ? "" : "s"}`];
      if (data.skipped) bits.push(`${data.skipped} already existed or repeated`);
      if (data.invalid) {
        const samples = Array.isArray(data.invalidSamples) ? data.invalidSamples.map((item: { row: number }) => item.row) : [];
        bits.push(`${data.invalid} row${data.invalid === 1 ? "" : "s"} without a valid number skipped${samples.length ? ` (for example: ${samples.join(", ")})` : ""}`);
      }
      if (data.audience) bits.push(`added to audience “${data.audience.name}”`);
      setToast(`${bits.join(" · ")}.`);
      await refresh();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Could not import this file");
    } finally {
      setBusy(false);
    }
  };
  const importPastedPhones = async () => {
    const phones = pastePhones.split(/[\r\n,;\t]+/).map(phone => phone.trim()).filter(Boolean);
    if (!phones.length) { setToast("Paste phone numbers separated by new lines or commas."); return; }
    if (phones.length > 50000) { setToast("Paste at most 50,000 phone numbers at a time."); return; }
    setBusy(true);
    try {
      const result = await api<{ created: number; skipped: number; invalid: number; audience: { name: string } | null }>("/api/contacts/import-paste", {
        method: "POST",
        body: JSON.stringify({ phones: pastePhones, groupName: importAudience.trim() || undefined, marketingOptIn: importOptIn }),
      });
      const bits = [`Imported ${result.created.toLocaleString()} contacts`];
      if (result.skipped) bits.push(`${result.skipped.toLocaleString()} already existed or repeated`);
      if (result.invalid) bits.push(`${result.invalid.toLocaleString()} invalid numbers skipped`);
      if (result.audience) bits.push(`added to “${result.audience.name}”`);
      setToast(`${bits.join(" · ")}.`);
      setPastePhones("");
      await refresh();
    } catch (e) { setToast(e instanceof Error ? e.message : "Could not import pasted numbers"); }
    finally { setBusy(false); }
  };
  const toggleOptOut = async (contact: Contact) => { try { const optedOut = !contact.optedOut; await api(`/api/contacts/${contact.id}`, { method: "PATCH", body: JSON.stringify(optedOut ? { optedOut: true } : { optedOut: false, marketingOptIn: true }) }); await refresh(); } catch (e) { setToast(e instanceof Error ? e.message : "Could not update consent"); } };
  const allContactsSelected = contacts.length > 0 && contacts.every(contact => selectedContactIds.includes(contact.id));
  const toggleAllContacts = () => setSelectedContactIds(allContactsSelected ? [] : contacts.map(contact => contact.id));
  const toggleContactSelection = (id: string) => setSelectedContactIds(current => current.includes(id) ? current.filter(contactId => contactId !== id) : [...current, id]);
  const deleteContact = async (contact: Contact) => {
    if (!window.confirm(`Delete ${contact.name || contact.phone}? This cannot be undone.`)) return;
    try {
      await api(`/api/contacts/${contact.id}`, { method: "DELETE" });
      setSelectedContactIds(current => current.filter(id => id !== contact.id));
      setToast("Contact deleted.");
      await refresh();
    } catch (e) { setToast(e instanceof Error ? e.message : "Could not delete contact"); }
  };
  const deleteSelectedContacts = async () => {
    if (!selectedContactIds.length || !window.confirm(`Delete ${selectedContactIds.length} selected contact${selectedContactIds.length === 1 ? "" : "s"}? Contacts with message history will be kept.`)) return;
    try {
      const result = await api<{ deleted: number; skippedWithHistory: number }>("/api/contacts", { method: "DELETE", body: JSON.stringify({ ids: selectedContactIds }) });
      setSelectedContactIds([]);
      setToast(`${result.deleted} deleted${result.skippedWithHistory ? ` · ${result.skippedWithHistory} with message history kept` : ""}.`);
      await refresh();
    } catch (e) { setToast(e instanceof Error ? e.message : "Could not delete selected contacts"); }
  };
  const syncTemplate = async (template: Template, accountId: string) => { if (!accountId) return; try { await api(`/api/templates/${template.id}/sync`, { method: "POST", body: JSON.stringify({ accountId }) }); setToast(`Template sent to Meta; current status is pending review.`); await refresh(); } catch (e) { setToast(e instanceof Error ? e.message : "Could not sync template"); } };
  const sendReply = async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); if (!selectedConversation) return; const formElement = e.currentTarget; const form = new FormData(formElement); setReplyBusy(true); try { await api(`/api/inbox/${selectedConversation.id}/reply`, { method: "POST", body: JSON.stringify({ body: form.get("body") }) }); formElement.reset(); const detail = await api<InboxDetail>(`/api/inbox/${selectedConversation.id}`); setSelectedConversation(detail); await refresh(); } catch (e) { setToast(e instanceof Error ? e.message : "Could not send reply"); } finally { setReplyBusy(false); } };
  const startMetaSignup = () => {
    const config = metaConfig;
    if (!config?.enabled) { setToast(`Configure ${config?.missing.join(", ") || "Meta signup"} in Vercel first.`); return; }
    if (!window.FB || !metaSdkReady) { setToast("Meta signup is still loading. Try again in a moment."); return; }
    window.FB.login(response => { const code = response.authResponse?.code || response.code; if (!code) { setToast("Meta signup was cancelled or did not return an authorization code."); return; } setSignupCode(code); setToast("Meta authorized the signup. Finish the number selection window to connect it."); }, { config_id: config.configId, response_type: "code", override_default_response_type: true, extras: { setup: {} } });
  };
  useEffect(() => {
    if (!metaConfig?.enabled) return;
    const initialize = () => { if (!window.FB) return; window.FB.init({ appId: metaConfig.appId, xfbml: false, version: metaConfig.graphVersion }); setMetaSdkReady(true); };
    if (window.FB) { initialize(); return; }
    let script = document.getElementById("facebook-jssdk") as HTMLScriptElement | null;
    if (!script) { script = document.createElement("script"); script.id = "facebook-jssdk"; script.src = "https://connect.facebook.net/en_US/sdk.js"; script.async = true; document.body.appendChild(script); }
    script.addEventListener("load", initialize, { once: true });
    return () => script?.removeEventListener("load", initialize);
  }, [metaConfig?.enabled, metaConfig?.appId, metaConfig?.graphVersion]);
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try { if (!/(^|\.)facebook\.com$/i.test(new URL(event.origin).hostname)) return; } catch { return; }
      let payload: any = event.data;
      try { if (typeof payload === "string") payload = JSON.parse(payload); } catch { return; }
      if (payload?.type !== "WA_EMBEDDED_SIGNUP" || payload.event !== "FINISH") return;
      const data = payload.data || {};
      if (!data.waba_id || !data.phone_number_id) { setToast("Meta signup completed without a WhatsApp number ID."); return; }
      setSignupDetails({ wabaId: String(data.waba_id), phoneNumberId: String(data.phone_number_id), businessId: data.business_id ? String(data.business_id) : undefined });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);
  useEffect(() => {
    if (!signupCode || !signupDetails) return;
    let cancelled = false;
    setBusy(true);
    void api<{ account: Account }>("/api/whatsapp/connect", { method: "POST", body: JSON.stringify({ code: signupCode, ...signupDetails }) }).then(async result => {
      if (cancelled) return;
      setSignupCode(""); setSignupDetails(null); setToast(`${result.account.name} connected to WhatsApp Cloud API.`); await refresh();
    }).catch(error => { if (!cancelled) setToast(error instanceof Error ? error.message : "Could not connect sender with Meta"); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [signupCode, signupDetails, refresh]);

  const active = stats?.running ?? campaigns.filter(x => x.status === "running").length;
  const currentNav = nav.find(n => n.id === section);
  const runningCampaign = campaigns.find(c => c.status === "running") || null;
  const deliveryAttempts = (stats?.delivered ?? 0) + (stats?.failed ?? 0);
  const deliveryRate = stats && deliveryAttempts > 0 ? `${Math.round((stats.delivered / deliveryAttempts) * 100)}%` : "—";
  const head = <header className="topbar"><div className="top-left"><button className="icon-btn mobile-only" onClick={() => setMobileOpen(!mobileOpen)}><Menu size={19}/></button><div><div className="eyebrow">WORKSPACE</div><h1>{currentNav?.label || section}</h1></div></div><div className="top-actions"><button className="icon-btn" onClick={refresh} title="Refresh workspace"><RefreshCw size={16}/></button><button className="icon-btn" onClick={() => setToast("All updates are current") } title="Notifications"><Bell size={16}/></button><div className="avatar">A</div></div></header>;

  return <div className="shell">
    <aside className={`sidebar ${mobileOpen ? "open" : ""}`}><div className="brand"><Image className="brand-mark-image" src="/reachpulse-mark.png" alt="ReachPulse logo" width={46} height={36}/><span><b>ReachPulse</b><small>CAMPAIGN MANAGER</small></span></div><div className="nav-label">NAVIGATION</div><nav>{nav.map(item => <button key={item.id} className={`nav-btn ${section === item.id ? "active" : ""}`} onClick={() => { setSection(item.id); setMobileOpen(false); }}><item.icon size={17}/><span>{item.label}</span>{item.id === "Inbox" && (stats?.unread ?? 0) > 0 && <b className="nav-count">{stats?.unread}</b>}</button>)}</nav><div className="nav-label prefs-label">SYSTEM</div><button className={`nav-btn ${section === "Settings" ? "active" : ""}`} onClick={() => setSection("Settings")}><Settings size={17}/><span>Settings</span></button><div className="sidebar-bottom"><div className="account-user"><span className="user-avatar">A</span><span><b>Admin</b><small>Campaign Manager</small></span></div><button className="nav-btn" onClick={() => { window.location.href = "/account/password"; }}><KeyRound size={16}/><span>Change password</span></button><button className="nav-btn support" onClick={() => { void fetch("/api/auth/logout", { method: "POST" }).finally(() => { window.location.href = "/login"; }); }}><LogOut size={16}/><span>Sign out</span></button><button className="nav-btn support" onClick={() => setToast("Support options are available in Settings.")}><CircleHelp size={16}/><span>Help & Support</span></button></div></aside>
    <main className="main">{head}<div className="page">{error && <div className="notice warn"><AlertTriangle size={17}/><span><b>Database Connection Alert</b><br/>{error}</span><button className="btn btn-small" onClick={refresh}>Retry</button></div>}

      {section === "Dashboard" && <>
        <div className="page-head"><div><h2>Campaign Overview</h2><p>Performance metrics and broadcast delivery statistics.</p></div><button className="btn btn-primary" onClick={() => setSection("Create Campaign")}><Plus size={15}/>Create campaign</button></div>
        <section className="live-panel"><div><div className="eyebrow">LIVE STATUS</div><h3>{runningCampaign ? runningCampaign.name : "No active dispatch"}</h3><p>{runningCampaign ? `${runningCampaign.delivered + runningCampaign.read} delivered · ${runningCampaign.failed} failed · ${Math.max(0, runningCampaign.total - runningCampaign.delivered - runningCampaign.read - runningCampaign.failed)} pending` : "Real-time delivery progress will appear here when a campaign is running."}</p></div><Pill tone={runningCampaign ? "green" : ""}>{runningCampaign ? "Active" : "Idle"}</Pill></section>
        <div className="stats-grid">{[{ label: "Total Campaigns", value: stats?.campaigns, icon: Send, tone: "pink" }, { label: "Running Campaigns", value: active, icon: Activity, tone: "mint" }, { label: "Completed Campaigns", value: campaigns.filter(c => c.status === "completed").length, icon: Check, tone: "mint" }, { label: "Total Messages", value: stats?.messages, icon: MessageSquare, tone: "pink" }, { label: "Delivery Rate", value: deliveryRate, icon: ShieldCheck, tone: "lavender" }, { label: "Connected Numbers", value: stats?.accounts, icon: Users, tone: "pink" }, { label: "Delivered Messages", value: stats?.delivered, icon: ShieldCheck, tone: "mint" }, { label: "Failed Messages", value: stats?.failed, icon: AlertTriangle, tone: "red" }].map(card => <div className="card stat" key={card.label}><div className={`stat-icon ${card.tone}`}><card.icon size={18}/></div><div><div className="stat-label">{card.label}</div><strong className="stat-value">{card.value === undefined ? "—" : typeof card.value === "number" ? card.value.toLocaleString() : card.value}</strong><small>{card.label === "Connected Numbers" ? "Connected WhatsApp accounts" : card.label === "Delivery Rate" ? "Delivered vs total messages" : card.label.includes("Message") ? "Total transmission events" : "Workspace records"}</small></div></div>)}</div>
        <div className="card table-card"><div className="card-head"><div><h3>Recent Campaigns</h3><p>Recent broadcast records and transmission summary</p></div><button className="btn btn-small" onClick={() => setSection("Previous Campaign Records")}>View history<ChevronRight size={14}/></button></div><CampaignTable campaigns={campaigns.slice(0, 6)} onStatus={campaignStatus} onSend={sendCampaign} onDelete={deleteCampaign}/></div>
      </>}

      {section === "Inbox" && <><div className="page-head"><div><h2>Conversations & Replies</h2><p>Customer responses and incoming WhatsApp inquiries.</p></div><Pill tone="pink">{conversations.reduce((n, c) => n + c.unreadCount, 0)} unread</Pill></div><div className="inbox card"><section className="thread-list"><div className="search-box"><Search size={15}/><input placeholder="Search contacts or messages…" value={search} onChange={e => setSearch(e.target.value)}/></div>{filteredConversations.length ? filteredConversations.map(c => <button className={`thread ${selectedConversation?.id === c.id ? "selected" : ""}`} key={c.id} onClick={() => void loadConversation(c.id)}><div className="contact-avatar">{c.contact.name.slice(0, 1).toUpperCase()}</div><span><b>{c.contact.name}</b><small>{c.messages[0]?.body || c.contact.phone}</small></span><time>{new Date(c.lastMessageAt).toLocaleDateString()}</time></button>) : <div className="empty"><MessageCircle size={22}/><b>No messages received yet</b><small>Inbound messages from customers will appear here.</small></div>}</section><section className="conversation">{selectedConversation ? <><div className="conversation-head"><b>{selectedConversation.contact.name}</b><span>{selectedConversation.contact.phone}</span></div><div className="messages">{selectedConversation.messages.map(m => <div className={`bubble ${m.direction}`} key={m.id}><p>{m.body}</p><time>{date(m.createdAt)}</time></div>)}</div><form className="conversation-foot" onSubmit={sendReply}><input name="body" required maxLength={4096} placeholder="Type a reply…"/><button className="btn btn-primary" disabled={replyBusy}>{replyBusy ? <LoaderCircle size={14}/> : <Send size={14}/>}Send</button></form></> : <div className="empty"><MessageSquare size={26}/><b>Select a conversation</b><small>Choose a chat from the left panel to read and reply.</small></div>}</section></div></>}

      {section === "Previous Campaign Records" && <><div className="page-head"><div><h2>Campaign Records</h2><p>Historical campaign data, dispatch logs, and delivery metrics.</p></div><button className="btn btn-primary" onClick={() => setSection("Create Campaign")}><Plus size={15}/>Create campaign</button></div><div className="card table-card"><CampaignTable campaigns={campaigns} onStatus={campaignStatus} onSend={sendCampaign} onDelete={deleteCampaign}/></div></>}

      {section === "Campaign Reports" && <><div className="page-head"><div><h2>Campaign Reports</h2><p>Download a recipient-by-recipient PDF with delivery, pending, skipped, and failure details.</p></div></div><div className="card table-card"><table className="table"><thead><tr><th>CAMPAIGN</th><th>STATUS</th><th>SUCCESS RATE</th><th>DELIVERED / READ</th><th>FAILED</th><th>RECIPIENTS</th><th>REPORT</th></tr></thead><tbody>{campaigns.map(c => { const success = c.total ? Math.round((c.delivered / c.total) * 100) : 0; return <tr key={c.id}><td><b>{c.name}</b><small>{date(c.createdAt)}</small></td><td><Pill>{c.status}</Pill></td><td>{success}%</td><td>{c.delivered.toLocaleString()}</td><td className="error-text">{c.failed.toLocaleString()}</td><td>{c.total.toLocaleString()}</td><td><a className="btn btn-small" href={`/api/campaigns/${c.id}/report`}><FileText size={14}/>Download PDF</a></td></tr>; })}</tbody></table>{campaigns.length === 0 && <div className="empty"><FileText size={20}/><b>No campaign reports yet</b><small>Create a campaign to generate its report.</small></div>}</div></>}
      {section === "Accounts" && <div className="accounts-page"><div className="page-head accounts-head"><div><span className="account-eyebrow">CHANNEL SETUP</span><h2>WhatsApp Business Accounts</h2><p>Connect Meta senders with a 60-day token or Embedded Signup, or add QR (Baileys) senders that need no Meta approval.</p></div><div className="accounts-head-actions"><button className="btn btn-primary" onClick={() => { setBridgeForm(!bridgeForm); setTokenForm(false); }}><QrCode size={15}/>{bridgeForm ? "Close QR Form" : "Add QR Sender (Baileys)"}</button><button className="btn" onClick={() => { setTokenMode("connect"); setTokenAccountId(""); setTokenAccountName(""); setTokenPhoneId(""); setTokenWabaId(""); setTokenForm(!tokenForm); setBridgeForm(false); }}><KeyRound size={15}/>{tokenForm && tokenMode === "connect" ? "Close Token Form" : "Connect with Token (60 Days)"}</button><button className="btn" disabled={busy || !metaSdkReady} onClick={startMetaSignup}><Plus size={15}/>{metaSdkReady ? "Connect with Meta Popup" : "Loading Meta popup…"}</button></div></div>
      <div className="account-overview"><div className="account-stat"><span className="account-stat-icon"><Phone size={17}/></span><div><small>Connected numbers</small><b>{accounts.filter(a => a.status === "connected").length}</b></div></div><div className="account-stat"><span className="account-stat-icon"><ShieldCheck size={17}/></span><div><small>Ready to send</small><b>{accounts.filter(a => a.status === "connected" && (!a.tokenExpiresAt || new Date(a.tokenExpiresAt).getTime() > Date.now())).length}</b></div></div><div className="account-stat"><span className="account-stat-icon"><Activity size={17}/></span><div><small>Need attention</small><b>{accounts.filter(a => a.status !== "connected").length}</b></div></div></div>
      {tokenForm && (
        <form className="card form-card account-token-form" onSubmit={handleTokenSubmit}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>{tokenMode === "update" ? `Update Access Token for “${tokenAccountName}”` : "Connect WhatsApp Account with Access Token"}</h3>
            <button type="button" className="icon-btn" onClick={() => setTokenForm(false)} title="Close"><X size={16}/></button>
          </div>
          <div className="notice" style={{ background: "#ffffff" }}>
            💡 <b>Token-only connection:</b> Paste any WhatsApp Access Token (temporary or permanent). The server exchanges short-lived tokens for a <b>60-day Long-Lived Token</b> and then finds your WABA, phone number and Phone Number ID automatically. Only fill the IDs if auto-detection cannot reach your account.
          </div>
          <div className="form-grid">
            {tokenMode === "connect" && (
              <>
                <Field label="Account / Business Name (optional)">
                  <input name="name" placeholder="e.g. Rohaan Marketing WhatsApp" />
                </Field>
                <Field label="WhatsApp phone number (optional — used to pick the number)">
                  <input name="phone" placeholder="e.g. +92 300 1234567" />
                </Field>
                <Field label="WhatsApp Phone Number ID (optional — auto-detected)">
                  <input name="phoneNumberId" placeholder="Leave empty to look it up automatically" defaultValue={tokenPhoneId} />
                </Field>
                <Field label="WhatsApp Business Account ID / WABA ID (optional — auto-detected)">
                  <input name="businessAccountId" placeholder="Leave empty to detect from the token" defaultValue={tokenWabaId} />
                </Field>
              </>
            )}
            <Field label={tokenMode === "update" ? "New WhatsApp Access Token *" : "WhatsApp Access Token *"}>
              <textarea name="accessToken" required rows={3} placeholder="EAAG... (Paste your token from Meta Developer Portal / System Users / Graph Explorer)" style={{ fontFamily: "monospace", fontSize: "12px", width: "100%" }} />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setTokenForm(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
              {tokenMode === "update" ? "Save & Verify New Token" : "Verify & Connect Account (60 Days)"}
            </button>
          </div>
        </form>
      )}
      {bridgeForm && (
        <form className="card form-card account-token-form" onSubmit={addBridgeAccount}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Add QR (Baileys) Sender</h3>
            <button type="button" className="icon-btn" onClick={() => setBridgeForm(false)} title="Close"><X size={16}/></button>
          </div>
          <div className="notice" style={{ background: "#ffffff" }}>
            🟢 <b>No Meta approval needed.</b> This sender connects through your self-hosted WhatsApp bridge and sends plain text directly — no template review, no 24-hour window. Scan the QR once and the session stays logged in.
          </div>
          <div className="form-grid">
            <Field label="Sender name *"><input name="name" required maxLength={80} placeholder="e.g. Rohaan WhatsApp 1" /></Field>
            <Field label="WhatsApp number *"><input name="phone" required placeholder="+923001234567" /></Field>
            <Field label="Bridge session name *"><input name="bridgeSessionId" required pattern="[a-zA-Z0-9_-]{2,40}" placeholder="account1" defaultValue={`account${accounts.filter(a => a.provider === "bridge").length + 1}`} /><small className="help">Har number ka alag session: account1, account2, account3…</small></Field>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setBridgeForm(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? <LoaderCircle size={14} className="spin"/> : <Check size={14}/>}Save &amp; Show QR</button>
          </div>
        </form>
      )}
      {qrAccount && (
        <div className="card form-card account-token-form">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Connect “{qrAccount.name}” — scan the QR</h3>
            <button type="button" className="icon-btn" onClick={() => { setQrAccount(null); setQrState(null); setQrError(""); }} title="Close"><X size={16}/></button>
          </div>
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            {qrError && <p className="notice warn">{qrError}</p>}
            {qrState?.status === "connected" ? (
              <p className="notice" style={{ color: "#16a34a", fontWeight: "bold" }}>✓ Connected{qrState.phone ? ` as ${qrState.phone}` : ""}. You can close this window.</p>
            ) : qrState?.qr ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrState.qr} alt="WhatsApp QR code" width={280} height={280} style={{ border: "1px solid #e2e8f0", padding: 10, borderRadius: 12, background: "#fff" }} />
                <p className="help">WhatsApp → Linked Devices → Link a Device se scan karein. QR har ~20 second badalta hai; ye page khud refresh karta hai.</p>
              </>
            ) : (
              <p className="help"><LoaderCircle size={14} className="spin" /> QR ban raha hai…</p>
            )}
            <p className="help">Session: <code>{qrAccount.bridgeSessionId}</code></p>
          </div>
        </div>
      )}
      <div className={`notice account-notice ${metaConfig?.enabled ? "" : "warn"}`}>{metaConfig?.enabled ? "Meta App credentials (META_APP_ID & META_APP_SECRET) are active on the server. Tokens will automatically be exchanged for 60-day validity." : `Meta server settings missing: ${metaConfig?.missing.join(", ") || "configuration"}. Add them in Vercel to enable 60-day token exchange.`}</div>
      <div className="notice warn account-notice"><AlertTriangle size={16}/>Send only to contacts who explicitly opted in. Meta senders require approved templates; QR (Baileys) senders send plain text but carry a real WhatsApp ban risk — keep the delays.</div>
      <div className="card account-setup-card">
        <div className="card-head">
          <div>
            <h3>Meta setup checklist</h3>
            <p>Everything Meta needs before a real campaign can leave WhatsApp.</p>
          </div>
          <Pill tone={metaConfig?.enabled ? "green" : "yellow"}>{metaConfig?.enabled ? "App credentials active" : "App credentials missing"}</Pill>
        </div>
        <div className="form-grid">
          <Field label="Webhook callback URL (Meta → WhatsApp → Configuration)">
            <input readOnly value={origin ? `${origin}/api/webhook` : "Loading…"} onFocus={e => e.currentTarget.select()} />
          </Field>
          <Field label="Webhook fields to subscribe">
            <input readOnly value="messages, message_template_status_update" onFocus={e => e.currentTarget.select()} />
          </Field>
        </div>
        <div className="account-setup-links">
          <a className="btn btn-small" href="https://business.facebook.com/wa/manage/phone-numbers/" target="_blank" rel="noreferrer"><Phone size={13}/>Add / verify phone number</a>
          <a className="btn btn-small" href="https://business.facebook.com/settings/whatsapp-business-accounts" target="_blank" rel="noreferrer">WABA settings</a>
          <a className="btn btn-small" href={`https://developers.facebook.com/apps/${metaConfig?.appId || ""}/whatsapp-business/wa-settings/`} target="_blank" rel="noreferrer">App WhatsApp settings</a>
          <a className="btn btn-small" href={`https://developers.facebook.com/tools/explorer/${metaConfig?.appId || ""}/`} target="_blank" rel="noreferrer"><KeyRound size={13}/>Get access token</a>
        </div>
        <p className="help account-setup-note">
          Meta&apos;s shared Test WABA only holds its demo number — a Pakistani number must be added to your own WhatsApp Business Account, verified by SMS or voice call, and the Meta app must be in Live mode before customer messages are delivered.
        </p>
      </div>
      <div className="account-grid account-grid-polished">{accounts.map(a => {
        const isBridge = a.provider === "bridge";
        let tokenBadge = null;
        let expired = a.status === "expired" && !isBridge;
        if (!isBridge && (a.status === "connected" || expired)) {
          if (!a.tokenExpiresAt && !expired) {
            tokenBadge = <p className="help" style={{ color: "#16a34a", fontWeight: "bold" }}>✓ Permanent System User Token</p>;
          } else {
            const ms = a.tokenExpiresAt ? new Date(a.tokenExpiresAt).getTime() - Date.now() : 0;
            const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
            if (!expired && days > 0) {
              tokenBadge = <p className="help" style={{ color: "#16a34a", fontWeight: "bold" }}>✓ 60-day token active ({days} days remaining)</p>;
            } else {
              expired = true;
              tokenBadge = <p className="help" style={{ color: "#dc2626", fontWeight: "bold" }}>⚠️ Token expired — paste a fresh token with Update Token</p>;
            }
          }
        }
        return (
          <article className="card sender-card" key={a.id}>
            <div className="sender-head">
              <div>
                <h3>{a.name}</h3>
                <small>{isBridge ? `${a.phone} · QR session ${a.bridgeSessionId}` : `${a.phone} ${a.phoneNumberId ? `· ID: ${a.phoneNumberId}` : ""}`}</small>
              </div>
              <Pill tone={a.status === "connected" ? (expired ? "red" : "green") : a.status === "expired" ? "red" : "yellow"}>{isBridge ? (a.status === "connected" ? "qr connected" : "scan needed") : expired ? "token expired" : a.status}</Pill>
            </div>
            <div className="sender-meta">
              <span>Assigned campaigns</span>
              <b>{a._count?.campaignAssignments ?? campaigns.filter(c => c.accountAssignments?.some(x => x.account.id === a.id)).length}</b>
            </div>
            {tokenBadge}
            {(a.status === "connected" || a.status === "expired") && !isBridge && <p className="help">{a.webhookSubscribedAt ? "Webhooks subscribed" : "Webhooks: auto-subscribed or pending"}</p>}
            <div className="sender-actions">
              {isBridge && (
                <button className="btn btn-small" onClick={() => openQr(a)} title="Show the WhatsApp QR code for this sender">
                  <QrCode size={13}/>{a.status === "connected" ? "Session QR" : "Show QR"}
                </button>
              )}
              {(a.status === "connected" || a.status === "expired") && (
                <button className="btn btn-small" disabled={verifyingId === a.id} onClick={() => void verifyAccount(a)} title={isBridge ? "Ask the WhatsApp bridge whether this session is still connected" : "Ask Meta whether this number can send right now"}>
                  <RefreshCw size={13}/>{verifyingId === a.id ? "Checking…" : "Check Connection"}
                </button>
              )}
              {a.status === "connected" && (
                <button className="btn btn-small" disabled={testingId === a.id} onClick={() => void sendTestMessage(a)} title={isBridge ? "Send a plain test message through the bridge" : "Send an approved template to your own number"}>
                  <Send size={13}/>{testingId === a.id ? "Sending…" : "Send Test"}
                </button>
              )}
              {!isBridge && (
                <button className="btn btn-small" onClick={() => {
                  setTokenMode("update");
                  setTokenAccountId(a.id);
                  setTokenAccountName(a.name);
                  setTokenPhoneId(a.phoneNumberId || "");
                  setTokenWabaId(a.businessAccountId || "");
                  setTokenForm(true);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }} title="Update or refresh WhatsApp token">
                  <KeyRound size={13}/>Update Token
                </button>
              )}
              {a.status !== "disconnected" ? (
                <button className="btn btn-small" onClick={() => void disconnectAccount(a)}>Disconnect</button>
              ) : (
                <Pill>Not connected</Pill>
              )}
              <button className="icon-btn danger" onClick={() => void deleteAccount(a)} title="Remove account"><Trash2 size={15}/></button>
            </div>
          </article>
        );
      })}</div>
      {accounts.length === 0 && <Empty icon={Phone} title="No sender accounts connected" detail="Use 'Connect with Token' or 'Connect with Meta Popup' to securely add your WhatsApp Business number."/>}</div>}

      {section === "Create Campaign" && <><div className="page-head"><div><h2>Create Campaign</h2><p>Choose a consented audience, a template or campaign text, and the connected senders (Meta tokens or QR senders).</p></div><Pill tone="pink">Campaign workspace</Pill></div><form className="card campaign-form" onSubmit={createCampaign}><div className="campaign-columns"><div><Field label="Campaign name"><input name="name" required placeholder="e.g. September update" defaultValue={`Campaign ${new Date().toLocaleDateString()}`}/></Field><Field label="Audience pool"><select name="groupId"><option value="">All opted-in contacts ({audience?.eligible ?? 0})</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name} ({g._count.members})</option>)}</select></Field><Field label="Choose contacts (leave empty for all opted-in contacts)"><select name="contactIds" multiple size={5}>{contacts.filter(c => c.marketingOptIn && !c.optedOut).map(c => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</select></Field><Field label="WhatsApp template"><select name="templateId" defaultValue=""><option value="">Save as draft without a template</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name} · {t.status.toUpperCase()}</option>)}</select></Field><Field label="Optional internal note"><textarea name="message" maxLength={4096} placeholder="Optional note for your campaign record"/></Field><label className="check-row"><input name="rotateSenders" type="checkbox"/><span><b>Rotate sender numbers</b><small>Send each message from the next connected number.</small></span></label><Field label="Delay between messages (seconds)"><input name="rotationIntervalSeconds" type="number" min="1" max="3600" defaultValue="10"/></Field><Field label="Schedule (optional)"><input name="scheduledAt" type="datetime-local" min={new Date().toISOString().slice(0, 16)}/></Field><p className="help">Scheduled sends need an approved Meta template (or only QR senders), a connected sender assigned to it, and recorded opt-in consent. Drafts never send automatically.</p></div><div className="assigned-box"><h3>Assigned accounts</h3>{accounts.length ? accounts.map(a => <label className="check-row" key={a.id}><input name="accountIds" type="checkbox" value={a.id}/><span><b>{a.name}</b><small>{a.phone} · {a.status}</small></span><Pill tone={a.status === "connected" ? "green" : "yellow"}>{a.status}</Pill></label>) : <div className="empty compact"><Phone size={18}/><b>No sender accounts</b><small>Connect one with Meta before sending.</small></div>}<button type="button" className="btn btn-small" onClick={() => setSection("Accounts")}><Plus size={13}/>Manage accounts</button></div></div><div className="form-actions"><span className="help">Only current, explicit marketing opt-ins are included.</span><button className="btn btn-primary" disabled={busy}>{busy ? <LoaderCircle size={14}/> : <Check size={14}/>}Save campaign</button></div></form></>}

      {section === "Audience Pool" && <><div className="page-head"><div><h2>Audience Pool</h2><p>Import contacts, track marketing consent, and honor opt-outs.</p></div><button className="btn" onClick={() => setContactForm(!contactForm)}><Plus size={15}/>Add contact</button><button className="btn btn-primary" onClick={() => setGroupForm(!groupForm)}><Plus size={15}/>New audience</button></div><div className="mini-stats"><div className="card"><small>Contacts</small><b>{audience?.contacts ?? "—"}</b></div><div className="card"><small>Eligible opt-ins</small><b>{audience?.eligible ?? "—"}</b></div><div className="card"><small>Opted out</small><b>{audience?.optedOut ?? "—"}</b></div></div>{contactForm && <form className="card form-card" onSubmit={createContact}><h3>Add contact</h3><div className="form-grid"><Field label="Name"><input name="name" required/></Field><Field label="WhatsApp phone (international format)"><input name="phone" required placeholder="+14155550123"/></Field><Field label="Email (optional)"><input name="email" type="email"/></Field></div><label className="check-row"><input name="marketingOptIn" type="checkbox"/><span><b>Contact explicitly opted in to marketing</b><small>Only select this when you have recorded permission.</small></span></label><div className="form-actions"><button type="button" className="btn" onClick={() => setContactForm(false)}>Cancel</button><button className="btn btn-primary" disabled={busy}>Save contact</button></div></form>}<div className="card table-card"><div className="card-head"><div><h3>Import contacts from Excel or CSV</h3><p>.xlsx, .xlsm, .csv, .txt or .tsv. Headers are optional — a plain column of phone numbers works. Optional headers: name, phone, email, groupName, tags, marketingOptIn, optedOut.</p></div></div><div className="import-options"><Field label="Audience list name"><input value={importAudience} onChange={e => setImportAudience(e.target.value)} placeholder="e.g. November leads"/><small className="help">Imported contacts go into this list. Reusing a name adds to that list.</small></Field><div className="field import-consent"><span>Marketing consent</span><label className="check-row"><input type="checkbox" checked={importOptIn} onChange={e => setImportOptIn(e.target.checked)}/><span><b>I have recorded opt-in consent</b><small>Only tick when these contacts agreed to receive marketing messages.</small></span></label></div></div><div className="form-actions import-actions"><label className="btn btn-primary" style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}>{busy ? <LoaderCircle size={14} className="spin"/> : <Plus size={14}/>}{busy ? "Importing…" : "Choose file"}<input hidden type="file" accept=".xlsx,.xlsm,.csv,.txt,.tsv" disabled={busy} onChange={e => { void importContactsFile(e.target.files?.[0]); e.currentTarget.value = ""; }}/></label><span className="help">Up to 4 MB / 50,000 rows per file.</span></div><div className="paste-import"><Field label="Or paste phone numbers"><textarea rows={6} value={pastePhones} onChange={e => setPastePhones(e.target.value)} placeholder="Paste up to 50,000 numbers — one per line or separated by commas"/><small className="help">Numbers are added to the audience list name above. Use international format; numbers with spaces or + are accepted.</small></Field><div className="form-actions"><button type="button" className="btn btn-primary" disabled={busy || !pastePhones.trim()} onClick={() => void importPastedPhones()}>{busy ? <LoaderCircle size={14} className="spin"/> : <Plus size={14}/>}Import pasted numbers</button></div></div></div>{groupForm && <form className="card form-card" onSubmit={createGroup}><h3>Create audience list</h3><div className="form-grid"><Field label="List name"><input name="name" required placeholder="Customers"/></Field><Field label="Description"><input name="description" placeholder="Optional note"/></Field></div><div className="member-picker"><b>Select contacts</b>{contacts.map(c => <label key={c.id}><input name="contactIds" type="checkbox" value={c.id}/><span>{c.name} · {c.phone}</span>{c.optedOut && <Pill tone="red">Opted out</Pill>}</label>)}</div><div className="form-actions"><button type="button" className="btn" onClick={() => setGroupForm(false)}>Cancel</button><button className="btn btn-primary" disabled={busy}>Save audience</button></div></form>}<div className="account-grid">{groups.map(g => <article className="card sender-card" key={g.id}><div className="sender-head"><div><h3>{g.name}</h3><small>{g.description || "Audience list"}</small></div><Pill tone="pink">{g._count.members} contacts</Pill></div><div className="sender-meta"><span>Eligible in list</span><b>{g.members?.filter(m => contacts.find(c => c.id === m.contactId)?.marketingOptIn && !contacts.find(c => c.id === m.contactId)?.optedOut).length ?? "—"}</b></div><div className="sender-actions"><button className="btn btn-small" onClick={() => { setSection("Create Campaign"); }}>Use in campaign<ChevronRight size={14}/></button><button className="icon-btn danger" onClick={() => void deleteGroup(g)} title="Delete audience"><Trash2 size={15}/></button></div></article>)}</div>{groups.length === 0 && <Empty icon={Users} title="No saved audience lists" detail="Create a list and choose its contacts."/>}<div className="card table-card"><div className="card-head"><div><h3>Contacts</h3><p>Only marketing opt-ins are eligible; STOP and other opt-out requests are enforced.</p></div><div className="contact-toolbar"><label className="contact-select-all"><input className="contact-select" type="checkbox" checked={allContactsSelected} onChange={toggleAllContacts} aria-label="Select all contacts"/>Select all</label><span className="help">{contacts.length} records</span>{selectedContactIds.length > 0 && <button className="btn btn-small contact-delete" onClick={() => void deleteSelectedContacts()}><Trash2 size={13}/>Delete selected ({selectedContactIds.length})</button>}</div></div><table className="table"><thead><tr><th aria-label="Select contact"></th><th>CONTACT</th><th>PHONE</th><th>GROUP</th><th>CONSENT</th><th>ACTION</th></tr></thead><tbody>{contacts.map(c => <tr key={c.id}><td><input className="contact-select" type="checkbox" checked={selectedContactIds.includes(c.id)} onChange={() => toggleContactSelection(c.id)} aria-label={`Select ${c.name || c.phone}`}/></td><td>{c.name}</td><td>{c.phone}</td><td>{c.groupName || "—"}</td><td><Pill tone={c.optedOut ? "red" : c.marketingOptIn ? "green" : "yellow"}>{c.optedOut ? "Opted out" : c.marketingOptIn ? "Opted in" : "No consent"}</Pill></td><td><div className="contact-row-actions"><button className="btn btn-small" onClick={() => void toggleOptOut(c)}>{c.optedOut ? "Confirm opt-in" : "Opt out"}</button><button className="btn btn-small contact-delete" onClick={() => void deleteContact(c)}><Trash2 size={12}/>Delete</button></div></td></tr>)}</tbody></table></div></>}

      {section === "Campaign Designer" && <><div className="page-head"><div><h2>Campaign Designer</h2><p>Create templates and submit them to Meta for review.</p></div><button className="btn btn-primary" onClick={() => setTemplateForm(!templateForm)}><Plus size={15}/>New message draft</button></div><div className="notice">New templates stay drafts until submitted. Meta controls approval; the app cannot mark a message approved itself.</div>{templateForm && <form className="card form-card" onSubmit={createTemplate}><h3>Design a message template</h3><div className="form-grid"><Field label="Template name"><input name="name" required pattern="[a-z0-9_]+" placeholder="monthly_update"/></Field><Field label="Category"><select name="category"><option value="marketing">Marketing</option><option value="utility">Utility</option><option value="authentication">Authentication</option></select></Field><Field label="Language"><select name="language"><option value="en_US">English (US)</option><option value="en_GB">English (UK)</option><option value="ur">Urdu</option><option value="ar">Arabic</option></select></Field></div><Field label="Message body"><textarea name="body" required maxLength={1024} placeholder="Hello {{1}}, here's the latest update..."/></Field><div className="template-button-builder"><div className="template-button-head"><div><b>Custom buttons</b><small>Add a quick reply, website link, or call button (up to 3).</small></div><button type="button" className="btn btn-small" disabled={templateButtons.length >= 3} onClick={() => setTemplateButtons(current => current.length >= 3 ? current : [...current, { type: "QUICK_REPLY", text: "" }])}><Plus size={13}/>Add button</button></div>{templateButtons.map((button, index) => <div className="template-button-row" key={index}><select aria-label="Button type" value={button.type} onChange={e => { const type = e.currentTarget.value; setTemplateButtons(templateButtons.map((item, itemIndex) => itemIndex !== index ? item : type === "URL" ? { type: "URL", text: item.text, url: "https://" } : type === "PHONE_NUMBER" ? { type: "PHONE_NUMBER", text: item.text, phoneNumber: "+" } : { type: "QUICK_REPLY", text: item.text })); }}><option value="QUICK_REPLY">Quick reply</option><option value="URL">Website</option><option value="PHONE_NUMBER">Call phone</option></select><input aria-label="Button label" maxLength={25} value={button.text} onChange={e => { const text = e.currentTarget.value; setTemplateButtons(templateButtons.map((item, itemIndex) => itemIndex === index ? { ...item, text } : item)); }} placeholder="Button label"/>{button.type === "URL" && <input aria-label="Website URL" type="url" value={button.url} onChange={e => { const url = e.currentTarget.value; setTemplateButtons(templateButtons.map((item, itemIndex) => itemIndex === index && item.type === "URL" ? { ...item, url } : item)); }} placeholder="https://example.com"/>}{button.type === "PHONE_NUMBER" && <input aria-label="Phone number" type="tel" value={button.phoneNumber} onChange={e => { const phoneNumber = e.currentTarget.value; setTemplateButtons(templateButtons.map((item, itemIndex) => itemIndex === index && item.type === "PHONE_NUMBER" ? { ...item, phoneNumber } : item)); }} placeholder="+14155550123"/>}<button type="button" className="icon-btn danger" title="Remove button" onClick={() => setTemplateButtons(templateButtons.filter((_, itemIndex) => itemIndex !== index))}><X size={15}/></button></div>)}</div><p className="help">Meta must approve the template before you can use it. Custom buttons work with marketing and utility templates.</p><div className="form-actions"><button type="button" className="btn" onClick={() => setTemplateForm(false)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? <LoaderCircle size={14}/> : <Check size={14}/>}Save draft</button></div></form>}<div className="template-grid">{templates.map(t => <article className="card template-card" key={t.id}><div className="sender-head"><div><h3>{t.name}</h3><small>{(t.category || "marketing").toUpperCase()} · {t.language.replace("_", "-")}{t.account ? ` · ${t.account.name}` : ""}</small></div><Pill tone={t.status === "approved" ? "green" : t.status === "rejected" ? "red" : "yellow"}>{t.status}</Pill></div><div className="preview-label">MESSAGE PREVIEW</div><p className="template-body">{t.body}</p>{t.buttons?.length ? <div className="template-preview-buttons">{t.buttons.map((button, index) => <span key={index}>{button.text} · {button.type === "URL" ? "Website" : button.type === "PHONE_NUMBER" ? "Call" : "Quick reply"}</span>)}</div> : null}{t.status === "approved" || t.status === "pending" || t.status === "rejected" ? <button className="btn btn-small" disabled={!accounts.some(a => a.status === "connected")} onClick={() => { const account = accounts.find(a => a.id === t.accountId && a.status === "connected") || accounts.find(a => a.status === "connected"); if (account) void syncTemplate(t, account.id); }}>{t.status === "pending" ? "Refresh Meta status" : "Sync Meta status"}</button> : <label className="field"><span>Submit via connected sender</span><select defaultValue="" onChange={e => { if (e.target.value) void syncTemplate(t, e.target.value); }}><option value="">Choose connected account…</option>{accounts.filter(a => a.status === "connected").map(a => <option key={a.id} value={a.id}>{a.name} · {a.phone}</option>)}</select></label>}</article>)}</div>{templates.length === 0 && <Empty icon={Sparkles} title="No message drafts yet" detail="Design and save templates here before setting up a campaign."/>}</>}

      {section === "Sending & Schedule" && <><div className="page-head"><div><h2>Sending & Schedule</h2><p>Review schedules, pause or resume them, and send batches manually.</p></div><button className="btn" onClick={refresh}><RefreshCw size={14}/>Refresh</button></div><div className="notice warn"><Clock3 size={16}/>{metaConfig?.cronConfigured ? "Vercel Hobby processes scheduled campaigns once daily at 00:00 UTC. Scheduled sends may be delayed by up to a day; use Send next batch for manual sending. Meta approval and a connected sender are required." : "Automatic scheduling is not active yet. Add CRON_SECRET (at least 32 characters) to the Vercel Production environment and redeploy; Vercel Hobby then runs once daily at 00:00 UTC. Use Send next batch for manual sending."}</div><div className="card table-card"><table className="table"><thead><tr><th>CAMPAIGN</th><th>SEND TIME</th><th>RECIPIENTS</th><th>ACCOUNTS</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{campaigns.filter(c => c.scheduledAt || c.status === "scheduled" || c.status === "paused").map(c => <tr key={c.id}><td><b>{c.name}</b></td><td>{date(c.scheduledAt)}</td><td>{c.total}</td><td>{c.accountAssignments?.map(x => x.account.name).join(", ") || "Unassigned"}</td><td><Pill tone={c.status === "scheduled" ? "blue" : "yellow"}>{c.status}</Pill></td><td><select value={c.status} onChange={e => void campaignStatus(c, e.target.value)}><option value="scheduled">Scheduled</option><option value="paused">Paused</option><option value="draft">Draft</option><option value="running" disabled>Running</option></select><button className="btn btn-small" disabled={c.status === "paused" || c.status === "completed" || Boolean(c.scheduledAt && new Date(c.scheduledAt) > new Date())} onClick={() => void sendCampaign(c)}>Send next batch (5)</button></td></tr>)}</tbody></table>{campaigns.filter(c => c.scheduledAt || c.status === "scheduled" || c.status === "paused").length === 0 && <Empty icon={CalendarDays} title="No scheduled campaigns" detail="Create a campaign and choose a future send date."/>}</div></>}

      {section === "Settings" && <><div className="page-head"><div><h2>Settings</h2><p>Platform configuration and Meta WhatsApp API parameters.</p></div></div><div className="settings-grid"><div className="card setting"><h3>WhatsApp Business Platform</h3><p>Server-side configuration parameters.</p>{[["Meta App ID", "META_APP_ID"], ["Embedded Signup config", "META_CONFIG_ID"], ["Meta app secret", "META_APP_SECRET"], ["Webhook verify token", "WA_WEBHOOK_VERIFY_TOKEN"], ["Webhook signature secret", "META_APP_SECRET / WA_APP_SECRET"], ["Token encryption key", "WA_TOKEN_ENCRYPTION_KEY"], ["Scheduled sender secret", "CRON_SECRET"]].map(([label, key]) => <div className="setting-row" key={key}><span>{label}</span><code>{key}</code></div>)}<div className={`notice ${metaConfig?.enabled ? "" : "warn"}`}>{metaConfig?.enabled ? "Meta credentials are configured." : `Missing parameters: ${metaConfig?.missing.join(", ") || "loading"}`}</div><div className="notice">Webhook callback URL: <code>{typeof window === "undefined" ? "" : `${window.location.origin}/api/webhook`}</code></div><p className="help">Configure this callback URL in your Meta App Dashboard under WhatsApp &gt; Configuration.</p></div><div className="card setting"><h3>Workspace Details</h3><div className="setting-row"><span>Database</span><b>{error ? "Connection issue" : "PostgreSQL"}</b></div><div className="setting-row"><span>Scheduled sender</span><b>{metaConfig?.cronConfigured ? "Active" : "Not configured"}</b></div><div className="setting-row"><span>Total contacts</span><b>{stats?.contacts ?? "—"}</b></div><div className="setting-row"><span>Connected accounts</span><b>{stats?.accounts ?? "—"}</b></div><div className="setting-row"><span>Active user</span><b>Admin</b></div><p className="help">Secure admin session. Use the account controls in the sidebar to change password or sign out.</p></div><div className="card setting"><h3>System Health</h3><p>Live database and configuration probe.</p><div className="setting-row"><span>Status</span><b>{health ? (health.status === "ok" ? "Healthy" : "Degraded") : "Not checked"}</b></div>{health && Object.entries(health.checks).map(([key, value]) => <div className="setting-row" key={key}><span>{key}</span><b>{value}</b></div>)}<div className="setting-row"><span>Response time</span><b>{health ? `${health.responseTimeMs} ms` : "—"}</b></div><button className="btn btn-small" onClick={runHealthCheck} disabled={healthBusy}>{healthBusy ? <LoaderCircle size={14} className="spin"/> : <Activity size={14}/>}Run health check</button><p className="help">Public probe endpoint: <code>/api/health</code></p></div></div></>}

    </div><footer className="statusbar"><span><i/>ACTIVE</span><span>{stats?.accounts ?? 0} ACCOUNTS CONNECTED</span><small>Workspace Active</small></footer></main>{toast && <div className="toast">{toast}</div>}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Empty({ icon: Icon, title, detail }: { icon: typeof Users; title: string; detail: string }) { return <div className="empty"><Icon size={23}/><b>{title}</b><small>{detail}</small></div>; }
function CampaignTable({ campaigns, onStatus, onSend, onDelete }: { campaigns: Campaign[]; onStatus: (campaign: Campaign, status: string) => void; onSend: (campaign: Campaign) => void; onDelete: (campaign: Campaign) => void }) {
  return <table className="table"><thead><tr><th>CAMPAIGN</th><th>MESSAGE / TEMPLATE</th><th>STATUS</th><th>DATE</th><th>DELIVERED</th><th>FAILED</th><th>TOTAL</th><th>ACCOUNTS</th><th>ACTION</th></tr></thead><tbody>{campaigns.map(c => <tr key={c.id}><td><b>{c.name}</b></td><td className="message-cell">{c.template?.name || c.message || "—"}</td><td><select value={c.status} onChange={e => onStatus(c, e.target.value)}><option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="running" disabled>Running</option><option value="paused">Paused</option><option value="completed" disabled>Completed</option></select></td><td>{date(c.scheduledAt || c.createdAt)}</td><td className="success-text">{(c.delivered + c.read).toLocaleString()}</td><td className="error-text">{c.failed.toLocaleString()}</td><td>{c.total.toLocaleString()}</td><td>{c.accountAssignments?.length ?? 0}</td><td><div className="sender-actions"><button className="btn btn-small" disabled={c.status === "paused" || c.status === "completed" || Boolean(c.scheduledAt && new Date(c.scheduledAt) > new Date())} onClick={() => onSend(c)}>Send next batch (5)</button><button className="icon-btn danger" onClick={() => onDelete(c)} title="Delete campaign"><Trash2 size={15}/></button></div></td></tr>)}</tbody></table>;
}

