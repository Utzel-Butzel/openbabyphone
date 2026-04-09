import { Link } from "react-router-dom";

const steps = [
  "Open Baby Device on the phone or tablet near the crib.",
  "Allow camera and microphone access, then share the room code or QR link.",
  "Open Parent Device on another browser and join the room to watch live or switch to audio-only mode when you need lower bandwidth.",
];

const cards = [
  {
    title: "Baby Device",
    href: "/baby",
    copy: "Capture live video and audio from the room with a one-tap pairing flow.",
    accent: "from-[#ffc76d]/25 via-transparent to-transparent",
  },
  {
    title: "Parent Device",
    href: "/parent",
    copy: "Join an existing room code, receive the live stream directly over WebRTC, and drop to audio-only mode when you want to save bandwidth.",
    accent: "from-[#7fe9d0]/25 via-transparent to-transparent",
  },
];

export function HomePage() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <section className="glass-panel overflow-hidden px-6 py-8 sm:px-8 sm:py-10">
        <p className="eyebrow">Zero-install nursery link</p>
        <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Turn any two browsers into a baby monitor with secure peer-to-peer
          video, audio, and a battery-saving audio-only mode.
        </h2>
        <p className="mt-5 max-w-2xl text-base leading-7 text-white/72 sm:text-lg">
          OpenBabyPhone uses a small signaling server for pairing, then hands
          streaming over to WebRTC so the feed stays low-latency and direct.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {cards.map((card) => (
            <Link
              key={card.title}
              to={card.href}
              className="group relative overflow-hidden rounded-[24px] border border-white/12 bg-slate-950/35 p-5 transition duration-200 hover:-translate-y-0.5 hover:border-white/25"
            >
              <div
                className={`absolute inset-0 bg-gradient-to-br ${card.accent}`}
              />
              <div className="relative">
                <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/55">
                  Launch
                </p>
                <h3 className="mt-3 text-2xl font-semibold text-white">
                  {card.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-white/68">
                  {card.copy}
                </p>
                <span className="mt-6 inline-flex items-center rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white group-hover:bg-white group-hover:text-slate-950">
                  Open view
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="glass-panel px-6 py-8 sm:px-8 sm:py-10">
        <p className="eyebrow">How it works</p>
        <ol className="mt-6 space-y-4">
          {steps.map((step, index) => (
            <li
              key={step}
              className="rounded-[22px] border border-white/10 bg-white/6 p-4"
            >
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-semibold text-slate-950">
                {index + 1}
              </div>
              <p className="text-sm leading-6 text-white/78">{step}</p>
            </li>
          ))}
        </ol>

        <div className="mt-6 rounded-[22px] border border-amber-200/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-50">
          Camera and microphone access requires HTTPS outside localhost. Coolify
          can terminate TLS in front of the Node service.
        </div>
      </section>
    </div>
  );
}
