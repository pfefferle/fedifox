# FediFox

Firefox add-on (Manifest V3) that lets you like, share, follow, reply to and mention the
ActivityPub object or actor behind the page you are looking at — from your
own fediverse account, using only the standard
[ActivityPub client-to-server API](https://www.w3.org/TR/activitypub/#client-to-server-interactions)
and OAuth 2.0. No Mastodon API.

It is a reference implementation for the
[ActivityPub API](https://github.com/swicg/activitypub-api) OAuth profile and
for [ActivityPub HTML Discovery](https://swicg.github.io/activitypub-html-discovery/),
and a sibling of the Social Web Foundation's
[activitypub-browser-extension](https://github.com/social-web-foundation/activitypub-browser-extension).

## Requirements on the server

- An actor with `outbox`, `liked`, `following`, `followers`.
- OAuth 2.0 authorization-code + PKCE, discovered via the actor's
  `endpoints.oauthAuthorizationEndpoint` / `oauthTokenEndpoint` or RFC 8414.
- Client registration via CIMD, RFC 7591 dynamic registration, or a manually
  issued client ID.
- Optional: `endpoints.proxyUrl` for reading remote objects with
  authorization.

The [WordPress ActivityPub plugin](https://github.com/Automattic/wordpress-activitypub)
implements all of the above and is the primary test bench.

## Development

    npm install
    npm run vendor   # copies oauth4webapi into src/vendor
    npm test
    npm start        # web-ext run

See `docs/architecture.md` and `docs/testing.md`.

## Publishing

`client.json` is a [CIMD](https://github.com/swicg/activitypub-api) client
identity document. Its `redirect_uris` entry is a placeholder until the
add-on has run once — Firefox derives the actual redirect URL from the
add-on's own id (`browser_specific_settings.gecko.id` in `manifest.json`),
which isn't known outside of a running instance. To publish for real:

1. Run the add-on once (`npm start`) and read
   `browser.identity.getRedirectURL()` from the background console.
2. Put that value into `client.json`'s `redirect_uris`.
3. Publish `client.json` via GitHub Pages.
4. Set `CIMD_URL` in `src/constants.js` to its published URL.

Until `CIMD_URL` is set, fedifox falls back to RFC 7591 dynamic client
registration, then to a manually entered client ID.

## Logo

The icons are the Fediverse symbol ⁂ (three asterisks, U+2042), taken from
the WordPress ActivityPub plugin's SVG. The toolbar symbol is theme-tinted
while a page has no ActivityPub object and coloured when it does; on such
pages the symbol also appears in the address bar.
