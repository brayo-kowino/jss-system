// vite.config.js
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import JavaScriptObfuscator from "file:///C:/Users/Brian/OneDrive/Desktop/jss-system/node_modules/javascript-obfuscator/dist/index.js";
var __vite_injected_original_import_meta_url = "file:///C:/Users/Brian/OneDrive/Desktop/jss-system/vite.config.js";
var root = fileURLToPath(new URL(".", __vite_injected_original_import_meta_url));
var isExternalUrl = (id) => /^https?:\/\//.test(id);
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
          selfDefending: false,
          // needs 'unsafe-eval' — CSP doesn't allow it
          debugProtection: false,
          // same reason
          disableConsoleOutput: false,
          // app relies on console for its own error/audit paths
          numbersToExpressions: true,
          simplify: true,
          identifierNamesGenerator: "hexadecimal",
          renameGlobals: false,
          target: "browser"
        });
        asset.code = result.getObfuscatedCode();
      }
    }
  };
}
var vite_config_default = {
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
    assetsInlineLimit: 0,
    // keep every asset as a real file (predictable paths, no surprise inlining)
    sourcemap: false,
    // no sourcemaps in a build meant to obfuscate the output
    minify: "esbuild",
    cssMinify: true,
    rollupOptions: {
      input: {
        landing: resolve(root, "index.html"),
        app: resolve(root, "app/index.html"),
        dataProtection: resolve(root, "data-protection.html"),
        terms: resolve(root, "terms-of-service.html")
      },
      external: isExternalUrl,
      output: {
        // Stable, hashed, content-addressed filenames under /assets/ so the
        // long-cache header rule in netlify.toml can target them safely.
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  },
  plugins: [obfuscatorPlugin()]
};
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxCcmlhblxcXFxPbmVEcml2ZVxcXFxEZXNrdG9wXFxcXGpzcy1zeXN0ZW1cIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXEJyaWFuXFxcXE9uZURyaXZlXFxcXERlc2t0b3BcXFxcanNzLXN5c3RlbVxcXFx2aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvQnJpYW4vT25lRHJpdmUvRGVza3RvcC9qc3Mtc3lzdGVtL3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGgsIFVSTCB9IGZyb20gXCJub2RlOnVybFwiO1xuaW1wb3J0IEphdmFTY3JpcHRPYmZ1c2NhdG9yIGZyb20gXCJqYXZhc2NyaXB0LW9iZnVzY2F0b3JcIjtcblxuY29uc3Qgcm9vdCA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi5cIiwgaW1wb3J0Lm1ldGEudXJsKSk7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGVzZSBhcmUgYWxyZWFkeS13aGl0ZWxpc3RlZCAoaW4gbmV0bGlmeS50b21sJ3MgQ1NQIHNjcmlwdC1zcmMpIENETiBFU01cbi8vIGltcG9ydHMgdGhlIGFwcCBsb2FkcyBzdHJhaWdodCBmcm9tIHRoZSBicm93c2VyOiBGaXJlYmFzZSdzIG1vZHVsYXIgU0RLXG4vLyBmcm9tIGdzdGF0aWMsIGFuZCBDaGFydC5qcyBmcm9tIGpzZGVsaXZyJ3MgK2VzbSBidWlsZC4gQnVuZGxpbmcgdGhlbSB3b3VsZFxuLy8gbWVhbiBlaXRoZXIgdmVuZG9yaW5nIGEgY29weSAoZHJpZnRzIGZyb20gdGhlIHBpbm5lZCBDRE4gdmVyc2lvbiwgZG91Ymxlc1xuLy8gYnVuZGxlIHNpemUpIG9yIGJyZWFraW5nIHRoZWlyIG93biBpbnRlcm5hbCBkeW5hbWljLWltcG9ydCBncmFwaHMuIEtlZXBpbmdcbi8vIHRoZW0gZXh0ZXJuYWwgbGVhdmVzIHRoZSBleGlzdGluZyBydW50aW1lIGJlaGF2aW9yIChhbmQgQ1NQKSB1bnRvdWNoZWQgLVxuLy8gUm9sbHVwIGVtaXRzIHRoZSBzYW1lIGJhcmUgYGltcG9ydCAuLi4gZnJvbSBcImh0dHBzOi8vLi4uYCBzcGVjaWZpZXIgYXMtaXMsXG4vLyBhbmQgdGhlIGJyb3dzZXIgcmVzb2x2ZXMgaXQgZXhhY3RseSBsaWtlIGl0IGRvZXMgdG9kYXkuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuY29uc3QgaXNFeHRlcm5hbFVybCA9IChpZCkgPT4gL15odHRwcz86XFwvXFwvLy50ZXN0KGlkKTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE9iZnVzY2F0aW9uIHBhc3MsIGFwcGxpZWQgdG8gb3VyIG93biBjb2RlIG9ubHkgKG5ldmVyIHRvIHRoZSB1bnRvdWNoZWRcbi8vIENETiBpbXBvcnRzIGFib3ZlLCBzaW5jZSB0aG9zZSBhcmVuJ3QgcGFydCBvZiB0aGUgYnVuZGxlKS4gUnVucyAqYWZ0ZXIqXG4vLyBlc2J1aWxkJ3MgbWluaWZpY2F0aW9uIGFzIGEgc2VwYXJhdGUgUm9sbHVwIG91dHB1dCBwYXNzLlxuLy9cbi8vIFNldHRpbmdzIGFyZSBkZWxpYmVyYXRlbHkgY29uc2VydmF0aXZlOlxuLy8gICAtIG5vIGBzZWxmRGVmZW5kaW5nYCAvIGBkZWJ1Z1Byb3RlY3Rpb25gIFx1MjAxNCBib3RoIHJlbHkgb24gZ2VuZXJhdGluZyBjb2RlXG4vLyAgICAgdGhhdCBydW5zIHRocm91Z2ggYEZ1bmN0aW9uKC4uLilgLCB3aGljaCBuZWVkcyAndW5zYWZlLWV2YWwnIGluIENTUFxuLy8gICAgIHNjcmlwdC1zcmMuIFRoaXMgYXBwJ3MgQ1NQIGludGVudGlvbmFsbHkgaGFzIG5vIHN1Y2ggYWxsb3dhbmNlIChzZWVcbi8vICAgICBuZXRsaWZ5LnRvbWwgLyBzZWN1cml0eS50cyksIHNvIGFueXRoaW5nIHJlcXVpcmluZyBpdCB3b3VsZCBqdXN0XG4vLyAgICAgdGhyb3cgYXQgcnVudGltZS5cbi8vICAgLSBgc3RyaW5nQXJyYXk6IHRydWVgIHdpdGggYSBydW50aW1lIHVucGFja2luZyBmdW5jdGlvbiBpcyBmaW5lIFx1MjAxNCBpdCdzXG4vLyAgICAgcGxhaW4gZ2VuZXJhdGVkIGNvZGUsIG5vIGV2YWwgaW52b2x2ZWQuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuZnVuY3Rpb24gb2JmdXNjYXRvclBsdWdpbigpIHtcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiBcIm9iZnVzY2F0ZS1jaHVua3NcIixcbiAgICAvLyBJTVBPUlRBTlQ6IHRoaXMgbXVzdCBydW4gaW4gZ2VuZXJhdGVCdW5kbGUsIG5vdCByZW5kZXJDaHVuay5cbiAgICAvL1xuICAgIC8vIFJvbGx1cCByZXNvbHZlcyBjcm9zcy1jaHVuayByZWZlcmVuY2VzIChlLmcuIHRoZSBmaWxlbmFtZSBpbnNpZGUgYVxuICAgIC8vIGR5bmFtaWMgYGltcG9ydChcIi4vcm91dGVyLTxoYXNoPi5qc1wiKWApIHZpYSBpbnRlcm5hbCBwbGFjZWhvbGRlclxuICAgIC8vIHRva2VucyBsaWtlIGAhfnswMDh9fmAgdGhhdCBnZXQgc3dhcHBlZCBmb3IgdGhlIHJlYWwgY29udGVudCBoYXNoIGluXG4gICAgLy8gYSBmaW5hbCBsaXRlcmFsIGZpbmQtYW5kLXJlcGxhY2UgcGFzcyBvdmVyIGVhY2ggY2h1bmsncyByZW5kZXJlZFxuICAgIC8vIGNvZGUgLSBhIHBhc3MgdGhhdCBydW5zICphZnRlciogZXZlcnkgcGx1Z2luJ3MgcmVuZGVyQ2h1bmsgaG9vaywgb25jZVxuICAgIC8vIGV2ZXJ5IGNodW5rJ3MgZmluYWwgaGFzaCBpcyBrbm93bi5cbiAgICAvL1xuICAgIC8vIFRoaXMgcGx1Z2luJ3Mgc3RyaW5nLWFycmF5IG9iZnVzY2F0aW9uIGZlYXR1cmUgZG9lc24ndCBrbm93IHRoYXRcbiAgICAvLyBjb252ZW50aW9uIC0gaXQgdHJlYXRzIGEgZHluYW1pYyBpbXBvcnQncyBzcGVjaWZpZXIgYXMganVzdCBhbm90aGVyXG4gICAgLy8gc3RyaW5nIGxpdGVyYWwgdG8gc3dlZXAgaW50byBpdHMgZW5jb2RlZC9yb3RhdGVkIHN0cmluZyBhcnJheS4gRG9pbmdcbiAgICAvLyB0aGF0IGluIHJlbmRlckNodW5rIG1lYW50IHRoZSBsaXRlcmFsIGAhfnswMDh9fmAgdGV4dCBnb3QgZW5jb2RlZFxuICAgIC8vIGludG8gdGhlIGFycmF5ICpiZWZvcmUqIFJvbGx1cCdzIHBsYWNlaG9sZGVyIHBhc3MgcmFuLCBzbyB0aGVcbiAgICAvLyBwbGFjZWhvbGRlciB0ZXh0IFJvbGx1cCB3YXMgc2VhcmNoaW5nIGZvciBubyBsb25nZXIgZXhpc3RlZCBhbnl3aGVyZVxuICAgIC8vIGluIHRoZSBjaHVuayB2ZXJiYXRpbSAtIGl0IHNpbGVudGx5IGZhaWxlZCB0byBzdWJzdGl0dXRlLCBhbmQgdGhlXG4gICAgLy8gdW5yZXNvbHZlZCBwbGFjZWhvbGRlciBzaGlwcGVkIHN0cmFpZ2h0IHRvIHByb2R1Y3Rpb24sIGJyZWFraW5nXG4gICAgLy8gZXZlcnkgZHluYW1pY2FsbHktaW1wb3J0ZWQgY2h1bmsgKGF1dGguc2VydmljZS5qcywgcm91dGVyLmpzLCBldGMuKVxuICAgIC8vIHdpdGggYSA0MDQuXG4gICAgLy9cbiAgICAvLyBnZW5lcmF0ZUJ1bmRsZSBydW5zIGFmdGVyIHRoYXQgc3Vic3RpdHV0aW9uLCBzbyBieSB0aGUgdGltZSB0aGlzXG4gICAgLy8gaG9vayBzZWVzIHRoZSBjb2RlLCBldmVyeSBpbXBvcnQgc3BlY2lmaWVyIC0gc3RhdGljIG9yIGR5bmFtaWMgLSBpc1xuICAgIC8vIGFscmVhZHkgdGhlIHJlYWwgZmluYWwgZmlsZW5hbWUsIGFuZCBvYmZ1c2NhdGluZyBpdCBpcyBzYWZlLlxuICAgIGdlbmVyYXRlQnVuZGxlKF9vcHRpb25zLCBidW5kbGUpIHtcbiAgICAgIGZvciAoY29uc3QgZmlsZU5hbWUgb2YgT2JqZWN0LmtleXMoYnVuZGxlKSkge1xuICAgICAgICBjb25zdCBhc3NldCA9IGJ1bmRsZVtmaWxlTmFtZV07XG4gICAgICAgIGlmIChhc3NldC50eXBlICE9PSBcImNodW5rXCIgfHwgIWZpbGVOYW1lLmVuZHNXaXRoKFwiLmpzXCIpKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gSmF2YVNjcmlwdE9iZnVzY2F0b3Iub2JmdXNjYXRlKGFzc2V0LmNvZGUsIHtcbiAgICAgICAgICBjb21wYWN0OiB0cnVlLFxuICAgICAgICAgIGNvbnRyb2xGbG93RmxhdHRlbmluZzogZmFsc2UsXG4gICAgICAgICAgZGVhZENvZGVJbmplY3Rpb246IGZhbHNlLFxuICAgICAgICAgIHN0cmluZ0FycmF5OiB0cnVlLFxuICAgICAgICAgIHN0cmluZ0FycmF5RW5jb2Rpbmc6IFtcImJhc2U2NFwiXSxcbiAgICAgICAgICBzdHJpbmdBcnJheVRocmVzaG9sZDogMC43NSxcbiAgICAgICAgICByb3RhdGVTdHJpbmdBcnJheTogdHJ1ZSxcbiAgICAgICAgICBzaHVmZmxlU3RyaW5nQXJyYXk6IHRydWUsXG4gICAgICAgICAgc3BsaXRTdHJpbmdzOiB0cnVlLFxuICAgICAgICAgIHNlbGZEZWZlbmRpbmc6IGZhbHNlLCAvLyBuZWVkcyAndW5zYWZlLWV2YWwnIFx1MjAxNCBDU1AgZG9lc24ndCBhbGxvdyBpdFxuICAgICAgICAgIGRlYnVnUHJvdGVjdGlvbjogZmFsc2UsIC8vIHNhbWUgcmVhc29uXG4gICAgICAgICAgZGlzYWJsZUNvbnNvbGVPdXRwdXQ6IGZhbHNlLCAvLyBhcHAgcmVsaWVzIG9uIGNvbnNvbGUgZm9yIGl0cyBvd24gZXJyb3IvYXVkaXQgcGF0aHNcbiAgICAgICAgICBudW1iZXJzVG9FeHByZXNzaW9uczogdHJ1ZSxcbiAgICAgICAgICBzaW1wbGlmeTogdHJ1ZSxcbiAgICAgICAgICBpZGVudGlmaWVyTmFtZXNHZW5lcmF0b3I6IFwiaGV4YWRlY2ltYWxcIixcbiAgICAgICAgICByZW5hbWVHbG9iYWxzOiBmYWxzZSxcbiAgICAgICAgICB0YXJnZXQ6IFwiYnJvd3NlclwiLFxuICAgICAgICB9KTtcbiAgICAgICAgYXNzZXQuY29kZSA9IHJlc3VsdC5nZXRPYmZ1c2NhdGVkQ29kZSgpO1xuICAgICAgfVxuICAgIH0sXG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHtcbiAgcm9vdCxcbiAgcHVibGljRGlyOiBcInB1YmxpY1wiLFxuICBidWlsZDoge1xuICAgIG91dERpcjogXCJkaXN0XCIsXG4gICAgZW1wdHlPdXREaXI6IHRydWUsXG4gICAgLy8gYXBwLmpzIHVzZXMgdG9wLWxldmVsIGF3YWl0LCB3aGljaCBuZWVkcyBFUzIwMjIrLiBUaGUgRmlyZWJhc2UgdjEwXG4gICAgLy8gbW9kdWxhciBTREsgYW5kIENoYXJ0LmpzIChsb2FkZWQgZXh0ZXJuYWxseSwgc2VlIGJlbG93KSBhbHJlYWR5XG4gICAgLy8gcmVxdWlyZSBhIG1vZGVybiBldmVyZ3JlZW4gYnJvd3Nlciwgc28gdGhpcyBkb2Vzbid0IGRyb3Agc3VwcG9ydCBmb3JcbiAgICAvLyBhbnl0aGluZyB0aGUgYXBwIGRpZG4ndCBhbHJlYWR5IHJlcXVpcmUuXG4gICAgdGFyZ2V0OiBcImVzMjAyMlwiLFxuICAgIC8vIFRoZSBDU1Agbm9uY2UgZWRnZSBmdW5jdGlvbiAobmV0bGlmeS9lZGdlLWZ1bmN0aW9ucy9zZWN1cml0eS50cykgb25seVxuICAgIC8vIHN0YW1wcyBub25jZT1cIi4uLlwiIG9udG8gPHNjcmlwdD4gdGFncy4gPGxpbmsgcmVsPVwibW9kdWxlcHJlbG9hZFwiPlxuICAgIC8vIHRhZ3MgYXJlbid0IDxzY3JpcHQ+IHRhZ3MsIGFuZCBicm93c2VyIGVuZm9yY2VtZW50IG9mIHNjcmlwdC1zcmNcbiAgICAvLyBhZ2FpbnN0IG1vZHVsZXByZWxvYWQgZmV0Y2hlcyBpcyBpbmNvbnNpc3RlbnQgLSBzbyBsZWF2aW5nIFZpdGUnc1xuICAgIC8vIGRlZmF1bHQgbW9kdWxlcHJlbG9hZCBpbmplY3Rpb24gb24gd291bGQgcmlzayB0aG9zZSBwcmVsb2FkcyBiZWluZ1xuICAgIC8vIHNpbGVudGx5IGJsb2NrZWQgKG9yIHNpbGVudGx5IGFsbG93ZWQsIGJyb3dzZXItZGVwZW5kZW50bHkpIHVuZGVyXG4gICAgLy8gdGhpcyBDU1AuIFR1cm5pbmcgaXQgb2ZmIG1lYW5zIHRoZSBtb2R1bGUgZ3JhcGggaXMgaW5zdGVhZCByZXNvbHZlZFxuICAgIC8vIHB1cmVseSB0aHJvdWdoIHRoZSBkeW5hbWljIGBpbXBvcnQoKWAgY2hhaW4gYWxyZWFkeSBpbiBhcHAuanMvXG4gICAgLy8gcm91dGVyLmpzIC0gaW1wb3J0cyB0cmlnZ2VyZWQgZnJvbSBhbiBhbHJlYWR5IG5vbmNlLXBlcm1pdHRlZCBzY3JpcHRcbiAgICAvLyBhcmUgdHJ1c3RlZCB0cmFuc2l0aXZlbHkgYW5kIGRvbid0IG5lZWQgdGhlaXIgb3duIG5vbmNlLCB3aGljaCBpc1xuICAgIC8vIGV4YWN0bHkgd2hhdCB0aGlzIGFwcCBhbHJlYWR5IHJlbGllcyBvbiB0b2RheS4gU2xpZ2h0bHkgbGVzc1xuICAgIC8vIGVhZ2VyIHByZWZldGNoaW5nLCB6ZXJvIENTUCBhbWJpZ3VpdHkuXG4gICAgbW9kdWxlUHJlbG9hZDogZmFsc2UsXG4gICAgYXNzZXRzSW5saW5lTGltaXQ6IDAsIC8vIGtlZXAgZXZlcnkgYXNzZXQgYXMgYSByZWFsIGZpbGUgKHByZWRpY3RhYmxlIHBhdGhzLCBubyBzdXJwcmlzZSBpbmxpbmluZylcbiAgICBzb3VyY2VtYXA6IGZhbHNlLCAvLyBubyBzb3VyY2VtYXBzIGluIGEgYnVpbGQgbWVhbnQgdG8gb2JmdXNjYXRlIHRoZSBvdXRwdXRcbiAgICBtaW5pZnk6IFwiZXNidWlsZFwiLFxuICAgIGNzc01pbmlmeTogdHJ1ZSxcbiAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICBpbnB1dDoge1xuICAgICAgICBsYW5kaW5nOiByZXNvbHZlKHJvb3QsIFwiaW5kZXguaHRtbFwiKSxcbiAgICAgICAgYXBwOiByZXNvbHZlKHJvb3QsIFwiYXBwL2luZGV4Lmh0bWxcIiksXG4gICAgICAgIGRhdGFQcm90ZWN0aW9uOiByZXNvbHZlKHJvb3QsIFwiZGF0YS1wcm90ZWN0aW9uLmh0bWxcIiksXG4gICAgICAgIHRlcm1zOiByZXNvbHZlKHJvb3QsIFwidGVybXMtb2Ytc2VydmljZS5odG1sXCIpLFxuICAgICAgfSxcbiAgICAgIGV4dGVybmFsOiBpc0V4dGVybmFsVXJsLFxuICAgICAgb3V0cHV0OiB7XG4gICAgICAgIC8vIFN0YWJsZSwgaGFzaGVkLCBjb250ZW50LWFkZHJlc3NlZCBmaWxlbmFtZXMgdW5kZXIgL2Fzc2V0cy8gc28gdGhlXG4gICAgICAgIC8vIGxvbmctY2FjaGUgaGVhZGVyIHJ1bGUgaW4gbmV0bGlmeS50b21sIGNhbiB0YXJnZXQgdGhlbSBzYWZlbHkuXG4gICAgICAgIGVudHJ5RmlsZU5hbWVzOiBcImFzc2V0cy9bbmFtZV0tW2hhc2hdLmpzXCIsXG4gICAgICAgIGNodW5rRmlsZU5hbWVzOiBcImFzc2V0cy9bbmFtZV0tW2hhc2hdLmpzXCIsXG4gICAgICAgIGFzc2V0RmlsZU5hbWVzOiBcImFzc2V0cy9bbmFtZV0tW2hhc2hdW2V4dG5hbWVdXCIsXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIHBsdWdpbnM6IFtvYmZ1c2NhdG9yUGx1Z2luKCldLFxufTsiXSwKICAibWFwcGluZ3Mi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
