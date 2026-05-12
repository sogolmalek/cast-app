import { config } from '../config.js';

/**
 * Generator Service — Converts natural language to production-ready endpoint code
 *
 * Multi-provider support: Anthropic, OpenAI, Groq, OpenRouter
 * Uses BYOK (Bring Your Own Key) model — user picks their provider.
 */

const SYSTEM_PROMPT = `You are Cast's API generator. You create production-ready JavaScript endpoint handlers.

RULES:
1. Generate a single async function named 'handler' that takes { input, context } and returns a JSON-serializable object
2. Input validation: define an inputSchema object with field names, types, and whether they're required
3. The handler must be self-contained — no external imports (fetch is available globally)
4. Always include error handling with try/catch
5. Return clean, structured JSON responses
6. Never use eval, Function constructor, or dynamic imports
7. The context object provides: { endpoint_id, caller, timestamp }

OUTPUT FORMAT (respond with ONLY this JSON, no markdown):
{
  "title": "Short descriptive title",
  "description": "What this API does in one sentence",
  "inputSchema": {
    "field_name": { "type": "string|number|boolean|array|object", "required": true|false, "description": "..." }
  },
  "outputSchema": {
    "field_name": { "type": "string|number|boolean|array|object", "description": "..." }
  },
  "code": "async function handler({ input, context }) { ... return { ... }; }"
}

EXAMPLE — for "an API that converts celsius to fahrenheit":
{
  "title": "Temperature converter",
  "description": "Converts temperature from Celsius to Fahrenheit",
  "inputSchema": {
    "celsius": { "type": "number", "required": true, "description": "Temperature in Celsius" }
  },
  "outputSchema": {
    "fahrenheit": { "type": "number", "description": "Temperature in Fahrenheit" },
    "formula": { "type": "string", "description": "The conversion formula used" }
  },
  "code": "async function handler({ input, context }) {\\n  const fahrenheit = (input.celsius * 9/5) + 32;\\n  return {\\n    fahrenheit: Math.round(fahrenheit * 100) / 100,\\n    formula: \\"(C × 9/5) + 32\\",\\n    input_celsius: input.celsius,\\n    converted_at: context.timestamp\\n  };\\n}"
}`;

/**
 * Provider configurations
 * Each provider has: url, headers builder, body builder, response extractor
 */
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-6'],
    buildRequest: (apiKey, messages, model) => ({
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
      },
    }),
    extractText: (data) => data.content?.[0]?.text,
    errorHandler: (status, body) => {
      if (status === 401) return 'Invalid Anthropic API key. Check your key in Settings.';
      if (status === 400 && body?.error?.message?.includes('credit'))
        return 'Anthropic credit balance too low. Add credits at console.anthropic.com or switch to a free provider (Groq, OpenRouter) in Settings.';
      return body?.error?.message || `Anthropic API error: ${status}`;
    },
  },

  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3-mini'],
    buildRequest: (apiKey, messages, model) => ({
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: {
        model: model || 'gpt-4o-mini',
        max_tokens: 4096,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages,
        ],
      },
    }),
    extractText: (data) => data.choices?.[0]?.message?.content,
    errorHandler: (status, body) => {
      if (status === 401) return 'Invalid OpenAI API key. Check your key in Settings.';
      if (status === 429) return 'OpenAI rate limit exceeded or insufficient credits.';
      return body?.error?.message || `OpenAI API error: ${status}`;
    },
  },

  groq: {
    name: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    buildRequest: (apiKey, messages, model) => ({
      url: 'https://api.groq.com/openai/v1/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: {
        model: model || 'llama-3.3-70b-versatile',
        max_tokens: 4096,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages,
        ],
      },
    }),
    extractText: (data) => data.choices?.[0]?.message?.content,
    errorHandler: (status, body) => {
      if (status === 401) return 'Invalid Groq API key. Get a free key at console.groq.com';
      if (status === 429) return 'Groq rate limit hit. Wait a moment and try again (free tier: 30 req/min).';
      return body?.error?.message || `Groq API error: ${status}`;
    },
  },

  openrouter: {
    name: 'OpenRouter',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    models: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemma-2-9b-it:free',
      'mistralai/mistral-7b-instruct:free',
      'anthropic/claude-sonnet-4',
      'openai/gpt-4o-mini',
    ],
    buildRequest: (apiKey, messages, model) => ({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://cast.dev',
        'X-Title': 'Cast',
      },
      body: {
        model: model || 'meta-llama/llama-3.3-70b-instruct:free',
        max_tokens: 4096,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages,
        ],
      },
    }),
    extractText: (data) => data.choices?.[0]?.message?.content,
    errorHandler: (status, body) => {
      if (status === 401) return 'Invalid OpenRouter API key. Get one at openrouter.ai/keys';
      if (status === 402) return 'OpenRouter credits exhausted. Use a :free model or add credits.';
      return body?.error?.message || `OpenRouter API error: ${status}`;
    },
  },
};

/**
 * Generate endpoint code from natural language description
 * @param {string} prompt - Natural language description of the API
 * @param {string} apiKey - User's API key (BYOK)
 * @param {Array} conversationHistory - Previous messages for multi-turn
 * @param {string} provider - Provider id: 'anthropic' | 'openai' | 'groq' | 'openrouter'
 * @param {string} model - Optional specific model override
 * @returns {Promise<Object>} Generated endpoint spec
 */
export async function generateEndpoint(prompt, apiKey, conversationHistory = [], provider = 'anthropic', model = null) {
  if (!apiKey) {
    throw new Error('API key is required. Add your key in Settings.');
  }

  const providerConfig = PROVIDERS[provider];
  if (!providerConfig) {
    throw new Error(`Unsupported provider: ${provider}. Supported: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  const messages = [
    ...conversationHistory.map(m => ({
      role: m.role,
      content: m.content,
    })),
    { role: 'user', content: prompt },
  ];

  const { url, headers, body } = providerConfig.buildRequest(apiKey, messages, model);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(providerConfig.errorHandler(response.status, errBody));
  }

  const data = await response.json();
  const text = providerConfig.extractText(data);
  if (!text) throw new Error(`Empty response from ${providerConfig.name}`);

  // Parse the generated spec
  let spec;
  try {
    // Remove markdown code fences if present
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    spec = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse generated endpoint spec from ${providerConfig.name}. Retrying may help.`);
  }

  // Validate the spec
  if (!spec.title || !spec.code) {
    throw new Error('Generated spec missing required fields (title, code)');
  }

  // Security: basic static analysis of generated code
  validateGeneratedCode(spec.code);

  return {
    title: spec.title,
    description: spec.description || '',
    inputSchema: spec.inputSchema || {},
    outputSchema: spec.outputSchema || {},
    code: spec.code,
    assistantMessage: text,
  };
}

/**
 * Iterate on an existing endpoint with a new instruction
 */
export async function iterateEndpoint(instruction, currentCode, apiKey, conversationHistory = [], provider = 'anthropic', model = null) {
  const iteratePrompt = `The current endpoint code is:
\`\`\`javascript
${currentCode}
\`\`\`

User wants to change it: "${instruction}"

Generate the updated endpoint spec with the changes applied. Respond in the same JSON format.`;

  return generateEndpoint(iteratePrompt, apiKey, conversationHistory, provider, model);
}

/**
 * Get available providers and their models (for frontend)
 */
export function getProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    name: p.name,
    defaultModel: p.defaultModel,
    models: p.models,
  }));
}

/**
 * Static analysis of generated code for basic security
 */
function validateGeneratedCode(code) {
  const forbidden = [
    'eval(', 'eval (',
    'Function(', 'Function (',
    'require(', 'require (',
    'import(', 'import (',
    'process.', 'child_process',
    '__dirname', '__filename',
    'fs.', 'path.',
    'net.', 'http.',
    'crypto.createSign', 'crypto.createPrivateKey',
    'Buffer.alloc(1024', // large buffer allocation
  ];

  for (const pattern of forbidden) {
    if (code.includes(pattern)) {
      throw new Error(`Generated code contains forbidden pattern: ${pattern.slice(0, 20)}...`);
    }
  }

  // Check function structure
  if (!code.includes('async function handler')) {
    throw new Error('Generated code must export an async function named "handler"');
  }

  return true;
}
