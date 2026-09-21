# fedifox — Architecture

## Architecture

Three runtime contexts, all vanilla ESM.

```
content script (every page, document_idle)
  discovery/html.js  parses <link rel=alternate type=application/activity+json>
                     and rel=me links → {url, objectCandidates, actorCandidates}
        │ runtime.sendMessage
        ▼
background (MV3 event page, type: module)
  discovery/resolver.js   merges HTML links, HTTP Link header
                          (webRequest.onHeadersReceived), conneg fallback;
                          fetches + classifies the resource; caches per tab
  auth/discovery.js       OAuth endpoint discovery precedence
  auth/client-identity.js CIMD → RFC 7591 → manual
  auth/session.js         PKCE flow via identity.launchWebAuthFlow, refresh,
                          revoke
  client/activitypub.js   outbox POST, collection paging, proxy fetch,
                          conneg fetch
  client/activities.js    pure builders: like/announce/follow/undo/create-note
  state/storage.js        storage.local wrapper (accounts, client creds,
                          action cache, discovery cache)
  actions.js              orchestration of user actions; badge; context menu
        │ runtime.sendMessage
        ▼
popup
  login form (handle or actor URL, "Advanced" client id/secret)
  account switcher (multi-account from day one)
  resource card (object or actor) with action buttons + reply/mention textarea
  status line with human-readable errors and a "details" disclosure
```

### Message protocol (background ↔ popup / content)

All messages are `{type, ...payload}` objects over `runtime.sendMessage`;
the background is the only holder of state.

- `page:discovered` (content → bg): `{url, objectCandidates[], actorCandidates[]}`
- `tab:resource` (popup → bg): returns the cached `Resource` for the active tab
- `auth:login` `{handle | actorUrl, clientId?, clientSecret?}` → `Account`
- `auth:logout` `{actorId}`
- `accounts:list`, `accounts:select` `{actorId}`
- `action:like|undoLike|share|undoShare|follow|undoFollow|reply|mention` → result
- `action:state` `{resourceId}` → `{liked, shared, following, followingAuthor}`

### Data model (plain objects in `storage.local`)

```
Account        {actorId, handle, name, inbox, outbox, liked, following, followers,
                proxyUrl?, asOrigin, accessToken, refreshToken?, expiresAt?,
                needsReauth: bool}
ClientCreds    keyed by asOrigin: {clientId, clientSecret?, source: 'cimd'|'dcr'|'manual'}
Resource       {id, kind: 'actor'|'object', type, name?, summary?, url,
                attributedTo?: {id, name, handle}, audience: {to[], cc[]}}
ActionRecord   keyed by `${actorId} ${activityType} ${objectId}`: {activityId, at}
DiscoveryCache keyed by page URL: {resource, at}  (TTL 10 min)
```


## Login & auth flow

1. Input: handle `user@domain` **or** an `https://` actor URL.
2. Handle → WebFinger `GET https://domain/.well-known/webfinger?resource=acct:…`
   → `links[rel="self"][type~=activity+json].href`.
3. Fetch actor with `Accept: application/activity+json, application/ld+json;
   profile="https://www.w3.org/ns/activitystreams"`.
4. **Endpoint discovery** (`auth/discovery.js`), first hit wins:
   1. `actor.endpoints.oauthAuthorizationEndpoint` + `oauthTokenEndpoint`
      (ActivityPub §4.1). If present, also try RFC 8414 on the token
      endpoint's origin to pick up `registration_endpoint`,
      `revocation_endpoint`, `code_challenge_methods_supported`.
   2. RFC 8414 `GET {actorOrigin}/.well-known/oauth-authorization-server`.
   3. On a later `401` with `WWW-Authenticate: … resource_metadata="…"`,
      RFC 9728 → `authorization_servers[0]` → RFC 8414.
   4. Otherwise fail with "server does not advertise an OAuth endpoint".
5. **Client identity** (`auth/client-identity.js`), cached per `asOrigin`,
   first hit wins:
   1. CIMD: `client_id = CIMD_URL` (constant; `null` in dev builds until the
      document is hosted). Used only if the metadata does not explicitly say
      otherwise; on `invalid_client` fall through.
   2. RFC 7591 `POST registration_endpoint` with
      `{client_name, redirect_uris:[redirect], grant_types:
      ["authorization_code","refresh_token"], response_types:["code"],
      token_endpoint_auth_method:"none", client_uri, software_id,
      software_version}`. Store `client_id` (+ `client_secret` if issued).
   3. Manual `client_id` / `client_secret` from the login form.
6. Authorization: `browser.identity.launchWebAuthFlow({interactive: true,
   url})` with `response_type=code`, PKCE S256, random `state`,
   `scope = "read write"` (constant), `redirect_uri =
   browser.identity.getRedirectURL()` — stable because
   `browser_specific_settings.gecko.id` is pinned.
7. Token exchange with `oauth4webapi` (`token_endpoint_auth_method` `none`,
   or `client_secret_post` when a secret exists). Store `Account`.
8. Refresh: before any request, if `expiresAt` is within 60 s, refresh; on
   `401` refresh once and retry; if refresh fails set `needsReauth` and
   disable actions for that account in the popup.
9. Logout: `POST revocation_endpoint` when advertised (best effort), then
   delete the `Account`. Client creds stay cached.


## Discovery

Per top-level navigation, first result wins, in cost order:

1. **HTML** (content script): every `<link rel="alternate">` whose `type` is
   `application/activity+json` or `application/ld+json` with the AS2 profile
   → object candidate. `<link rel="me">` / `<a rel="me">` hrefs → actor
   candidates (lowest priority; only used if nothing else resolves and the
   href resolves to an actor).
2. **HTTP `Link` header** (background, `webRequest.onHeadersReceived`,
   `types: ["main_frame"]`): `rel="alternate"` with the same media types.
3. **Content negotiation**: `GET pageUrl` with the AP `Accept` header; accept
   the body only if `Content-Type` is an AP media type and the JSON has an
   `id` and `type`.

Fetching a candidate goes through the selected account's `proxyUrl`
(`POST`, form-encoded `id=`) when present, else a direct fetch. Classification:
`type ∈ {Person, Group, Organization, Service, Application}` → `kind: actor`;
anything else with an `id` → `kind: object`; `attributedTo` (string or object)
is resolved to `{id, name, handle}` for the author actions, with `handle`
derived from `preferredUsername@host` when no WebFinger reverse lookup is
attempted.

Results are cached per page URL (10 min) and per tab; the toolbar badge shows
`AP` when a resource exists for the active tab and is cleared on navigation.


## Actions

Every action is an AS2 activity `POST`ed to the account's `outbox` with
`Content-Type: application/ld+json; profile="https://www.w3.org/ns/activitystreams"`
and `Authorization: Bearer …`. The server assigns the activity `id`; fedifox
reads it from the `Location` header, else from the response body `id`, and
stores an `ActionRecord` so `Undo` can reference it.

| Action | Activity (`@context` = AS2) | `to` | `cc` |
|---|---|---|---|
| Like | `{type: Like, object: objectId}` | author | `as:Public` |
| Undo like | `{type: Undo, object: likeActivityId}` | author | `as:Public` |
| Share | `{type: Announce, object: objectId}` | author | `as:Public`, own followers |
| Undo share | `{type: Undo, object: announceActivityId}` | same | same |
| Follow | `{type: Follow, object: actorId}` | actor | — |
| Undo follow | `{type: Undo, object: followActivityId}` | actor | — |
| Reply | `{type: Create, object: {type: Note, inReplyTo: objectId, content, tag: [Mention]}}` | author | `as:Public` (+ parent's `to`/`cc` when readable) |
| Mention | `{type: Create, object: {type: Note, content, tag: [Mention]}}` | actor | `as:Public` |
| Copy link | clipboard ← `resource.id` | — | — |

`content` is HTML: the user's text escaped, with the leading mention rendered
as `<a href="{actorId}">@{handle}</a>`; the `Mention` tag carries
`{type: Mention, href: actorId, name: "@user@host"}`.

### State ("did I already…")

- `liked` and `following` are read from the account's actor collections,
  walking `first` → `next` for at most 5 pages, matching on `id` (items may be
  URIs or embedded objects). Result merged with `ActionRecord`s; a local
  record wins when the collection scan is inconclusive (page limit hit).
- `shared` comes from `ActionRecord`s only; scanning the outbox for Announces
  is not attempted in v1.
- State is fetched lazily when the popup opens, per resource, and cached in
  memory for the popup's lifetime.


## Use cases

Numbers refer to issues in the SWF repo.

| # | Use case | Card |
|---|---|---|
| 13, 14 | Log into / out of ActivityPub API server | — |
| 2 | Discover ActivityPub resource on current page | — |
| 3, 4, 5 | See liked state / like / undo like object | object |
| 10, 7, 11 | See shared state / share / undo share object | object |
| 9, 8, 12 | See follow state / follow / undo follow actor on profile page | actor |
| 22, 20, 23 | Same for the author (`attributedTo`) of the object | object |
| 19 | Reply to object | object |
| 18, 21 | Mention actor / author | actor, object |
| 17 | Copy fediverse link (the AP `id`) | both |
| 15, 16 | "Open in …" | replaced by copy-link; no home-server web UI is assumed |


## Module map

| File | Responsibility |
|---|---|
| `manifest.json` | MV3 manifest, permissions, add-on id |
| `package.json`, `eslint.config.js`, `scripts/vendor.js` | tooling |
| `src/constants.js` | media types, AS2 IRIs, OAuth constants, limits |
| `src/errors.js` | `FedifoxError` + `describeError()` |
| `src/state/storage.js` | `createStore(area)` — typed accessors over `browser.storage.local` |
| `src/client/activities.js` | pure AS2 activity builders + HTML content rendering |
| `src/client/activitypub.js` | `createClient()` — AP fetch, proxy fetch, outbox POST, collection walk, WebFinger |
| `src/auth/discovery.js` | OAuth endpoint discovery (actor endpoints → RFC 8414 → RFC 9728) |
| `src/auth/client-identity.js` | CIMD → RFC 7591 → manual client credentials |
| `src/auth/session.js` | login/refresh/logout using `oauth4webapi` + `browser.identity` |
| `src/discovery/html.js` | pure candidate extraction from `<link>`/`<a>` data |
| `src/discovery/resolver.js` | Link-header parsing, candidate ordering, fetch + classify → `Resource` |
| `src/actions.js` | `createActions()` — state checks and user actions with ActionRecords |
| `src/messages.js` | `createRouter()` — message router wiring background state to popup/content requests |
| `src/content.js` | DOM → `page:discovered` message |
| `src/background.js` | wiring: message router, webRequest header capture, badge, context menus |
| `src/popup/popup.html`, `popup.js`, `popup.css`, `render.js` | UI |
| `test/helpers/fetch-stub.js`, `test/helpers/storage-stub.js` | test doubles |
| `test/*.test.js` | one per module |
| `docs/architecture.md`, `docs/testing.md`, `README.md`, `client.json` | docs, CIMD document |
