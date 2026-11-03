"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowRight, KeyRound, ShieldCheck } from "lucide-react";

async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not continue.");
  return data;
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("abis");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const result = await post("/api/auth/login", { username, password });
      router.replace(result.mustChangePassword ? "/account/password" : "/"); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not sign in."); }
    finally { setBusy(false); }
  }

  return <main className="auth-shell"><div className="auth-glow auth-glow-one"/><div className="auth-glow auth-glow-two"/>
    <section className="auth-card">
      <div className="auth-brand"><Image className="auth-brand-mark" src="/reachpulse-mark.png" alt="ReachPulse logo" width={56} height={42}/><div><b>ReachPulse</b><small>AMPLIFYING YOUR REACH</small></div></div>
      <div className="auth-art"><div className="auth-orbit orbit-one"/><div className="auth-orbit orbit-two"/><div className="auth-art-icon"><ShieldCheck size={34}/></div></div>
      <div className="auth-copy"><span className="eyebrow">REACHPULSE WORKSPACE</span><h1>Welcome back, Abis.</h1><p>Sign in to pick up where your campaigns left off.</p></div>
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-label">Login ID<div className="auth-input"><span>@</span><input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></div></label><label className="auth-label">Password<div className="auth-input"><KeyRound size={16}/><input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Enter your password" /></div></label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="auth-submit" disabled={busy}>{busy ? "Please wait…" : <>Sign in <ArrowRight size={17}/></>}</button>
      </form>
      <div className="auth-foot"><ShieldCheck size={14}/> Protected with secure password sign-in</div>
    </section><footer className="auth-caption">REACHPULSE <span>·</span> AMPLIFYING YOUR REACH</footer>
  </main>;
}
