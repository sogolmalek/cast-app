import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { ArrowLeft, Copy, Check, Play, Activity, DollarSign, Clock, Globe, ExternalLink } from 'lucide-react';

export default function EndpointDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');
  const [testInput, setTestInput] = useState('{}');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getEndpoint(id),
      api.getAnalytics(id, 30),
    ]).then(([d, a]) => {
      setData(d);
      setAnalytics(a);
      // Pre-fill test input from schema
      if (d.endpoint.input_schema && Object.keys(d.endpoint.input_schema).length > 0) {
        const sample = {};
        Object.entries(d.endpoint.input_schema).forEach(([k, v]) => {
          if (v.type === 'number') sample[k] = 0;
          else if (v.type === 'boolean') sample[k] = true;
          else if (v.type === 'array') sample[k] = [];
          else sample[k] = '';
        });
        setTestInput(JSON.stringify(sample, null, 2));
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  const copyText = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const input = JSON.parse(testInput);
      const result = await api.testEndpoint(id, input);
      setTestResult(result);
    } catch (err) {
      setTestResult({ error: err.message });
    }
    setTesting(false);
  };

  if (loading || !data) {
    return <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-cast-500 border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  const ep = data.endpoint;
  const baseUrl = window.location.origin;
  const endpointUrl = `${baseUrl}/cast/${ep.slug}`;

  const curlExample = `curl -X POST ${endpointUrl} \\
  -H "Content-Type: application/json" \\
  -H "X-Payment: <base64_payment_proof>" \\
  -d '${testInput}'`;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link to="/dashboard" className="flex items-center gap-1.5 text-gray-500 hover:text-white text-sm mb-6 transition-colors">
        <ArrowLeft size={14} /> Dashboard
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-semibold">{ep.title}</h1>
            <span className={ep.status === 'active' ? 'badge-green' : 'badge-yellow'}>{ep.status}</span>
          </div>
          <p className="text-gray-500 text-sm mb-3">{ep.description}</p>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono text-cast-400 bg-surface-2 px-3 py-1.5 rounded-lg">{endpointUrl}</code>
            <button onClick={() => copyText(endpointUrl, 'url')} className="btn-ghost p-1.5">
              {copied === 'url' ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total calls', value: ep.total_calls.toLocaleString(), icon: Activity },
          { label: 'Revenue', value: `$${ep.total_revenue.toFixed(4)}`, icon: DollarSign },
          { label: 'Price/call', value: `$${ep.price_per_call}`, icon: Globe },
          { label: 'Version', value: `v${ep.version}`, icon: Clock },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="card p-4">
            <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-1"><Icon size={12} />{label}</div>
            <p className="text-lg font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left: Code + Usage */}
        <div className="space-y-6">
          {/* Code */}
          <div className="card">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <span className="text-sm font-medium">Generated code</span>
              <button onClick={() => copyText(ep.generated_code, 'code')} className="btn-ghost text-xs flex items-center gap-1 py-1 px-2">
                {copied === 'code' ? <Check size={12} /> : <Copy size={12} />} {copied === 'code' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-gray-300 overflow-x-auto max-h-72 overflow-y-auto leading-relaxed">{ep.generated_code}</pre>
          </div>

          {/* cURL example */}
          <div className="card">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <span className="text-sm font-medium">Usage (cURL)</span>
              <button onClick={() => copyText(curlExample, 'curl')} className="btn-ghost text-xs flex items-center gap-1 py-1 px-2">
                {copied === 'curl' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-gray-400 overflow-x-auto">{curlExample}</pre>
          </div>
        </div>

        {/* Right: Test + Schema + Recent calls */}
        <div className="space-y-6">
          {/* Test */}
          <div className="card">
            <div className="p-4 border-b border-white/5">
              <span className="text-sm font-medium">Test endpoint</span>
            </div>
            <div className="p-4 space-y-3">
              <textarea value={testInput} onChange={e => setTestInput(e.target.value)}
                className="input-field w-full font-mono text-xs" rows={5} />
              <button onClick={handleTest} disabled={testing} className="btn-primary w-full text-sm flex items-center justify-center gap-2">
                <Play size={14} /> {testing ? 'Running...' : 'Run test (free)'}
              </button>
              {testResult && (
                <pre className="bg-surface-2 p-3 rounded-lg text-xs font-mono text-gray-300 overflow-x-auto max-h-48 overflow-y-auto">
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              )}
            </div>
          </div>

          {/* Schema */}
          {ep.input_schema && Object.keys(ep.input_schema).length > 0 && (
            <div className="card">
              <div className="p-4 border-b border-white/5">
                <span className="text-sm font-medium">Input schema</span>
              </div>
              <div className="p-4 space-y-2">
                {Object.entries(ep.input_schema).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between text-sm bg-surface-2 px-3 py-2 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-cast-400">{key}</span>
                      {val.required && <span className="text-[10px] text-amber-500">required</span>}
                    </div>
                    <span className="text-xs text-gray-500">{val.type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent calls */}
          <div className="card">
            <div className="p-4 border-b border-white/5">
              <span className="text-sm font-medium">Recent calls</span>
            </div>
            {data.recentCalls.length === 0 ? (
              <div className="p-6 text-center text-gray-500 text-sm">No calls yet</div>
            ) : (
              <div className="divide-y divide-white/5 max-h-64 overflow-y-auto">
                {data.recentCalls.map(call => (
                  <div key={call.id} className="p-3 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-mono text-gray-400">{call.caller_address?.slice(0, 8)}...</span>
                      <span className="text-gray-600 ml-2">{call.chain}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={call.response_status < 400 ? 'text-emerald-400' : 'text-red-400'}>
                        {call.response_status}
                      </span>
                      <span className="text-gray-600">{call.latency_ms}ms</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
