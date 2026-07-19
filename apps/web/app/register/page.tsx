"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthCard } from "@/components/auth-card";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(email, password, displayName);
      router.push("/workspaces");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard subtitle="Create your account">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div>
          <label className="field-label" htmlFor="displayName">
            Display name
          </label>
          <input
            id="displayName"
            className="input-field"
            placeholder="Ada Lovelace"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="field-label" htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            className="input-field"
            placeholder="name@company.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="field-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className={`input-field ${error ? "border-danger focus:border-danger focus:ring-danger/20" : ""}`}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          {error ? <p className="field-error">{error}</p> : <p className="mt-1 text-xs text-ink-faint">At least 8 characters.</p>}
        </div>
        <button type="submit" className="btn-primary mt-2 py-2.5" disabled={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
      <div className="mt-6 border-t border-line pt-5 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Log in
        </Link>
      </div>
    </AuthCard>
  );
}
