"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Link2,
  LoaderCircle,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  Smartphone,
  X,
} from "lucide-react";

export type QrSender = {
  id: string;
  name: string;
  phone: string;
  bridgeSessionId?: string | null;
};

type QrPayload = {
  sessionId?: string;
  status: string;
  bridgeStatus: string;
  qr: string | null;
  phone: string | null;
};

type Props = {
  /** Existing QR sender to (re)connect. Omit to create a new one first. */
  account?: QrSender | null;
  /** Called after a new sender record is created. */
  onSaved?: (account: QrSender) => void | Promise<void>;
  /** Called once the phone finishes linking, so the parent can refresh data. */
  onConnected?: () => void | Promise<void>;
  onClose: () => void;
};

const STEPS = [
  { icon: Smartphone, title: "Open WhatsApp on your phone", detail: "Use the phone that owns the number you are connecting." },
  { icon: Link2, title: "Tap Menu → Linked devices", detail: "Android: ⋮ menu. iPhone: Settings tab." },
  { icon: ScanLine, title: "Link a device, then scan this code", detail: "Keep this window open until the status turns green." },
];

export default function QrConnect({ account, onSaved, onConnected, onClose }: Props) {
  const [sender, setSender] = useState<QrSender | null>(account || null);
  const [state, setState] = useState<QrPayload | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [seconds, setSeconds] = useState(3);
  const connectedRef = useRef(false);
  // Keep the latest callback without re-running the polling effect on every parent render.
  const onConnectedRef = useRef(onConnected);
  useEffect(() => { onConnectedRef.current = onConnected; }, [onConnected]);

  const connected = state?.status === "connected";

  // Escape closes the dialog, like any native modal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The bridge rotates the QR roughly every 20s, so poll while the dialog is open.
  useEffect(() => {
    if (!sender) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setSeconds(3);

    const load = async () => {
      try {
        const data = await fetch(`/api/accounts/${sender.id}/qr`, { cache: "no-store" }).then(async response => {
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error || "Could not load the QR code.");
          return body as QrPayload;
        });
        if (cancelled) return;
        setState(data);
        setError("");
        if (data.status === "connected") {
          if (!connectedRef.current) {
            connectedRef.current = true;
            void onConnectedRef.current?.();
          }
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load the QR code.");
      }
      setSeconds(3);
      timer = setTimeout(() => void load(), 3000);
    };

    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sender, retry]);

  // Small countdown so the auto-refresh feels intentional instead of random.
  useEffect(() => {
    if (!sender || connected || error) return;
    const id = setInterval(() => setSeconds(value => (value <= 1 ? 3 : value - 1)), 1000);
    return () => clearInterval(id);
  }, [sender, connected, error]);

  const createSender = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          phone: form.get("phone"),
          provider: "bridge",
          bridgeSessionId: form.get("bridgeSessionId"),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not add the QR sender.");
      setSender(body as QrSender);
      connectedRef.current = false;
      setState(null);
      await onSaved?.(body as QrSender);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the QR sender.");
    } finally {
      setSaving(false);
    }
  };

  const refreshNow = useCallback(() => { setError(""); setState(null); setRetry(value => value + 1); }, []);

  const bridgeStatus = state?.bridgeStatus || "starting";
  const sessionId = state?.sessionId || sender?.bridgeSessionId || "—";
  const livePhone = state?.phone || sender?.phone || "—";
  const tone = connected ? "green" : state?.qr ? "yellow" : "blue";

  return (
    <div
      className="qr-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-dialog-title"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="qr-modal">
        <header className="qr-modal-head">
          <span className="qr-head-icon"><QrCode size={20} /></span>
          <div className="qr-head-copy">
            <span className="eyebrow">WHATSAPP BRIDGE</span>
            <h2 id="qr-dialog-title">{sender ? `Connect “${sender.name}”` : "Add a QR sender"}</h2>
            <p>{sender ? "Scan once — the session stays linked until you log out on the phone." : "No Meta review, no template approval. Just scan and send."}</p>
          </div>
          <button type="button" className="icon-btn qr-close" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>

        {!sender ? (
          <form className="qr-form" onSubmit={createSender}>
            <div className="form-grid">
              <label className="field">
                <span>Sender name</span>
                <input name="name" required maxLength={80} placeholder="e.g. Sales WhatsApp 1" autoFocus />
              </label>
              <label className="field">
                <span>WhatsApp number</span>
                <input name="phone" required placeholder="+923001234567" />
              </label>
              <label className="field qr-form-wide">
                <span>Bridge session name</span>
                <input name="bridgeSessionId" required pattern="[a-zA-Z0-9_-]{2,40}" placeholder="account1" defaultValue={`account${Math.floor(Math.random() * 900) + 100}`} />
                <small className="help">Only letters, numbers, <code>-</code> and <code>_</code>. One session per number.</small>
              </label>
            </div>
            {error && <p className="qr-alert"><AlertTriangle size={15} />{error}</p>}
            <div className="qr-form-actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={saving}>
                {saving ? <LoaderCircle size={15} className="spin" /> : <QrCode size={15} />}
                {saving ? "Creating…" : "Save & show QR"}
              </button>
            </div>
          </form>
        ) : (
          <div className="qr-body">
            <div className="qr-stage">
              <div className={`qr-frame ${connected ? "is-connected" : state?.qr ? "" : "is-loading"}`}>
                {connected ? (
                  <span className="qr-success">
                    <CheckCircle2 size={46} />
                    <b>Linked</b>
                    <small>{livePhone}</small>
                  </span>
                ) : state?.qr ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={state.qr} alt="WhatsApp linking QR code" width={252} height={252} />
                ) : (
                  <span className="qr-placeholder">
                    <LoaderCircle size={26} className="spin" />
                    <small>Preparing QR…</small>
                  </span>
                )}
              </div>

              <div className="qr-stage-foot">
                <span className={`qr-live ${connected ? "on" : ""}`}><i />{connected ? "Session active" : "Waiting for scan"}</span>
                {!connected && state?.qr && <span className="qr-timer"><RefreshCw size={12} />Refreshes in {seconds}s</span>}
              </div>

              {error && (
                <div className="qr-alert">
                  <AlertTriangle size={15} />
                  <span>{error}</span>
                  <button type="button" className="btn btn-small" onClick={refreshNow}><RefreshCw size={13} />Retry</button>
                </div>
              )}
            </div>

            <div className="qr-side">
              <ol className="qr-steps">
                {STEPS.map((step, index) => (
                  <li key={step.title}>
                    <span className="qr-step-icon"><step.icon size={16} /></span>
                    <span className="qr-step-copy">
                      <b>{index + 1}. {step.title}</b>
                      <small>{step.detail}</small>
                    </span>
                  </li>
                ))}
              </ol>

              <div className="qr-meta">
                <div><small>Session</small><b>{sessionId}</b></div>
                <div><small>Number</small><b>{livePhone}</b></div>
                <div><small>Bridge</small><b className={`qr-bridge ${tone}`}>{bridgeStatus.replace(/_/g, " ")}</b></div>
              </div>

              <div className="qr-actions">
                <button type="button" className="btn" onClick={refreshNow} disabled={connected}>
                  <RefreshCw size={14} />New QR
                </button>
                <button type="button" className="btn btn-primary" onClick={onClose}>
                  {connected ? "Done" : "Close"}
                </button>
              </div>

              <p className="qr-safe"><ShieldAlert size={14} /><span>QR senders send plain text from WhatsApp Web — keep the 20s+ delay, warm the number up slowly, and expect a real ban risk on bulk bursts.</span></p>
              <p className="qr-hint"><CircleHelp size={13} />QR not scanning? Make sure the phone has internet and the bridge tunnel is still running.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
