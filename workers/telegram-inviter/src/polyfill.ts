// Node.js polyfills for browser-like globals required by GramJS
// This MUST be imported before any other modules

// Set self to global (required by GramJS crypto/network)
if (typeof (global as any).self === 'undefined') {
  (global as any).self = global;
}
if (typeof (globalThis as any).self === 'undefined') {
  (globalThis as any).self = globalThis;
}

// GramJS checks for window to detect browser environment
// We need to provide a complete window-like object
if (typeof (global as any).window === 'undefined') {
  (global as any).window = {
    // Required for GramJS WebSocket detection
    location: {
      protocol: 'http:',  // Use http: so useWSS = false (appropriate for Node.js)
      hostname: 'localhost',
      port: '',
      pathname: '/',
      search: '',
      hash: '',
      href: 'http://localhost/',
    },
    // Some libraries check for these
    document: {
      createElement: () => ({}),
      documentElement: { style: {} },
    },
    // Required for some event handling
    addEventListener: () => {},
    removeEventListener: () => {},
    // Timeout functions (Node.js already has these but just in case)
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval,
  };
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
