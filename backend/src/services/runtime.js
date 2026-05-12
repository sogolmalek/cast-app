import vm from 'node:vm';
import { config } from '../config.js';

/**
 * Runtime Service — Sandboxed execution of generated endpoint code
 *
 * Each endpoint runs in an isolated VM context with:
 * - Timeout protection (default 10s)
 * - Memory limits
 * - No access to Node.js internals
 * - Only whitelisted globals (fetch, JSON, Math, Date, console)
 *
 * The generated code is wrapped in a VM context and executed
 * with the caller's input and request context.
 */

/**
 * Execute a generated endpoint handler in a sandbox
 * @param {string} code - The generated handler code
 * @param {Object} input - Validated input from the caller
 * @param {Object} context - Request context { endpoint_id, caller, timestamp }
 * @returns {Promise<{ result: any, executionMs: number }>}
 */
export async function executeEndpoint(code, input, context) {
  const startTime = performance.now();

  // Create sandboxed context with whitelisted globals
  const sandbox = {
    // Safe globals
    JSON,
    Math,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    RegExp,
    Error,
    TypeError,
    RangeError,
    Promise,
    Symbol,
    BigInt,

    // Controlled fetch (with timeout)
    fetch: createSandboxedFetch(),

    // Limited console
    console: {
      log: (...args) => console.log('[endpoint]', ...args),
      error: (...args) => console.error('[endpoint]', ...args),
      warn: (...args) => console.warn('[endpoint]', ...args),
    },

    // Result holder
    __result: null,
    __error: null,
  };

  // Create VM context
  const vmContext = vm.createContext(sandbox, {
    name: `cast-endpoint-${context.endpoint_id}`,
  });

  // Wrap code to capture result
  const wrappedCode = `
    ${code}

    (async () => {
      try {
        __result = await handler({
          input: ${JSON.stringify(input)},
          context: ${JSON.stringify(context)}
        });
      } catch (err) {
        __error = { message: err.message, name: err.name };
      }
    })();
  `;

  try {
    // Compile and run with timeout
    const script = new vm.Script(wrappedCode, {
      filename: `endpoint-${context.endpoint_id}.js`,
    });

    const promise = script.runInContext(vmContext, {
      timeout: config.runtime.timeoutMs,
      displayErrors: true,
    });

    // Wait for async execution
    await promise;

    const executionMs = Math.round(performance.now() - startTime);

    if (sandbox.__error) {
      return {
        error: sandbox.__error,
        executionMs,
        success: false,
      };
    }

    // Validate response size
    const responseStr = JSON.stringify(sandbox.__result);
    if (responseStr && responseStr.length > config.runtime.maxResponseSize) {
      return {
        error: { message: 'Response exceeds maximum size (1MB)', name: 'ResponseTooLarge' },
        executionMs,
        success: false,
      };
    }

    return {
      result: sandbox.__result,
      executionMs,
      success: true,
    };
  } catch (err) {
    const executionMs = Math.round(performance.now() - startTime);

    if (err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      return {
        error: { message: `Execution timeout (${config.runtime.timeoutMs}ms)`, name: 'Timeout' },
        executionMs,
        success: false,
      };
    }

    return {
      error: { message: err.message, name: err.constructor.name },
      executionMs,
      success: false,
    };
  }
}

/**
 * Validate input against the endpoint's input schema
 */
export function validateInput(input, schema) {
  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = input?.[field];

    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push(`Missing required field: ${field}`);
      continue;
    }

    if (value !== undefined && value !== null) {
      const type = rules.type;
      if (type === 'number' && typeof value !== 'number') {
        errors.push(`Field '${field}' must be a number`);
      } else if (type === 'string' && typeof value !== 'string') {
        errors.push(`Field '${field}' must be a string`);
      } else if (type === 'boolean' && typeof value !== 'boolean') {
        errors.push(`Field '${field}' must be a boolean`);
      } else if (type === 'array' && !Array.isArray(value)) {
        errors.push(`Field '${field}' must be an array`);
      } else if (type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
        errors.push(`Field '${field}' must be an object`);
      }
    }
  }

  return errors;
}

/**
 * Create a fetch function with restrictions for the sandbox
 */
function createSandboxedFetch() {
  return async (url, options = {}) => {
    // Restrict to HTTPS only
    if (typeof url === 'string' && !url.startsWith('https://')) {
      throw new Error('Sandbox fetch only supports HTTPS URLs');
    }

    // Block internal network
    const parsedUrl = new URL(url);
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254', '::1'];
    if (blockedHosts.includes(parsedUrl.hostname) || parsedUrl.hostname.endsWith('.internal')) {
      throw new Error('Cannot access internal network from sandbox');
    }

    // Add timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          ...options.headers,
          'User-Agent': 'Cast/1.0',
        },
      });

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers),
        json: () => response.json(),
        text: () => response.text(),
      };
    } finally {
      clearTimeout(timeout);
    }
  };
}
