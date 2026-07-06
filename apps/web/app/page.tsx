"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

export default function HomePage() {
  const { user, ready } = useAuth();

  if (!ready) return null;

  return (
    <main style={{ maxWidth: 480, margin: "80px auto", textAlign: "center" }}>
      <h1>Relay</h1>
      {user ? (
        <>
          <p>Signed in as {user.displayName}</p>
          <Link href="/workspaces">Go to workspaces</Link>
        </>
      ) : (
        <p>
          <Link href="/login">Log in</Link> or <Link href="/register">create an account</Link>
        </p>
      )}
    </main>
  );
}
