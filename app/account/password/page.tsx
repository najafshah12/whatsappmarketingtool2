"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowRight, KeyRound, ShieldCheck } from "lucide-react";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (password !== confirm) { setError("The two passwords do not match."); return; }
    setBusy(true);
    try { const response = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, password }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not update password."); router.replace("/"); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update password."); } finally { setBusy(false); }
  }
  return <main className="auth-shell"><div className="auth-glow auth-glow-one"/><div className="auth-glow auth-glow-two"/><section className="auth-card auth-card-password"><div className="auth-brand"><Image className="auth-brand-mark" src="/reachpulse-mark.png" alt="ReachPulse logo" width={56} height={42}/><div><b>ReachPulse</b><small>AMPLIFYING YOUR REACH</small></div></div><div className="auth-art password-art"><div className="auth-orbit orbit-one"/><div className="auth-orbit orbit-two"/><div className="auth-art-icon"><KeyRound size={31}/></div></div><div className="auth-copy"><span className="eyebrow">PASSWORD SETTINGS</span><h1>Choose a new password.</h1><p>Enter your current password, then choose a new password with at least 12 characters.</p></div>
    <form className="auth-form" onSubmit={submit}><label className="auth-label">Current password<div className="auth-input"><KeyRound size={16}/><input type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required placeholder="Current password" /></div></label><label className="auth-label">New password<div className="auth-input"><KeyRound size={16}/><input type="password" autoComplete="new-password" minLength={12} value={password} onChange={e => setPassword(e.target.value)} required placeholder="At least 12 characters" /></div></label><label className="auth-label">Confirm new password<div className="auth-input"><KeyRound size={16}/><input type="password" autoComplete="new-password" minLength={12} value={confirm} onChange={e => setConfirm(e.target.value)} required placeholder="Type it again" /></div></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="auth-submit" disabled={busy}>{busy ? "Saving…" : <>Save password <ArrowRight size={17}/></>}</button></form>
    <div className="auth-foot"><ShieldCheck size={14}/> Password is stored securely as a one-way hash</div></section><footer className="auth-caption">REACHPULSE <span>·</span> AMPLIFYING YOUR REACH</footer></main>;
}
