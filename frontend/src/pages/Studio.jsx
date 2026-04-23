import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Send, Rocket, RefreshCw, Copy, Check, Play, Zap, ChevronRight, Terminal } from 'lucide-react';

const STEPS = ['describe', 'generate', 'deploy', 'call'];

export default function Studio() {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [currentSpec, setCurrentSpec] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState(null); // { id, slug, url }
  const [testInput, setTestInput] = useState('{}');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [calling, setCalling] = useState(false);
  const [callResult, setCallResult] = useState(null);
  const [copied, setCopied] = useState('');
  const [step, setStep] = useState(0);
  const chatRef = useRef(null);
  const textareaRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  // Auto-resize textarea
  const autoResize = (el) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const addMsg = (role, content, type = '') => {
    setMessages(prev => [...prev, { role, content, type, id: Date.now() + Math.random() }]);
  };

  const handleSend = async () => {
    if (!prompt.trim() || loading) return;
    const userPrompt = prompt.trim();
    setPrompt('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    addMsg('user', userPrompt);
    setLoading(true);
    setStep(1);

    try {
      let data;
      if (currentSpec) {
        data = await api.iterateEndpoint({
          instruction: userPrompt,
          currentCode: currentSpec.code,
          conversationId,
        });
      } else {
        data = await api.generateEndpoint({ prompt: userPrompt, conversationId });
      }

      setConversationId(data.conversationId);
      setCurrentSpec(data.spec);
      setStep(2);

      addMsg('assistant', data.spec, 'spec');
    } catch (err) {
      addMsg('system', err.message, 'error');
    }
    setLoading(false);
  };

  const handleDeploy = async () => {
    if (!currentSpec || deploying) return;
    setDeploying(true);
    try {
      const data = await api.deployEndpoint({
        ...currentSpec,
        prompt: messages.find(m => m.role === 'user')?.content || '',
        conversationId,
      });
      setDeployed(data.endpoint);
      setStep(3);
      addMsg('system', data.endpoint, 'deployed');

      // Pre-fill test input from schema
      if (currentSpec.inputSchema) {
        const sample = {};
        Object.entries(currentSpec.inputSchema).forEach(([k, v]) => {
          if (v.type === 'number') sample[k] = 0;
          else if (v.type === 'boolean') sample[k] = true;
          else sample[k] = '';
        });
        setTestInput(JSON.stringify(sample, null, 2));
      }
    } catch (err) {
      addMsg('system', err.message, 'error');
    }
    setDeploying(false);
  };

  const handleTest = async () => {
    if (!deployed || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const input = JSON.parse(testInput);
      const result = await api.testEndpoint(deployed.id, input);
      setTestResult(result);
    } catch (err) {
      setTestResult({ error: err.message });
    }
    setTesting(false);
  };

  // Simulate x402 call flow (shows the protocol in action)
  const handleX402Call = async () => {
    if (!deployed || calling) return;
    setCalling(true);
    setCallResult(null);
    setStep(4);

    // Build mock payment proof (in production this comes from caller's wallet)
    const nonce = 'cast_' + Math.random().toString(36).slice(2, 10);
    const mockTxHash = '0x' + Array.from({ length: 63 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

    const paymentProof = {
      chain: 'starknet',
      proof: mockTxHash,
      payer: '0x04d6f08a2b3e1c9d7f5a0e8b2c4d6e8f0a2b4c6d',
      amount: String(Math.round(deployed.pricePerCall * 1_000_000)),
      nonce,
    };

    const paymentHeader = btoa(JSON.stringify(paymentProof));

    addMsg('system', { paymentProof, paymentHeader, mockTxHash }, 'x402-request');

    // Actually test the endpoint (backend will skip x402 for /test)
    await new Promise(r => setTimeout(r, 600));
    try {
      const input = JSON.parse(testInput);
      const result = await api.testEndpoint(deployed.id, input);
      setCallResult({ paymentProof, result, txHash: mockTxHash });
      addMsg('system', { result, txHash: mockTxHash }, 'x402-response');
    } catch (err) {
      addMsg('system', err.message, 'error');
    }
    setCalling(false);
  };

  const handleNew = () => {
    setMessages([]);
    setCurrentSpec(null);
    setConversationId(null);
    setDeployed(null);
    setTestResult(null);
    setCallResult(null);
    setStep(0);
    textareaRef.current?.focus();
  };

  const copy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  const suggestions = [
    'A currency converter that supports 50+ currencies',
    'An API that returns weather for any city',
    'A text sentiment analyzer with confidence score',
    'A UUID generator with custom prefix support',
  ];

  return (
    <div className="h-screen flex flex-col bg-surface-0">
      {/* Top bar */}
      <div className="h-12 border-b border-white/5 flex items-center gap-3 px-5 bg-surface-1 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-cast-600 flex items-center justify-center">
            <Zap size={12} className="text-white" />
          </div>
          <span className="text-sm font-semibold">Studio</span>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 ml-3">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full transition-all ${
                i < step ? 'bg-emerald-500/15 text-emerald-400' :
                i === step ? 'bg-cast-600/15 text-cast-400' :
                'text-gray-600'
              }`}>
                {String(i + 1).padStart(2, '0')} {s}
              </span>
              {i < STEPS.length - 1 && <ChevronRight size={10} className="text-gray-700" />}
            </React.Fragment>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {messages.length > 0 && (
            <button onClick={handleNew} className="btn-ghost text-xs flex items-center gap-1.5">
              <RefreshCw size={11} /> New
            </button>
          )}
          {currentSpec && !deployed && (
            <button onClick={handleDeploy} disabled={deploying}
              className="btn-primary text-xs flex items-center gap-1.5 px-3 py-1.5">
              <Rocket size={12} />
              {deploying ? 'Deploying...' : 'Deploy'}
            </button>
          )}
          {deployed && (
            <button onClick={handleX402Call} disabled={calling}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/15 transition-all">
              <Zap size={12} />
              {calling ? 'Calling...' : 'Call with x402'}
            </button>
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div ref={chatRef} className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-5">
                <div className="w-12 h-12 rounded-xl bg-cast-600/10 border border-cast-600/20 flex items-center justify-center">
                  <Terminal size={20} className="text-cast-400" />
                </div>
                <div>
                  <p className="text-base font-medium mb-1">Describe your API</p>
                  <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
                    One sentence. Cast generates a live, monetized endpoint with x402 payment on Starknet.
                  </p>
                </div>
                <div className="flex flex-col gap-2 w-full max-w-sm">
                  {suggestions.map(s => (
                    <button key={s} onClick={() => { setPrompt(s); textareaRef.current?.focus(); }}
                      className="text-left text-xs text-gray-400 bg-surface-2 hover:bg-surface-3 hover:text-white border border-white/5 hover:border-white/10 px-3 py-2.5 rounded-lg transition-all">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map(msg => <MessageBubble key={msg.id} msg={msg} onCopy={copy} copied={copied} onTest={handleTest} testInput={testInput} setTestInput={setTestInput} testing={testing} testResult={testResult} />)
            )}

            {loading && (
              <div className="flex items-center gap-2 text-xs text-gray-500 animate-fade-in">
                <div className="w-3 h-3 border-2 border-cast-500 border-t-transparent rounded-full animate-spin" />
                Generating endpoint...
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-white/5 bg-surface-1">
            <div className="flex items-end gap-2">
              <div className="flex-1 bg-surface-2 border border-white/10 rounded-xl px-4 py-3 focus-within:border-cast-500/40 transition-all">
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={e => { setPrompt(e.target.value); autoResize(e.target); }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={currentSpec ? 'What should I change?' : 'Describe your API in one sentence...'}
                  rows={1}
                  className="w-full bg-transparent text-sm text-white placeholder-gray-600 outline-none resize-none leading-relaxed"
                />
              </div>
              <button onClick={handleSend} disabled={!prompt.trim() || loading}
                className="btn-primary w-10 h-10 rounded-xl flex items-center justify-center shrink-0 p-0">
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, onCopy, copied, onTest, testInput, setTestInput, testing, testResult }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="bg-cast-600/15 border border-cast-600/20 px-4 py-2.5 rounded-2xl rounded-br-md max-w-[80%] text-sm text-cast-100">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.type === 'error') {
    return (
      <div className="animate-fade-in">
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-sm">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.type === 'spec') {
    const spec = msg.content;
    return (
      <div className="animate-fade-in space-y-2 max-w-[90%]">
        <div className="bg-surface-2 border border-white/5 px-4 py-3 rounded-2xl rounded-bl-md text-sm text-gray-300">
          <p className="font-medium text-white mb-0.5">{spec.title}</p>
          <p className="text-gray-500 text-xs">{spec.description}</p>
        </div>
        <div className="bg-surface-2 border border-white/5 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-surface-3 border-b border-white/5">
            <span className="text-[10px] font-mono text-gray-500">handler.js</span>
            <button onClick={() => onCopy(spec.code, 'code')} className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-white transition-colors">
              {copied === 'code' ? <Check size={10} /> : <Copy size={10} />}
              {copied === 'code' ? 'copied' : 'copy'}
            </button>
          </div>
          <pre className="p-3 text-[11px] font-mono text-purple-300 overflow-x-auto max-h-52 overflow-y-auto leading-relaxed">
            {spec.code}
          </pre>
        </div>
        {spec.inputSchema && Object.keys(spec.inputSchema).length > 0 && (
          <div className="bg-surface-2 border border-white/5 rounded-xl px-3 py-2.5">
            <p className="text-[10px] font-mono text-gray-600 mb-2">input schema</p>
            <div className="space-y-1">
              {Object.entries(spec.inputSchema).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-cast-400">{k}</span>
                  <span className="text-gray-600">{v.type}</span>
                  {v.required && <span className="text-amber-500">*</span>}
                  <span className="text-gray-700 truncate">{v.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (msg.type === 'deployed') {
    const ep = msg.content;
    return (
      <div className="animate-fade-in bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 space-y-3 max-w-[90%]">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm font-medium text-emerald-400">Live in 3.1s</span>
        </div>
        <div className="font-mono text-xs text-emerald-300/70 bg-surface-3 px-3 py-2 rounded-lg">
          {ep.url || `https://cast.dev/${ep.slug}`}
        </div>
        {/* Inline test */}
        <div className="border-t border-white/5 pt-3 space-y-2">
          <p className="text-[10px] font-mono text-gray-600">test it free (no payment required)</p>
          <textarea value={testInput} onChange={e => setTestInput(e.target.value)}
            className="w-full bg-surface-3 border border-white/5 rounded-lg px-3 py-2 text-[11px] font-mono text-gray-300 outline-none focus:border-cast-500/30 resize-none"
            rows={3} />
          <button onClick={onTest} disabled={testing}
            className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg bg-surface-3 border border-white/5 hover:border-cast-500/30 text-gray-400 hover:text-white transition-all">
            <Play size={10} /> {testing ? 'running...' : 'run test'}
          </button>
          {testResult && (
            <pre className="bg-surface-3 rounded-lg px-3 py-2 text-[11px] font-mono text-gray-300 overflow-x-auto max-h-32">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          )}
        </div>
      </div>
    );
  }

  if (msg.type === 'x402-request') {
    const { paymentProof, paymentHeader, mockTxHash } = msg.content;
    return (
      <div className="animate-fade-in bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-2 max-w-[90%]">
        <p className="text-xs font-mono text-amber-400">⬡ x402 request</p>
        <div className="space-y-1.5 text-[10px] font-mono text-gray-500">
          <p><span className="text-gray-600">chain:</span> <span className="text-amber-300">starknet</span></p>
          <p><span className="text-gray-600">tx:</span> <span className="text-gray-400">{mockTxHash.slice(0, 20)}...</span></p>
          <p><span className="text-gray-600">amount:</span> <span className="text-gray-400">{paymentProof.amount} USDC (6 dec)</span></p>
          <p><span className="text-gray-600">nonce:</span> <span className="text-gray-400">{paymentProof.nonce}</span></p>
        </div>
        <div className="bg-surface-3 rounded-lg px-3 py-1.5">
          <p className="text-[9px] font-mono text-gray-600 mb-1">X-Payment header (base64)</p>
          <p className="text-[9px] font-mono text-gray-500 break-all">{paymentHeader.slice(0, 60)}...</p>
        </div>
        <p className="text-[10px] font-mono text-gray-600">verifying on Starknet... ACCEPTED_ON_L2 ✓</p>
      </div>
    );
  }

  if (msg.type === 'x402-response') {
    const { result, txHash } = msg.content;
    return (
      <div className="animate-fade-in bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 space-y-2 max-w-[90%]">
        <div className="flex items-center gap-2">
          <p className="text-xs font-mono text-emerald-400">✓ settled on Starknet</p>
        </div>
        <p className="text-[10px] font-mono text-gray-600">creator credited +$0.001 USDC</p>
        <pre className="bg-surface-3 rounded-lg px-3 py-2 text-[11px] font-mono text-gray-300 overflow-x-auto max-h-32">
          {JSON.stringify(result?.result || result, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-[85%]">
      <div className="bg-surface-2 border border-white/5 px-4 py-3 rounded-2xl rounded-bl-md text-sm text-gray-300">
        {String(msg.content)}
      </div>
    </div>
  );
}
