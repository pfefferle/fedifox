# Wire examples

Exact requests FediFox sends to the actor's outbox, one file per action,
generated from the real client code with a stub `fetch` (only the outbox URL,
the target object and the token are placeholders). Regenerate after changing
`src/client/activities.js` or `src/actions.js`.
