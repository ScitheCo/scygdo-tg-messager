// Node.js polyfills for browser-like globals required by GramJS
// This MUST be imported before any other modules

// CRITICAL: Force delete window if any build tool defined it
// GramJS checks: isBrowser = typeof window !== "undefined"
// We need isBrowser = false for production servers
if (typeof (globalThis as any).window !== 'undefined') {
  delete (globalThis as any).window;
}
if (typeof (global as any).window !== 'undefined') {
  delete (global as any).window;
}

// Set self to global (required by GramJS crypto/network)
if (typeof (global as any).self === 'undefined') {
  (global as any).self = global;
}
if (typeof (globalThis as any).self === 'undefined') {
  (globalThis as any).self = globalThis;
}

// Ensure navigator exists for some crypto polyfills
if (typeof (global as any).navigator === 'undefined') {
  (global as any).navigator = { 
    userAgent: 'node',
    platform: 'node',
    language: 'en-US',
  };
}

export {};
