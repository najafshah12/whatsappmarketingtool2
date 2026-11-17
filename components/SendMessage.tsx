"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, MessageSquare, Send, X } from "lucide-react";

type Sender = {
  id: string;
  name: string;
  phone: string;
  status: string;
  provider?: string;
  bridgeSessionId?: string | null;
};

type Props = {
  account: Sender;
  onClose: () => void;
  /** Called after a successful send, so the parent can refresh counts/toasts. */
  onSent?: (message: string) => void;
};

/**
 * Hand-written message from one specific number.
 *
 * QR (Baileys) senders send free text any time; Meta senders only accept free
 * text inside the 24-hour reply window, which the form says up front.
 */
export default function SendMessage({ account, onClose, onSent }: Props) {
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const isBridge = account.provider === "bridge";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSent("");
    try {
      const response = await fetch(`/api/accounts/${account.id}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, message: text }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not send the message.");
      setSent(body.message || "Message sent.");
      setText("");
      onSent?.(body.message || "Message sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the message.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="qr-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="message-dialog-title"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="qr-modal msg-modal">
        <header className="qr-modal-head">
          <span className="qr-head-icon"><MessageSquare size={20} /></span>
          <div className="qr-head-copy">
            <span className="eyebrow">{isBridge ? "QR SENDER" : "WHATSAPP CLOUD API"}</span>
            <h2 id="message-dialog-title">Message from {account.name}</h2>
            <p>{account.phone}{account.bridgeSessionId ? ` · session ${account.bridgeSessionId}` : ""} · {account.status}</p>
          </div>
          <button type="button" className="icon-btn qr-close" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>

        <form className="msg-form" onSubmit={submit}>
          <label className="field">
            <span>Send to</span>
            <input
              value={to}
              onChange={event => setTo(event.target.value)}
              placeholder="+923001234567"
              inputMode="tel"
              autoFocus
              required
            />
            <small className="help">Country code ke sath, sirf digits — maslan +923001234567.</small>
          </label>

          <label className="field">
            <span>Message</span>
            <textarea
              value={text}
              onChange={event => setText(event.target.value)}
              placeholder="Salam! Yeh message aap ke WhatsApp number se ja raha hai."
              maxLength={4096}
              rows={6}
              required
            />
            <small className="help">{text.length}/4096 characters · type the message exactly as the recipient should read it.</small>
          </label>

          <p className="help">
            {isBridge
              ? "Yeh message foran scanned number se jayega — koi template ya Meta approval nahi chahiye."
              : "Meta free text sirf 24 ghante ke reply window mein allow karta hai; us ke baad approved template chahiye."}
          </p>

          {error && <p className="qr-alert"><AlertTriangle size={14} />{error}</p>}
          {sent && <p className="msg-success"><CheckCircle2 size={15} /><span>{sent}</span></p>}

          <div className="qr-actions">
            <button type="button" className="btn" onClick={onClose}>Close</button>
            <button className="btn btn-primary" disabled={busy || !to.trim() || !text.trim()}>
              {busy ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />}
              {busy ? "Sending…" : "Send message"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
