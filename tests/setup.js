// Global test setup for Vitest
if (typeof globalThis.location === "undefined") {
  globalThis.location = {
    hostname: "localhost",
    href: "http://localhost:3000",
    protocol: "http:",
    host: "localhost:3000",
    origin: "http://localhost:3000",
  };
}

if (typeof globalThis.navigator === "undefined") {
  globalThis.navigator = {
    onLine: true,
  };
}
