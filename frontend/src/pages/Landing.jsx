import React from 'react';
import { Link } from 'react-router-dom';
import { Zap, ArrowRight, Globe, DollarSign, Code } from 'lucide-react';

export default function Landing() {
  return (
    <div className="min-h-screen bg-surface-0 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-cast-600/8 rounded-full blur-[120px] pointer-events-none" />

      {/* Nav */}
      <header className="relative z-10 max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-cast-600 flex items-center justify-center">
            <Zap size={18} className="text-white" />
          </div>
          <span className="text-xl font-semibold tracking-tight">Cast</span>
        </div>
        <Link to="/login" className="btn-primary flex items-center gap-2 text-sm">
          Get started <ArrowRight size={16} />
        </Link>
      </header>

      {/* Hero */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="badge-purple mb-6 mx-auto w-fit">
          <Zap size={12} /> Powered by x402 micropayments
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
          Describe any API.
          <br />
          <span className="text-cast-400">It's live in 5 seconds.</span>
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Cast is the missing infrastructure layer between "I need this API" and "it exists and pays for itself."
          Every call settles a $0.001 micropayment on-chain. No keys, no accounts, no dashboards.
        </p>
        <div className="flex items-center gap-4 justify-center">
          <Link to="/login" className="btn-primary text-base px-8 py-3 flex items-center gap-2">
            Start creating <ArrowRight size={18} />
          </Link>
          <a href="/cast" className="btn-secondary text-base px-8 py-3">
            API Directory
          </a>
        </div>
      </section>

      {/* How it works */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { icon: Code, title: 'Describe', desc: 'Tell Cast what API you need in plain English. Iterate until it\'s right.' },
            { icon: Globe, title: 'Deploy', desc: 'Cast generates production-ready code with validation, error handling, and deploys instantly.' },
            { icon: DollarSign, title: 'Earn', desc: 'Every call pays $0.001 via x402. Settle in AUDD on Solana, USDC on Base, or USDT on X1.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="card p-6 hover:border-white/10 transition-all">
              <div className="w-10 h-10 rounded-lg bg-cast-600/15 flex items-center justify-center mb-4">
                <Icon size={20} className="text-cast-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 card p-8">
          <p className="text-sm text-gray-500 mb-3 font-mono">Example — one sentence to live API:</p>
          <div className="bg-surface-2 rounded-lg p-4 font-mono text-sm">
            <span className="text-gray-500">$</span>{' '}
            <span className="text-cast-400">"An API that takes a stock ticker and returns the current price, daily change, and 52-week range"</span>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Deployed at <span className="text-cast-400 font-mono">cast.dev/stock-price-a8k2m</span> — 3.2s</span>
          </div>
        </div>
      </section>

      {/* Chains */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pb-24 text-center">
        <p className="text-sm text-gray-500 mb-6">Settle on your chain</p>
        <div className="flex items-center justify-center gap-8 text-gray-400">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/30" />
            <span className="text-sm font-medium">Solana</span>
            <span className="badge-green text-[10px]">AUDD</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/30" />
            <span className="text-sm font-medium">Base</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-gray-500/20 border border-gray-500/30" />
            <span className="text-sm font-medium">EVM +</span>
          </div>
        </div>
      </section>
    </div>
  );
}
