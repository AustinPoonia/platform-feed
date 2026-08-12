# platform-feed

The `platform:feed` capability: what it promises, how it is implemented over the
runtime's cores, and the suite that drives the second against the first.

A feed is **say something** — this device's append-only log for one artifact, plus
every other member's, merged in an order every member computes identically. Its
sibling `platform-blobs` is **hold something**. Small facts go in the feed, bulk
goes in blobs, and the feed carries the hash: a log everyone replicates in full has
to stay small, and content nobody asked for should not be pushed at them.

```js
const { DECLARATION, feed } = require('platform-feed')

const instance = feed(peer, '@feed:send', 'send')   // the kernel does this, not you
await instance.methods.append({ type: 'offer', key })
await instance.methods.entries()                    // every member's, in (seq, device) order
```

## Why this is a repository

`ROADMAP.md` Phase 6a, and the rule
`ArtifactPatform/scripts/all-repos.sh --check-doors` enforces: **the kernel wires
capabilities; it does not implement them.** Six capabilities the runtime supplies
had their declarations in one file in `artifact-protocol` and their
implementations spread over four files in the kernel, no two sharing a boundary.
So a capability was two documents in two repositories with nothing holding them
together, and the only thing proving either was the kernel's own suite — which
means an operation no shipped artifact happened to call was checked against its
declared shape nowhere at all.

This repo and [`platform-blobs`](https://github.com/AustinPoonia/platform-blobs)
are the first two out, and they went first and together because they shared
`lib/peer.js` with a concern that is neither of theirs. The name is *derived* —
the contract id with the `:` turned into a `-` — so there is no mapping to
remember, and the same rule names `platform-network-view`,
`platform-documentation`, `platform-store` and `platform-host` when they follow.

## What is here, and what is deliberately not

Here:

- **`lib/declaration.js`** — the declared shape, parsed at load through
  `artifact-protocol`'s own `parseShape`, which is the same validator a manifest's
  declaration goes through. Moved verbatim rather than reworded: every device
  holding a signed release reads this text through `platform:documentation`, so a
  changed sentence is a change to what the platform says about itself and belongs
  in its own commit.
- **`lib/feed.js`** — one writer per device, attribution that cannot be spoofed by
  passing a different string, and the `(seq, device)` order.
- **`test/conformance.test.js`** — every declared operation driven, arguments and
  return values run through `contract.validate` against the declaration itself.
  This is the point of the phase rather than a side effect: a repository that only
  held moved code would have relocated a file and changed nothing about who can
  prove what.

Not here, because it is the kernel's authority and not this capability's opinion
about itself:

- **the cores.** `ArtifactPatform/lib/peer.js` keeps the key derivation that makes
  discovery work with no rendezvous, the assertion that a session really has the
  fork policy it asked for, the per-`(purpose, device, artifact)` `Log` cache and
  the truncate handler. That is per-network state served over one network's swarm,
  it is identical for feeds and for blobs, and a capability does not get to decide
  how the runtime stores bytes.
- **`chain.js`'s `NATIVE` table.** `@feed:<artifact>` is an *isolation* statement —
  a feed is scoped per artifact, so two instances of `send` share one while `send`
  and `notes` cannot reach each other's. Letting the thing being scoped write its
  own scope is the same mistake as letting a contained process name its own
  containment.
- **minting in `boot.js`.** The native is built with real authority: a device
  keypair, a network key, a realm's root corestore.

The substrate is therefore a **parameter**, not a dependency. Every function here
takes a `peer`, and `lib/feed.js` writes down the five members it reads as a
typedef — so "what a feed needs from the runtime" is a document rather than
whatever the kernel happened to expose. Requiring the kernel would be the cycle
the split exists to remove: the kernel is the consumer.

## What a feed is not

**It is not private.** Every member running the artifact replicates the feed;
addressing an entry to somebody is a filter the reader applies, not a route. What
the platform gives is authenticity — every entry is a signed block in a hypercore
only that device's key can extend — and never confidentiality. An artifact that
needs a secret between two members encrypts before appending. The kernel's
`test/peer.test.js` has a case whose whole job is to keep that true, because a
platform that quietly made feeds private would be one nobody bothered to encrypt
for.

**It is not a message bus and there is no delivery.** A device appends to its own
log and other members read it when they sync, so `entries()` is eventually
consistent and never complete: a member who is offline is absent rather than
empty. Fold the log into state every time rather than treating a read as final.

**The order is not causal.** `(seq, device)` is stable and identical on every
member, and that is the strongest thing available — there is no global arrival
order to appeal to. It is deliberately not sorted by `at`, because that field is
written by the appending device and nothing checks it, so sorting on it would let
one member reorder everyone else's history by claiming a timestamp. A `ponytail:`
in `lib/feed.js` names the ceiling: a reply can sort before the thing it answers
when the replier's log is longer, and fixing that needs a logical clock nothing
needs yet.

## The conformance suite, and the exact edge of what it proves

It reads the shipped, parsed, frozen declaration, walks every operation, and does
to each what `assemble.js`'s `checkedCall` does — arguments in and answer out
through `contract.validate`. Nothing in it restates a shape, so an implementation
that drifts from the declaration fails here rather than on a device mid-call.

The substrate it drives over is in-memory, and the limit is worth stating rather
than implying. **It proves** that the operations exist and answer in the declared
shape, that the merge order is what the declaration says, that a member lying about
`at` cannot reorder anybody, that `own()` never asks for the member list, that
`append` writes as one device with no argument that changes it, and that a garbage
block shifts nobody's sequence numbers. **It cannot prove** that two machines find
each other's cores without a rendezvous, that a member cannot append to somebody
else's log, or that a truncate-and-rewrite is refused — those are properties of
hypercore and of the kernel's `Peer`, and `ArtifactPatform/test/peer.test.js` (two
devices on a real DHT testnet) and `test/peer-integrity.test.js` (in-process
replication, adversarial) are still the only things that hold them. A suite here
that stood up a corestore would be re-testing the substrate through a capability,
which is how you get two half-proofs of one property and no owner for either.

## Development

```
npm test          # the conformance suite, under the Bare runtime
npm run typecheck
```

Plain JS with JSDoc types, checked by `tsc --checkJs --strict` over the suite as
well as the source. It is not an artifact: no `manifest.json`, no `build`, no
ports. Nothing here is installable or testable on its own — it is one of the
twenty-four repos `ArtifactPatform/scripts/all-repos.sh` runs as a set, because
`artifact-protocol` arrives through `file:../artifact-protocol`.
