// Node.js polyfills for browser-like globals required by GramJS
// This MUST be imported before any other modules

// Set self to global (required by GramJS crypto/network)
if (typeof (global as any).self === 'undefined') {
  (global as any).self = global;
}
if (typeof (globalThis as any).self === 'undefined') {
  (globalThis as any).self = globalThis;
}

// Some GramJS dependencies also check for window
if (typeof (global as any).window === 'undefined') {
  (global as any).window = global;
}

// Ensure navigator exists for some crypto polyfills
if (typeof (global as any).navigator === 'undefined') {
  (global as any).navigator = { userAgent: 'node' };
}

export {};
