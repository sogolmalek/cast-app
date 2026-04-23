import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Globe, ArrowUpRight, Activity, DollarSign, Pause, Play, Trash2, Plus } from 'lucide-react';

export default function Dashboard() {
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listEndpoints().then(data => {
      setEndpoints(data.endpoints);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const toggleStatus = async (id, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    await api.updateEndpoint(id, { status: newStatus });
    setEndpoints(prev => prev.map(e => e.id === id ? { ...e, status: newStatus } : e));
  };

  const deleteEndpoint = async (id) => {
    if (!confirm('Delete this endpoint? This cannot be undone.')) return;
    await api.deleteEndpoint(id);
    setEndpoints(prev => prev.filter(e => e.id !== id));
  };

  const totalCalls = endpoints.reduce((s, e) => s + e.total_calls, 0);
  const totalRevenue = endpoints.reduce((s, e) => s + e.total_revenue, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-cast-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <Link to="/studio" className="btn-primary text-sm flex items-center gap-1.5">
          <Plus size={14} /> New API
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total endpoints', value: endpoints.length, icon: Globe },
          { label: 'Total calls', value: totalCalls.toLocaleString(), icon: Activity },
          { label: 'Total revenue', value: `$${totalRevenue.toFixed(4)}`, icon: DollarSign },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="card p-5">
            <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
              <Icon size={14} /> {label}
            </div>
            <p className="text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {/* Endpoints list */}
      {endpoints.length === 0 ? (
        <div className="card p-12 text-center">
          <Globe size={32} className="text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 mb-4">No endpoints yet</p>
          <Link to="/studio" className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus size={14} /> Create your first API
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {endpoints.map(ep => (
            <div key={ep.id} className="card p-5 hover:border-white/10 transition-all group">
              <div className="flex items-start justify-between">
                <Link to={`/endpoints/${ep.id}`} className="flex-1">
                  <div className="flex items-center gap-3 mb-1.5">
                    <h3 className="font-medium group-hover:text-cast-400 transition-colors">{ep.title}</h3>
                    <span className={ep.status === 'active' ? 'badge-green' : 'badge-yellow'}>
                      {ep.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mb-3">{ep.description}</p>
                  <div className="flex items-center gap-6 text-xs text-gray-500">
                    <span className="font-mono text-cast-400/70">/cast/{ep.slug}</span>
                    <span>{ep.total_calls} calls</span>
                    <span>${ep.total_revenue.toFixed(4)} earned</span>
                    <span>${ep.price_per_call}/call</span>
                  </div>
                </Link>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => toggleStatus(ep.id, ep.status)}
                    className="btn-ghost p-2" title={ep.status === 'active' ? 'Pause' : 'Activate'}>
                    {ep.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button onClick={() => deleteEndpoint(ep.id)} className="btn-ghost p-2 hover:text-red-400" title="Delete">
                    <Trash2 size={14} />
                  </button>
                  <Link to={`/endpoints/${ep.id}`} className="btn-ghost p-2" title="Details">
                    <ArrowUpRight size={14} />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
