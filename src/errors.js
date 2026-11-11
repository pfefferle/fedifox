export class FedifoxError extends Error {
  constructor (message, { step, status, detail, cause } = {}) {
    super(message, { cause })
    this.name = 'FedifoxError'
    this.step = step
    this.status = status
    this.detail = detail
  }
}

// Shape sent to the popup; never leaks stack traces.
export function describeError (err) {
  if (err instanceof FedifoxError) {
    return { message: err.message, step: err.step, status: err.status, detail: err.detail }
  }
  return { message: err?.message || String(err), step: undefined, status: undefined, detail: err?.name }
}
