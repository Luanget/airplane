// For GitHub Pages set this to the public HTTPS Worker URL (no credentials).
// Local preview uses Wrangler on loopback. A same-origin route needs no change.
export const ENDPOINT = ['localhost','127.0.0.1'].includes(location.hostname)
  ? 'http://127.0.0.1:8787/api/assist' : '/api/assist';
