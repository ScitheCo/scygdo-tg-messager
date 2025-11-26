// Node.js polyfills for browser-like globals required by GramJS
// This MUST be imported before any other modules

// Set self to global (required by GramJS crypto/network)
if (typeof (global as any).self === 'undefined') {
  (global as any).self = global;
}
if (typeof (globalThis as any).self === 'undefined') {
  (globalThis as any).self = globalThis;
}

// DO NOT set window - we want GramJS to detect Node.js environment
// and use native TCP connections instead of WebSocket

// Ensure navigator exists for some crypto polyfills
if (typeof (global as any).navigator === 'undefined') {
  (global as any).navigator = { 
    userAgent: 'node',
    platform: 'node',
    language: 'en-US',
  };
}

export {};
