/// <reference types="vite/client" />

/** package.json version, injected by vite.config.ts `define`. */
declare const __APP_VERSION__: string;

/** Changes with every build; versions the translation URLs so no cache serves stale ones. */
declare const __BUILD_ID__: string;
