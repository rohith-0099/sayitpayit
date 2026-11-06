export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-center text-zinc-50">
      <h1 className="text-5xl font-semibold tracking-tight">SayItPayIt</h1>
      <p className="max-w-md text-lg text-zinc-400">
        Pay anyone, anywhere, just by saying it, and the scam stops before the money leaves.
      </p>
      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-1 text-sm text-emerald-300">
        PayPal sandbox · Guardian on
      </span>
    </main>
  );
}
