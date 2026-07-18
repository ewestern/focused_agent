import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Focused Agent",
  description: "A LangGraph and pgvector application scaffold.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
