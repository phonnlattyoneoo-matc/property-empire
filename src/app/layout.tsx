import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Property Empire",
  description: "Build your empire. Bankrupt your friends.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
