import { config } from '../config.js';

/**
 * Generator Service — Converts natural language to production-ready endpoint code
 *
 * Uses Claude API (BYOK) to generate:
 * 1. Input validation (Zod schemas)
 * 2. Core logic
 * 3. Error handling
 * 4. Proper response shapes
 *
 * The generated code is a self-contained async function that receives
 * a validated input object and returns a response object.
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
 * Generate endpoint code from natural language description
 * @param {string} prompt - Natural language description of the API
 * @param {string} claudeApiKey - User's Claude API key (BYOK)
 * @param {Array} conversationHistory - Previous messages for multi-turn
 * @returns {Promise<Object>} Generated endpoint spec
 */
export async function generateEndpoint(prompt, claudeApiKey, conversationHistory = []) {
  if (!claudeApiKey) {
    throw new Error('Claude API key is required. Add your key in Settings.');
  }

  const messages = [
    ...conversationHistory.map(m => ({
      role: m.role,
      content: m.content,
    })),
    { role: 'user', content: prompt },
  ];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) {
      throw new Error('Invalid Claude API key. Check your key in Settings.');
    }
    throw new Error(err.error?.message || `Claude API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Empty response from Claude');

  // Parse the generated spec
  let spec;
  try {
    // Remove markdown code fences if present
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    spec = JSON.parse(cleaned);
  } catch {
    throw new Error('Failed to parse generated endpoint spec. Retrying may help.');
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
export async function iterateEndpoint(instruction, currentCode, claudeApiKey, conversationHistory = []) {
  const iteratePrompt = `The current endpoint code is:
\`\`\`javascript
${currentCode}
\`\`\`

User wants to change it: "${instruction}"

Generate the updated endpoint spec with the changes applied. Respond in the same JSON format.`;

  return generateEndpoint(iteratePrompt, claudeApiKey, conversationHistory);
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
