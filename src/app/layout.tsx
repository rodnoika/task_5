import type { Metadata } from "next";
import "@tabler/core/dist/css/tabler.min.css";
import "./globals.css";
import "./operations-theme.css";
export const metadata: Metadata = {
  title: "Weyland-Yutani | Mining Operations",
  description:
    "Daily mining production, statistical anomaly detection and detailed reports.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-bs-theme="dark">
      <body>{children}</body>
    </html>
  );
}
