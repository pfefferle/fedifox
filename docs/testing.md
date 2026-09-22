# Manual test checklist

Prerequisites: `npm start` in this repo; a WordPress site with the ActivityPub
plugin (`cd ../wordpress-activitypub && wp-env start`, user `admin`, actor
`admin@localhost:8888` — add `allowInsecure: true` to the `createSession({...})`
call in `src/background.js` while testing over http).

## Login
- [ ] Enter `admin@localhost:8888` → WordPress authorization page opens → approve → popup shows the account.
- [ ] Enter an actor URL instead of a handle → same result.
- [ ] Cancel the authorization window → popup shows "was cancelled or failed", no account stored.
- [ ] Enter a host without OAuth (e.g. `example.org`) → "does not advertise an OAuth endpoint".
- [ ] Log out → account gone; log in again → no new client registration (check `storage.local.clientCreds`).

## Discovery
- [ ] Open a WP post → badge `AP`, card shows type + author.
- [ ] Open a WP author page → card shows actor with Follow/Mention.
- [ ] Open a Mastodon status page → discovered via `<link rel="alternate">`.
- [ ] Open a page with only a `Link` header (curl -I to confirm) → discovered.
- [ ] Open a non-fediverse page → "No ActivityPub object found".

## Actions (each: check the WP admin / the target's collections)
- [ ] Like → appears in `…/liked`; button turns to Unlike; Unlike → removed.
- [ ] Share → Announce visible in outbox; Unshare → Undo in outbox.
- [ ] Follow author → appears in `…/following`; Unfollow → removed.
- [ ] Reply → Create/Note with `inReplyTo` and Mention tag in outbox.
- [ ] Mention actor → Create/Note addressed to the actor.
- [ ] Copy fediverse link → clipboard holds the AP `id`.
- [ ] Context menu Like/Share on a discovered page → same as popup.

## Tokens
- [ ] Set `expiresAt` to now in `storage.local` → next action refreshes silently.
- [ ] Invalidate the refresh token server-side → popup shows "(login required)" and disables actions.
