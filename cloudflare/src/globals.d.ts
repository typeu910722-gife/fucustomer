// shared/room.ts reads `globalThis.crypto` (it also runs in browsers and Node). @cloudflare/workers-types declares
// `crypto` with `declare const`, which TypeScript does not expose on `typeof globalThis`; this restores it for typing.
// The Workers runtime does provide globalThis.crypto.
declare var crypto: Crypto;
