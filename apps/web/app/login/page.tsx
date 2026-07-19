"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthCard } from "@/components/auth-card";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.push("/workspaces");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard subtitle="Sign in to your workspace">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
            required
          />
          {error && <p className="field-error">{error}</p>}
        </div>
        <button type="submit" className="btn-primary mt-2 py-2.5" disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>
      <div className="mt-6 border-t border-line pt-5 text-center text-sm text-ink-muted">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-semibold text-primary hover:underline">
          Sign up
        </Link>
      </div>
    </AuthCard>
  );
}
