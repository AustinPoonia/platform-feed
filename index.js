/**
 * platform-feed — the `platform:feed` capability: its declaration, its
 * implementation, and the suite that holds one to the other.
 *
 * ## Why this is its own repository
 *
 * ROADMAP.md Phase 6a: **the kernel wires capabilities; it does not implement
 * them.** Six capabilities the runtime supplies had their declarations in one
 * file in `artifact-protocol` and their implementations spread across four files
 * in the kernel, no two sharing a boundary — so a capability was two documents in
 * two repositories with nothing holding them together, and the only thing that
 * proved either was the kernel's own suite. This repo and `platform-blobs` are
 * the first two out, and they went first and together because they shared
 * `peer.js` with a concern that is neither of theirs.
 *
 * The name is *derived*: the contract id with the `:` turned into a `-`. There is
 * no mapping to keep in anyone's head, and the same rule names the four repos
 * still to come.
 *
 * ## What is here and what stayed in the kernel
 *
 * Here: the declaration (`lib/declaration.js`), the implementation
 * (`lib/feed.js`) and a conformance suite that drives the second against the
 * first. That last one is the point of the phase rather than a side effect — a
 * repository that only held moved code would have relocated a file and changed
 * nothing about who can prove what.
 *
 * Stayed, because it is the kernel's authority and not this capability's opinion
 * about itself:
 *
 *   - **the cores.** `ArtifactPatform/lib/peer.js` keeps the key derivation, the
 *     fork-policy assertion, the per-(purpose, device, artifact) `Log` cache and
 *     the truncate handler. That is per-network state served over one network's
 *     swarm, it is identical for feeds and for blobs, and a capability does not
 *     get to decide how the runtime stores bytes.
 *   - **`chain.js`'s `NATIVE` table.** `@feed:<artifact>` is an *isolation*
 *     statement: it says a feed is scoped per artifact and not per instance, so
 *     two copies of `send` share one and `send` and `notes` cannot reach each
 *     other's. That is a decision about what a valid graph may name, and letting
 *     the thing being scoped write its own scope is the same mistake as letting a
 *     contained process name its own containment.
 *   - **minting in `boot.js`.** The native is built with real authority — a
 *     device keypair, a network key, a realm's root corestore — and the kernel is
 *     the only thing holding those.
 *
 * ## It is not an artifact
 *
 * No `manifest.json`, no `build`, no ports. It is an ordinary Bare module the
 * kernel requires directly, and it sits on the far side of the boundary an
 * artifact sees: an artifact *binds* `platform:feed` and can never reach this
 * package.
 *
 * ## Types come through `platform-feed/feed` and `platform-feed/declaration`
 *
 * There is no `@typedef` in this file. This is a `module.exports = <expression>`
 * file, which TypeScript reads as `export =`; a JSDoc typedef in such a file is
 * not a named type export of it, and re-declaring one here as an alias of the
 * declaration it points at collides with that declaration the moment a consumer
 * compiles both packages as one program — `TS2300: Duplicate identifier`,
 * invisible in this repo's own typecheck and reported only in the repo that sees
 * both. `artifact-net/lib/lan.js` has the full account; it cost a day there.
 *
 * So each type is declared once, in the module that owns it, and a consumer
 * naming one writes it against the subpath this package declares.
 *
 * ## The re-export is written out rather than spread
 *
 * `{ ...require('./lib/feed') }` would be shorter and would make this file stop
 * being a document. Naming each member is how a reader learns what the front door
 * is without opening two more files, and it is what makes *adding* to the surface
 * a visible decision rather than a side effect of adding an export three
 * directories down.
 */
const declaration = require('./lib/declaration')
const implementation = require('./lib/feed')

module.exports = {
  ID: declaration.ID,
  VERSION: declaration.VERSION,
  DECLARATION: declaration.DECLARATION,
  DECLARATIONS: declaration.DECLARATIONS,
  PURPOSE: implementation.PURPOSE,
  feed: implementation.feed,
  merge: implementation.merge
}
