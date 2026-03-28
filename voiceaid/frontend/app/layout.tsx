import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "VoiceAid",
  description: "Government rights assistant",
  manifest: "/manifest.json",
  themeColor: "#1e3a8a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
