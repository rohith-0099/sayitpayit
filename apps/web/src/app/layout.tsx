import type { Metadata } from "next";
import { Bricolage_Grotesque, Lexend } from "next/font/google";
import "./globals.css";

// Bricolage for the user's words and amounts (the hero); Lexend for everything else: designed
// around reading ease, which suits Guardian's older users and screen recordings, and (unlike
// Atkinson Hyperlegible) its zero isn't slashed, so money reads as money.
const display = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"] });
const body = Lexend({ variable: "--font-lexend", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SayItPayIt",
  description: "Pay anyone, anywhere, just by saying it. Guardian stops the scam before the money leaves.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
