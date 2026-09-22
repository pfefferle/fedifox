// URL helpers that never throw: error messages and origin checks must not
// fail on a malformed input coming from a remote document.
export function hostOf (url) {
  try { return new URL(url).host } catch { return url }
}

export function originOf (url) {
  try {
    const origin = new URL(url).origin
    return origin === 'null' ? null : origin
  } catch { return null }
}
