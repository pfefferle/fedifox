# Test links

Every link form FediFox reacts to, with real targets. While an account is
logged in, clicking one opens the toolbar popup over the page with the card of
the link's target; a link that names an action offers only that button, and
one click on it runs the action.

The `web+…` schemes are also registered protocols: from the address bar, from
other applications or while logged out, Firefox opens the popup as a page.
`acct:` and `fedi:` cannot be registered in Firefox and only work as clicks
while logged in.

Targets: the actor `https://notiz.blog/author/matthias-pfefferle/`
(`pfefferle@notiz.blog`) and the post `https://notiz.blog/?p=60600`.

## Open only

| Link | Expected |
|---|---|
| [web+ap://notiz.blog/author/matthias-pfefferle/](web+ap://notiz.blog/author/matthias-pfefferle/) | Actor card, all buttons |
| [web+ap://notiz.blog/?p=60600](web+ap://notiz.blog/?p=60600) | Post card, all buttons |
| [web+activitypub:notiz.blog/author/matthias-pfefferle/](web+activitypub:notiz.blog/author/matthias-pfefferle/) | Actor card, all buttons |
| [acct:pfefferle@notiz.blog](acct:pfefferle@notiz.blog) | Actor card, all buttons |
| [fedi://pfefferle@notiz.blog/](fedi://pfefferle@notiz.blog/) | Actor card, all buttons |

## Follow

| Link | Expected |
|---|---|
| [web+activitypub:notiz.blog/author/matthias-pfefferle/?intent=follow](web+activitypub:notiz.blog/author/matthias-pfefferle/?intent=follow) | Actor card, only **Follow** |
| [web+activitypub:Follow?object=https%3A%2F%2Fnotiz.blog%2Fauthor%2Fmatthias-pfefferle%2F](web+activitypub:Follow?object=https%3A%2F%2Fnotiz.blog%2Fauthor%2Fmatthias-pfefferle%2F) | Actor card, only **Follow** |
| [web+activitypub:Follow?object=acct%3Apfefferle%40notiz.blog](web+activitypub:Follow?object=acct%3Apfefferle%40notiz.blog) | Actor card, only **Follow** |
| [web+follow:https%3A%2F%2Fnotiz.blog%2Fauthor%2Fmatthias-pfefferle%2F](web+follow:https%3A%2F%2Fnotiz.blog%2Fauthor%2Fmatthias-pfefferle%2F) | Actor card, only **Follow** |
| [web+follow:https://notiz.blog/author/matthias-pfefferle/](web+follow:https://notiz.blog/author/matthias-pfefferle/) | Actor card, only **Follow** |
| [web+follow:acct:pfefferle@notiz.blog](web+follow:acct:pfefferle@notiz.blog) | Actor card, only **Follow** |
| [web+follow:https://notiz.blog/?p=60600](web+follow:https://notiz.blog/?p=60600) | Post card, only **Follow @author** |

## Like

| Link | Expected |
|---|---|
| [web+activitypub:notiz.blog/?p=60600&intent=like](web+activitypub:notiz.blog/?p=60600&intent=like) | Post card, only **Like** |
| [web+activitypub:Like?object=https%3A%2F%2Fnotiz.blog%2F%3Fp%3D60600](web+activitypub:Like?object=https%3A%2F%2Fnotiz.blog%2F%3Fp%3D60600) | Post card, only **Like** |
| [web+like:https%3A%2F%2Fnotiz.blog%2F%3Fp%3D60600](web+like:https%3A%2F%2Fnotiz.blog%2F%3Fp%3D60600) | Post card, only **Like** |
| [web+like:https://notiz.blog/author/matthias-pfefferle/](web+like:https://notiz.blog/author/matthias-pfefferle/) | Actor card, all buttons (an actor cannot be liked) |

## Share

| Link | Expected |
|---|---|
| [web+activitypub:notiz.blog/?p=60600&intent=announce](web+activitypub:notiz.blog/?p=60600&intent=announce) | Post card, only **Share** |
| [web+activitypub:Announce?object=https%3A%2F%2Fnotiz.blog%2F%3Fp%3D60600](web+activitypub:Announce?object=https%3A%2F%2Fnotiz.blog%2F%3Fp%3D60600) | Post card, only **Share** |
| [web+share:https%3A%2F%2Fnotiz.blog%2F%3Fp%3D60600](web+share:https%3A%2F%2Fnotiz.blog%2F%3Fp%3D60600) | Post card, only **Share** |

## Reply

| Link | Expected |
|---|---|
| [web+activitypub:notiz.blog/?p=60600&intent=create](web+activitypub:notiz.blog/?p=60600&intent=create) | Post card, only **Reply**, compose box open |
| [web+activitypub:Create?inReplyTo=https%3A%2F%2Fnotiz.blog%2F%3Fp%3D60600](web+activitypub:Create?inReplyTo=https%3A%2F%2Fnotiz.blog%2F%3Fp%3D60600) | Post card, only **Reply**, compose box open |

## Already done

Like the post first, then open a like link again.

| Link | Expected |
|---|---|
| [web+like:https://notiz.blog/?p=60600](web+like:https://notiz.blog/?p=60600) | Post card with **Unlike**, all buttons (a link never undoes) |

## Activity dropped, object still opens

| Link | Expected |
|---|---|
| [web+activitypub:notiz.blog/?p=60600&intent=block](web+activitypub:notiz.blog/?p=60600&intent=block) | Post card, all buttons |
| [web+activitypub:notiz.blog/?p=60600&intent=delete](web+activitypub:notiz.blog/?p=60600&intent=delete) | Post card, all buttons |
| [web+activitypub:Flag?object=https%3A%2F%2Fnotiz.blog%2F%3Fp%3D60600](web+activitypub:Flag?object=https%3A%2F%2Fnotiz.blog%2F%3Fp%3D60600) | Post card, all buttons |
| [web+activitypub:Undo?object=https%3A%2F%2Fnotiz.blog%2F%3Fp%3D60600](web+activitypub:Undo?object=https%3A%2F%2Fnotiz.blog%2F%3Fp%3D60600) | Post card, all buttons |

## Rejected

| Link | Expected |
|---|---|
| [web+follow:javascript:alert(1)](web+follow:javascript:alert(1)) | "This link does not lead to a fediverse address" |
| [web+like:file:///etc/passwd](web+like:file:///etc/passwd) | Same error |
| [web+activitypub:Create?content=hello](web+activitypub:Create?content=hello) | Same error (a new post has no object to show) |
| [web+ap://example.com/](web+ap://example.com/) | "example.com has no ActivityPub object at this address" |
| [acct:nobody@example.com](acct:nobody@example.com) | WebFinger error for example.com |
| [fedi://pfefferle@notiz.blog/111506589124254741](fedi://pfefferle@notiz.blog/111506589124254741) | Nothing opens (a post id cannot be resolved) |
| [fedi://hashtag/fediverse](fedi://hashtag/fediverse) | Nothing opens |

## Not handled

`ap://did:key:…` (FEP-ef61) needs a gateway that a bare link does not name,
and `web+acct`, `web+fedi`, `web+subscribe` and `web+mastodon` are not
registered.
