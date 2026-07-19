"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";

// Landing simply routes to the right place based on auth state.
export default function HomePage() {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(user ? "/workspaces" : "/login");
  }, [ready, user, router]);

  return null;
}
