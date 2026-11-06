import type { Metadata } from "next";
import { Bricolage_Grotesque, Lexend, Noto_Sans, Noto_Sans_Devanagari, Noto_Sans_Malayalam, Noto_Sans_Tamil } from "next/font/google";
import "./globals.css";

// Bricolage for the user's words and amounts (the hero); Lexend for everything else: designed
// around reading ease, which suits Guardian's older users and screen recordings, and (unlike
// Atkinson Hyperlegible) its zero isn't slashed, so money reads as money.
const display = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"] });
const body = Lexend({ variable: "--font-lexend", subsets: ["latin"] });
// Fallbacks so every script renders (Bricolage/Lexend are Latin-only). Not preloaded: the browser
// fetches a script's font only when that script appears on screen.
const noto = Noto_Sans({ variable: "--font-noto", subsets: ["latin", "latin-ext", "cyrillic", "greek"], preload: false });
const notoTa = Noto_Sans_Tamil({ variable: "--font-noto-ta", subsets: ["tamil"], preload: false });
const notoMl = Noto_Sans_Malayalam({ variable: "--font-noto-ml", subsets: ["malayalam"], preload: false });
const notoHi = Noto_Sans_Devanagari({ variable: "--font-noto-hi", subsets: ["devanagari"], preload: false });
const fontVars = [display, body, noto, notoTa, notoMl, notoHi].map((f) => f.variable).join(" ");

export const metadata: Metadata = {
  title: "SayItPayIt",
  description: "Pay anyone, anywhere, just by saying it. Guardian stops the scam before the money leaves.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fontVars} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
