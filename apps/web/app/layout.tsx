import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth-context";

export const metadata = {
  title: "Relay",
  description: "Slack/Discord clone — learning project",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
