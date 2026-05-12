import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../App';
import { Key, Eye, EyeOff, Check, Shield, ExternalLink, ChevronDown, Zap } from 'lucide-react';

const PROVIDER_META = {
  anthropic: {
    label: 'Anthropic (Claude)',
    placeholder: 'sk-ant-api03-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyLabel: 'Get key from Anthropic Console',
    color: 'text-orange-400',
    note: 'Best quality. Requires credits on your Anthropic account.',
  },
  openai: {
    label: 'OpenAI (GPT)',
    placeholder: 'sk-proj-...',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyLabel: 'Get key from OpenAI Platform',
    color: 'text-emerald-400',
    note: 'Great quality. Requires OpenAI credits.',
  },
  groq: {
    label: 'Groq (Free tier)',
    placeholder: 'gsk_...',
    keyUrl: 'https://console.groq.com/keys',
    keyLabel: 'Get free key from Groq Console',
    color: 'text-blue-400',
    note: 'Free tier available! Fast inference, 30 req/min on free plan.',
  },
  openrouter: {
    label: 'OpenRouter (Multi-model)',
    placeholder: 'sk-or-v1-...',
    keyUrl: 'https://openrouter.ai/keys',
    keyLabel: 'Get key from OpenRouter',
    color: 'text-purple-400',
    note: 'Free models available (Llama, Gemma, Mistral). Or pay for Claude/GPT through one key.',
  },
};

export default function Settings() {
  const { user, setUser } = useAuth();
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('anthropic');
  const [selectedModel, setSelectedModel] = useState('');
  const [providers, setProviders] = useState([]);
  const [currentProvider, setCurrentProvider] = useState('anthropic');

  useEffect(() => {
    api.me().then(data => {
      setHasKey(data.hasClaudeKey);
      setCurrentProvider(data.aiProvider || 'anthropic');
      setSelectedProvider(data.aiProvider || 'anthropic');
      if (data.aiModel) setSelectedModel(data.aiModel);
    }).catch(() => {});

    api.getProviders().then(data => {
      setProviders(data.providers);
    }).catch(() => {});
  }, []);

  const currentProviderData = providers.find(p => p.id === selectedProvider);
  const meta = PROVIDER_META[selectedProvider] || PROVIDER_META.anthropic;

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await api.saveClaudeKey(apiKey, selectedProvider, selectedModel || undefined);
      setHasKey(true);
      setCurrentProvider(selectedProvider);
      setSaved(true);
      setApiKey('');
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert(err.message);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirm('Remove your API key? You won\'t be able to create new endpoints until you add a new key.')) return;
    try {
      await api.deleteClaudeKey();
      setHasKey(false);
      setCurrentProvider('anthropic');
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold mb-6">Settings</h1>

      {/* AI Provider & Key */}
      <div className="card">
        <div className="p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cast-600/15 flex items-center justify-center">
              <Key size={18} className="text-cast-400" />
            </div>
            <div>
              <h2 className="font-medium">AI Provider & API Key</h2>
              <p className="text-xs text-gray-500">Bring your own key — Cast uses it to generate endpoint code</p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {hasKey ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-surface-2 rounded-lg px-4 py-3">
                <div className="flex items-center gap-2">
                  <Check size={14} className="text-emerald-400" />
                  <span className="text-sm text-emerald-400 font-medium">
                    {PROVIDER_META[currentProvider]?.label || 'API'} key configured
                  </span>
                </div>
                <button onClick={handleDelete} className="text-sm text-red-400 hover:text-red-300 transition-colors">
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Provider selector */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">Provider</label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(PROVIDER_META).map(([id, m]) => (
                    <button
                      key={id}
                      onClick={() => {
                        setSelectedProvider(id);
                        setSelectedModel('');
                      }}
                      className={`text-left px-3 py-2.5 rounded-lg border transition-all text-sm ${
                        selectedProvider === id
                          ? 'border-cast-500 bg-cast-500/10'
                          : 'border-white/5 bg-surface-2 hover:border-white/10'
                      }`}
                    >
                      <span className={`font-medium ${selectedProvider === id ? 'text-cast-300' : ''}`}>
                        {m.label}
                      </span>
                      {(id === 'groq' || id === 'openrouter') && (
                        <span className="ml-1.5 text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full">
                          free tier
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Provider note */}
              <div className="flex items-start gap-2 bg-surface-2 rounded-lg p-3">
                <Zap size={14} className={`${meta.color} mt-0.5 shrink-0`} />
                <span className="text-xs text-gray-400">{meta.note}</span>
              </div>

              {/* Model selector */}
              {currentProviderData && (
                <div>
                  <label className="block text-xs text-gray-500 mb-2">Model</label>
                  <select
                    value={selectedModel || currentProviderData.defaultModel}
                    onChange={e => setSelectedModel(e.target.value)}
                    className="input-field w-full text-sm"
                  >
                    {currentProviderData.models.map(m => (
                      <option key={m} value={m}>
                        {m} {m === currentProviderData.defaultModel ? '(default)' : ''}
                        {m.includes(':free') ? ' ★ free' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* API key input */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">API Key</label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder={meta.placeholder}
                      className="input-field w-full pr-10 font-mono text-sm"
                    />
                    <button onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors">
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <button onClick={handleSave} disabled={!apiKey.trim() || saving}
                    className="btn-primary shrink-0">
                    {saving ? 'Saving...' : saved ? 'Saved!' : 'Save key'}
                  </button>
                </div>
              </div>

              <div className="bg-surface-2 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <Shield size={14} className="text-gray-500 mt-0.5 shrink-0" />
                  <div className="text-xs text-gray-500 leading-relaxed">
                    <p className="mb-2">Your API key is stored encrypted on our server. It is only used to call {meta.label.split('(')[0].trim()} when you generate or iterate on endpoints.</p>
                    <a href={meta.keyUrl} target="_blank" rel="noopener"
                      className="text-cast-400 hover:text-cast-300 inline-flex items-center gap-1 transition-colors">
                      {meta.keyLabel} <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Account info */}
      <div className="card mt-6">
        <div className="p-5 border-b border-white/5">
          <h2 className="font-medium">Account</h2>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Email</span>
            <span>{user?.email}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Member since</span>
            <span>{user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</span>
          </div>
        </div>
      </div>

      {/* Supported chains */}
      <div className="card mt-6">
        <div className="p-5 border-b border-white/5">
          <h2 className="font-medium">Supported chains</h2>
        </div>
        <div className="p-5 space-y-3">
          {[
            { name: 'Solana', features: ['AUDD', 'sub-second', 'sub-cent fees'], color: 'emerald', native: true },
            { name: 'Base', features: ['USDC', 'x402 original', 'EVM'], color: 'blue', native: false },
          ].map(chain => (
            <div key={chain.name} className="flex items-center justify-between p-3 bg-surface-2 rounded-lg">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full bg-${chain.color}-500`} />
                <span className="text-sm font-medium">{chain.name}</span>
                {chain.native && <span className="badge-purple text-[10px]">native</span>}
              </div>
              <div className="flex items-center gap-2">
                {chain.features.map(f => (
                  <span key={f} className="text-[10px] text-gray-500 bg-surface-3 px-2 py-0.5 rounded">{f}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
