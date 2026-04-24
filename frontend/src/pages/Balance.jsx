import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { Wallet, ArrowDownRight, ArrowUpRight, Clock, CheckCircle, XCircle, Loader } from 'lucide-react';

export default function Balance() {
  const [balance, setBalance] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawForm, setWithdrawForm] = useState({ chain: 'solana', amount: '', address: '' });
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.getBalance(),
      api.getWithdrawals(),
      api.getEarningsHistory(30),
    ]).then(([b, w, h]) => {
      setBalance(b);
      setWithdrawals(w.withdrawals);
      setHistory(h.dailyEarnings);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleWithdraw = async (e) => {
    e.preventDefault();
    setError('');
    setWithdrawing(true);
    try {
      const data = await api.withdraw({
        chain: withdrawForm.chain,
        amount: parseFloat(withdrawForm.amount),
        destinationAddress: withdrawForm.address,
      });
      setWithdrawals(prev => [data.withdrawal, ...prev]);
      setShowWithdraw(false);
      setWithdrawForm({ chain: 'solana', amount: '', address: '' });
      // Refresh balance
      const b = await api.getBalance();
      setBalance(b);
    } catch (err) {
      setError(err.message);
    }
    setWithdrawing(false);
  };

  const statusIcon = (status) => {
    switch (status) {
      case 'completed': return <CheckCircle size={14} className="text-emerald-400" />;
      case 'failed': return <XCircle size={14} className="text-red-400" />;
      case 'processing': return <Loader size={14} className="text-blue-400 animate-spin" />;
      default: return <Clock size={14} className="text-amber-400" />;
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-cast-500 border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold mb-6">Balance</h1>

      {/* Balance cards */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="card p-6">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
            <Wallet size={14} /> Available
          </div>
          <p className="text-3xl font-semibold">${balance?.total?.available?.toFixed(4) || '0.0000'}</p>
          <p className="text-xs text-gray-500 mt-1">USDC · Aggregated across all chains</p>
        </div>
        <div className="card p-6">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
            <Clock size={14} /> Pending
          </div>
          <p className="text-3xl font-semibold text-amber-400">${balance?.total?.pending?.toFixed(4) || '0.0000'}</p>
          <p className="text-xs text-gray-500 mt-1">Processing withdrawals</p>
        </div>
      </div>

      {/* Withdraw */}
      <div className="card mb-8">
        <div className="p-5 border-b border-white/5 flex items-center justify-between">
          <h2 className="font-medium">Withdraw</h2>
          <button onClick={() => setShowWithdraw(!showWithdraw)} className="btn-primary text-sm px-4 py-2">
            <ArrowUpRight size={14} className="inline mr-1.5" /> Withdraw USDC
          </button>
        </div>

        {showWithdraw && (
          <form onSubmit={handleWithdraw} className="p-5 space-y-4 animate-fade-in">
            {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-lg">{error}</div>}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Chain</label>
                <select value={withdrawForm.chain} onChange={e => setWithdrawForm(p => ({ ...p, chain: e.target.value }))}
                  className="input-field w-full">
                  <option value="solana">Solana (AUDD)</option>
                  <option value="base">Base (USDC)</option>
                  <option value="x1ecochain">X1 EcoChain (USDT)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Amount</label>
                <input type="number" step="0.0001" min="0.10" value={withdrawForm.amount}
                  onChange={e => setWithdrawForm(p => ({ ...p, amount: e.target.value }))}
                  className="input-field w-full" placeholder="0.00" required />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Destination address</label>
                <input value={withdrawForm.address} onChange={e => setWithdrawForm(p => ({ ...p, address: e.target.value }))}
                  className="input-field w-full font-mono text-xs" placeholder="Solana / 0x…" required />
              </div>
            </div>
            <button type="submit" disabled={withdrawing} className="btn-primary text-sm">
              {withdrawing ? 'Processing...' : 'Confirm withdrawal'}
            </button>
          </form>
        )}
      </div>

      {/* Withdrawal history */}
      <div className="card">
        <div className="p-5 border-b border-white/5">
          <h2 className="font-medium">Withdrawal history</h2>
        </div>
        {withdrawals.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No withdrawals yet</div>
        ) : (
          <div className="divide-y divide-white/5">
            {withdrawals.map(w => (
              <div key={w.id} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {statusIcon(w.status)}
                  <div>
                    <p className="text-sm font-medium">${w.amount.toFixed(4)} USDC</p>
                    <p className="text-xs text-gray-500">{w.chain} · {w.destination_address?.slice(0, 10)}...{w.destination_address?.slice(-6)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`badge ${w.status === 'completed' ? 'badge-green' : w.status === 'failed' ? 'bg-red-500/15 text-red-400' : 'badge-yellow'}`}>
                    {w.status}
                  </span>
                  <p className="text-xs text-gray-600 mt-1">{new Date(w.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
