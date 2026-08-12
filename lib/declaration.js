/**
 * What `platform:feed` promises, as the capability's own document.
 *
 * This is the half of the Phase 6a split that is easy to get wrong by being
 * lazy about it. The declaration used to be one entry in
 * `artifact-protocol/lib/capability.js`'s `RAW` table, beside five others, and
 * the argument for moving it is not tidiness: a capability whose *shape* is
 * written in a package it does not own cannot be revised, versioned or refused
 * without a release of that package, and a capability whose shape and
 * implementation sit in two repositories is two documents that can disagree
 * silently. Here they are one repository and `test/conformance.test.js` drives
 * the second against the first on every run.
 *
 * ## The shape is parsed, not merely written
 *
 * `parseShape` is the same validator a manifest's declaration goes through, and
 * it runs at **load** — the reason `capability.js` gave for checking its own
 * table at load applies unchanged here, and applies harder to a single-entry
 * file: a shape that is quietly malformed would surface at a call boundary on a
 * device, mid-call, blaming the kernel's feed for a fault in this file's prose.
 *
 * Rejected: exporting the raw object and letting the kernel parse it. That puts
 * the parse at the consumer, so a second consumer either repeats it or skips it,
 * and "skips it" is the one that ships.
 *
 * ## The namespace check stayed, and it is not ceremony
 *
 * `capability.js` checks every member of its table for the `platform:` prefix,
 * on the argument that an unprefixed id is one an artifact may legitimately
 * declare for itself — so this file would be a second declaration of somebody's
 * signed contract, and the shape resolvers seed the platform table *first*, so
 * this file would win and the author would have no way to see why. That
 * argument does not weaken when the table has one row; it is just that the only
 * way to break it here is to edit the literal below. The check costs a line and
 * fails at load rather than on a device.
 *
 * What it does **not** check is that this id is one the runtime actually mints.
 * That is `chain.js`'s `NATIVE` table and the kernel's `mintNatives` switch, and
 * the kernel's own suite is where the three lists are pinned to each other —
 * this repo cannot see two of them and must not pretend to.
 */
const { capability, contract } = require('artifact-protocol')

/** The contract id. The repo's name is this with the `:` turned into a `-`. */
const ID = `${capability.PLATFORM_PREFIX}feed`

/**
 * `1.0.0`, and that is a statement rather than a placeholder.
 *
 * The whole shipped tree ports this at `^1.0.0`. A second version is a change to
 * the runtime that some devices have and some do not, so the day one appears
 * this file gains a second entry in `DECLARATIONS` rather than editing the
 * first, and the interesting work is in `chain.js` — a port whose range no
 * supplied version satisfies is a graph fault nothing currently reports.
 */
const VERSION = '1.0.0'

/**
 * The declared shape, verbatim as it was in `artifact-protocol`'s table.
 *
 * Moved rather than rewritten, deliberately. A split is judged on whether the
 * thing that moved is the thing that was there, and an "improved" description
 * arriving in the same commit as a relocation makes that unanswerable — every
 * device holding a signed release of an artifact ported at `^1.0.0` reads this
 * text through `platform:documentation`, so a reworded sentence is a change to
 * what the platform says about itself and belongs in its own commit.
 *
 * `value` is `any` on both sides, and that is the one thing in here worth
 * defending: the schema vocabulary would have to be the artifact's, and an
 * artifact cannot declare a shape for a platform contract.
 */
const SHAPE = {
  description:
    'This device\'s append-only log for one artifact, plus every other member\'s. **Not private.** Every ' +
    'member running the artifact replicates the feed; addressing an entry to somebody is a filter they ' +
    'apply, not a route. What the platform gives is authenticity — every entry is a signed block in a ' +
    'hypercore only that device\'s key can extend — and never confidentiality, so encrypt before appending ' +
    'if it matters. Two more things to write against. entries() is eventually consistent and never ' +
    'complete: it merges the feeds of the members this device can currently reach, so a member who is ' +
    'offline is absent rather than empty and their entries appear when they come back — fold the log into ' +
    'state every time rather than treating a read as final. And the order is (seq, device), which is stable ' +
    'and computed identically by every member but is *not* causal and is not the order things happened.',
  operations: [
    {
      name: 'who',
      description: 'Who this feed writes as.',
      params: [],
      returns: { type: 'string', description: 'This device\'s public key, z-base32 — the same string entries carry in their device field.' }
    },
    {
      name: 'append',
      description: 'Append to this device\'s own log. There is no way to append to anybody else\'s, and that is the hypercore\'s guarantee rather than this contract\'s.',
      params: [
        { name: 'value', type: 'any', description: 'Whatever the artifact wants recorded, as JSON. `any` because the platform has no opinion about it and no way to acquire one: the schema vocabulary here would have to be the artifact\'s, and an artifact cannot declare a shape for a platform contract.' }
      ],
      returns: { type: 'number', description: 'The sequence number the entry was written at, in this device\'s own log. Not a global position — there is none — so it is only comparable against entries from the same device.' }
    },
    {
      name: 'entries',
      description: 'Every entry for this artifact, from every member this device can currently reach.',
      params: [],
      returns: {
        type: 'array',
        description: 'The merged log in (seq, device) order.',
        of: {
          type: 'object',
          description: 'One entry.',
          fields: {
            device: { type: 'string', description: 'The device that appended it, z-base32. This is authenticated — the block is signed by that key.' },
            seq: { type: 'number', description: 'The position in that device\'s own log.' },
            at: { type: 'number', description: 'A wall-clock hint written by the appending device. Never sort on it and never trust it: it is that device\'s clock, and nothing checks it.' },
            value: { type: 'any', description: 'Whatever was appended.' }
          }
        }
      }
    },
    {
      name: 'own',
      description: 'Just this device\'s own entries, which needs no network and is complete rather than eventually consistent.',
      params: [],
      returns: {
        type: 'array',
        description: 'This device\'s entries, in sequence order.',
        of: {
          type: 'object',
          description: 'One entry, in the same form entries() returns — the device field is always this device.',
          fields: {
            device: { type: 'string', description: 'This device\'s key.' },
            seq: { type: 'number', description: 'The position in this device\'s log.' },
            at: { type: 'number', description: 'This device\'s own clock hint.' },
            value: { type: 'any', description: 'Whatever was appended.' }
          }
        }
      }
    }
  ]
}

if (!capability.isPlatformContract(ID)) {
  throw new Error(
    `platform-feed: ${JSON.stringify(ID)} is outside the ${capability.PLATFORM_PREFIX} namespace; ` +
    'an id without the prefix is one an artifact may declare for itself, and the shape resolvers seed the ' +
    'platform table before they read a manifest — so this entry would silently override a signed declaration'
  )
}

/**
 * The declaration, shaped exactly like `manifest.contracts[i]` holds one, so a
 * consumer needs no translation step and cannot drift from the manifest
 * vocabulary it is standing in for.
 *
 * @type {Declaration}
 */
const DECLARATION = Object.freeze({
  id: ID,
  version: VERSION,
  shape: contract.parseShape(SHAPE, `platform declaration ${ID}.shape`)
})

/**
 * Every version of this capability this package knows, as a list.
 *
 * One entry today. The list rather than the entry because `chain.js`'s `visible`
 * feeds a substitution rule that picks a baseline out of the versions in range,
 * and `assemble.js` filters these by the port's range — a consumer that had to
 * know the count is a consumer that breaks on the day there are two.
 *
 * @type {readonly Declaration[]}
 */
const DECLARATIONS = Object.freeze([DECLARATION])

/**
 * One platform capability declaration.
 *
 * Declared here rather than aliased from `artifact-protocol`: this file is
 * `module.exports = <expression>`, which TypeScript reads as `export =`, and a
 * typedef in such a file is not a named type export of it — so re-declaring one
 * as an alias of the protocol's `Declaration` collides with that declaration in
 * whichever repository compiles both packages as one program, invisibly here.
 * `artifact-net/lib/lan.js` has the full account; it cost a day there.
 *
 * @typedef {object} Declaration
 * @property {string} id
 * @property {string} version
 * @property {import('artifact-protocol/contract').Shape} shape
 */

module.exports = { ID, VERSION, DECLARATION, DECLARATIONS }
