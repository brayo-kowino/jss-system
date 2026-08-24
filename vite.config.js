import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import JavaScriptObfuscator from "javascript-obfuscator";

const root = fileURLToPath(new URL(".", import.meta.url));

// --------------------------------------------------------------------------
// These are already-whitelisted (in netlify.toml's CSP script-src) CDN ESM
// imports the app loads straight from the browser: Firebase's modular SDK
// from gstatic, and Chart.js from jsdelivr's +esm build. Bundling them would
// mean either vendoring a copy (drifts from the pinned CDN version, doubles
// bundle size) or breaking their own internal dynamic-import graphs. Keeping
// them external leaves the existing runtime behavior (and CSP) untouched -
// Rollup emits the same bare `import ... from "https://...` specifier as-is,
// and the browser resolves it exactly like it does today.
// --------------------------------------------------------------------------
const isExternalUrl = (id) => /^https?:\/\//.test(id);

// --------------------------------------------------------------------------
// Obfuscation pass, applied to our own code only (never to the untouched
// CDN imports above, since those aren't part of the bundle). Runs *after*
// esbuild's minification as a separate Rollup output pass.
//
// Settings are deliberately conservative:
//   - no `selfDefending` / `debugProtection` — both rely on generating code
//     that runs through `Function(...)`, which needs 'unsafe-eval' in CSP
//     script-src. This app's CSP intentionally has no such allowance (see
//     netlify.toml / security.ts), so anything requiring it would just
//     throw at runtime.
//   - `stringArray: true` with a runtime unpacking function is fine — it's
//     plain generated code, no eval involved.
// --------------------------------------------------------------------------
function obfuscatorPlugin() {
  return {
    name: "obfuscate-chunks",
    // IMPORTANT: this must run in generateBundle, not renderChunk.
    //
    // Rollup resolves cross-chunk references (e.g. the filename inside a
    // dynamic `import("./router-<hash>.js")`) via internal placeholder
    // tokens like `!~{008}~` that get swapped for the real content hash in
    // a final literal find-and-replace pass over each chunk's rendered
    // code - a pass that runs *after* every plugin's renderChunk hook, once
    // every chunk's final hash is known.
    //
    // This plugin's string-array obfuscation feature doesn't know that
    // convention - it treats a dynamic import's specifier as just another
    // string literal to sweep into its encoded/rotated string array. Doing
    // that in renderChunk meant the literal `!~{008}~` text got encoded
    // into the array *before* Rollup's placeholder pass ran, so the
    // placeholder text Rollup was searching for no longer existed anywhere
    // in the chunk verbatim - it silently failed to substitute, and the
    // unresolved placeholder shipped straight to production, breaking
    // every dynamically-imported chunk (auth.service.js, router.js, etc.)
    // with a 404.
    //
    // generateBundle runs after that substitution, so by the time this
    // hook sees the code, every import specifier - static or dynamic - is
    // already the real final filename, and obfuscating it is safe.
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        const asset = bundle[fileName];
        if (asset.type !== "chunk" || !fileName.endsWith(".js")) continue;
        const result = JavaScriptObfuscator.obfuscate(asset.code, {
          compact: true,
          controlFlowFlattening: false,
          deadCodeInjection: false,
          stringArray: true,
          stringArrayEncoding: ["base64"],
          stringArrayThreshold: 0.75,
          rotateStringArray: true,
          shuffleStringArray: true,
          splitStrings: true,
          selfDefending: false, // needs 'unsafe-eval' — CSP doesn't allow it
          debugProtection: false, // same reason
          disableConsoleOutput: false, // app relies on console for its own error/audit paths
          numbersToExpressions: true,
          simplify: true,
          identifierNamesGenerator: "hexadecimal",
          renameGlobals: false,
          target: "browser",
        });
        asset.code = result.getObfuscatedCode();
      }
    },
  };
}

export default {
  root,
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // app.js uses top-level await, which needs ES2022+. The Firebase v10
    // modular SDK and Chart.js (loaded externally, see below) already
    // require a modern evergreen browser, so this doesn't drop support for
    // anything the app didn't already require.
    target: "es2022",
    // The CSP nonce edge function (netlify/edge-functions/security.ts) only
    // stamps nonce="..." onto <script> tags. <link rel="modulepreload">
    // tags aren't <script> tags, and browser enforcement of script-src
    // against modulepreload fetches is inconsistent - so leaving Vite's
    // default modulepreload injection on would risk those preloads being
    // silently blocked (or silently allowed, browser-dependently) under
    // this CSP. Turning it off means the module graph is instead resolved
    // purely through the dynamic `import()` chain already in app.js/
    // router.js - imports triggered from an already nonce-permitted script
    // are trusted transitively and don't need their own nonce, which is
    // exactly what this app already relies on today. Slightly less
    // eager prefetching, zero CSP ambiguity.
    modulePreload: false,
    assetsInlineLimit: 0, // keep every asset as a real file (predictable paths, no surprise inlining)
    sourcemap: false, // no sourcemaps in a build meant to obfuscate the output
    minify: "esbuild",
    cssMinify: true,
    rollupOptions: {
      input: {
        landing: resolve(root, "index.html"),
        app: resolve(root, "app/index.html"),
        dataProtection: resolve(root, "data-protection.html"),
        terms: resolve(root, "terms-of-service.html"),
      },
      external: isExternalUrl,
      output: {
        // Stable, hashed, content-addressed filenames under /assets/ so the
        // long-cache header rule in netlify.toml can target them safely.
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [obfuscatorPlugin()],
};