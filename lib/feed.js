/**
 * `platform:feed` — say something, so every member running this artifact reads it.
 *
 * This was `ArtifactPatform/lib/peer.js`'s `Peer.prototype.feed` and
 * `Peer.prototype._merge`. What is here is the capability; what stayed behind is
 * the **substrate** it is minted over, and the line between them is the whole
 * content of this file's existence, so it is stated before the code:
 *
 *   - the kernel owns the cores. Deriving a core key from public inputs so two
 *     members find each other with no rendezvous, refusing a session whose fork
 *     policy was widened by an inbound replication request, caching one `Log` per
 *     (purpose, device, artifact) and dropping that cache on a truncate — all of
 *     that is per-*network* state served over one swarm, it is identical for
 *     feeds and for blobs, and it is not a capability's opinion about itself.
 *   - this repo owns what a feed *is*: one writer per device, attribution that
 *     cannot be spoofed by passing a different string, and the order two members
 *     compute identically from the same set of logs.
 *
 * `peer.js`'s header still carries the substrate arguments and is the thing to
 * read for why a feed is not private, where the cores live, and what
 * `allowFork: false` costs. None of that is repeated here, because a copy of an
 * argument is an argument that goes stale on one side.
 *
 * ## Why the substrate is a parameter and not a dependency
 *
 * Every function here takes a `peer`. The alternative — this repo requiring the
 * kernel — is the cycle the split exists to avoid: the kernel mints the natives,
 * so it is the consumer, and a capability that reached back into it would make
 * `platform-feed` uninstallable without the thing that installs it.
 *
 * The interface is narrow on purpose and is written down as a typedef below, so
 * "what a feed needs from the runtime" is a document rather than whatever the
 * kernel happened to expose. That is what makes `test/conformance.test.js`
 * possible at all: it supplies an in-memory substrate and drives the real
 * implementation, which is a test about this capability instead of a test about
 * hypercore. The limit of that, stated in the same breath: an in-memory
 * substrate cannot prove replication, discovery or the fork policy, and the
 * kernel's `test/peer.test.js` and `test/peer-integrity.test.js` are still the
 * only things that do.
 *
 * ## The order, and why it is not `at`
 *
 * There is no global arrival order to appeal to — each member's log is
 * independent and syncs when it syncs — so `merge` sorts by `(seq, device)`:
 * every member's first entry, then every member's second, ties broken by device
 * key. It is the only order two members compute identically from the same set of
 * feeds, which is what "deterministic" has to mean here.
 *
 * It is deliberately *not* sorted by `at`. That field is written by the device
 * that appended and a device can write whatever it likes there, so sorting on it
 * would let one member reorder everyone else's history by claiming a timestamp.
 * It is a hint for humans, never an ordering.
 *
 * ponytail: `(seq, device)` is a total order, not a causal one. A reply can sort
 * before the thing it replies to when the replier's log is longer. Fixing that
 * needs a logical clock in the entry, and nothing needs it yet.
 */
const { DECLARATION } = require('./declaration')

/**
 * The three purposes a `Peer` keeps cores under. Only `feed` is this
 * capability's; the string is the substrate's vocabulary and is named here
 * rather than spelled at three call sites.
 */
const PURPOSE = 'feed'

/**
 * Every member's entries for one artifact, merged into the one order they all
 * compute identically.
 *
 * A `null` block is skipped and its sequence number is **not** reused: a member
 * can append anything to its own log, the substrate hands garbage back as `null`
 * rather than throwing, and `seq` is the block index so that a reader quoting a
 * position back means the same position the writer wrote at. Renumbering to
 * close the gap would silently shift every entry after a bad append.
 *
 * Exported because `entries()` is the operation and this is its whole behaviour;
 * a rule that only the closure can state is a rule no test can drive directly.
 *
 * @param {Peer} peer
 * @param {string} artifact
 * @returns {Promise<Entry[]>}
 */
async function merge (peer, artifact) {
  /** @type {Entry[]} */
  const merged = []

  for (const device of await peer.devices()) {
    const blocks = await peer.log(PURPOSE, device, artifact).entries()
    for (let seq = 0; seq < blocks.length; seq++) {
      const block = blocks[seq]
      if (block === null || block === undefined) continue
      merged.push({ device, seq, at: Number(block.at) || 0, value: block.value })
    }
  }

  return merged.sort((a, b) => a.seq - b.seq || (a.device < b.device ? -1 : a.device > b.device ? 1 : 0))
}

/**
 * A device's window on one artifact's feed.
 *
 * `append` writes as this device and no other — the device identity is closed
 * over, never an argument, so an artifact cannot forge an entry from a
 * colleague's machine by passing a different string. That is stronger than a
 * check: the entry is a signed block in a core only this device's secret key can
 * extend, so the attribution survives leaving this process. The limit is that
 * this file cannot enforce any of it; the core does, and this repo's suite can
 * only show that nothing here hands an artifact a way around it.
 *
 * @param {Peer} peer
 * @param {string} id         the instance id the plan minted this under
 * @param {string} artifact   the artifact name the feed is scoped to
 * @returns {NativeInstance}
 */
function feed (peer, id, artifact) {
  return {
    id,
    contract: DECLARATION.id,
    methods: {
      /** Who this feed writes as. */
      who () { return peer.device },

      /**
       * Append to this device's own log. Returns the new sequence number.
       *
       * Read off the core's length *before* the append rather than derived from
       * it afterwards: the number a caller is handed has to be the position this
       * entry went to, and a length read after the fact is a position only while
       * nothing else appended in between.
       */
      async append (value) {
        const core = peer.core(PURPOSE, peer.device, artifact)
        await core.ready()
        const seq = core.length
        await core.append(Buffer.from(JSON.stringify({ at: peer.now(), value })))
        return seq
      },

      /** Every entry for this artifact, from every member. */
      entries () { return merge(peer, artifact) },

      /**
       * Just this device's own entries.
       *
       * Reads one log rather than going through `merge`, which is not an
       * optimisation: this is the operation declared to be *complete* rather than
       * eventually consistent, and asking for the member list would make it
       * depend on state that arrives over a network.
       */
      async own () {
        const blocks = await peer.log(PURPOSE, peer.device, artifact).entries()
        return blocks
          .map((block, seq) => block === null || block === undefined
            ? null
            : { device: peer.device, seq, at: Number(block.at) || 0, value: block.value })
          .filter((entry) => entry !== null)
      }
    }
  }
}

/**
 * One member's log, as this capability needs to read it.
 *
 * `entries()` answers with decoded blocks, `null` where a block was not JSON, and
 * index *n* of the array is sequence number *n*. That last part is the invariant
 * `merge` is built on and the substrate is what enforces it.
 *
 * @typedef {object} MemberLog
 * @property {() => Promise<(any | null)[]>} entries
 */

/**
 * The core this capability appends to, as it needs it.
 *
 * @typedef {object} WritableCore
 * @property {number} length
 * @property {() => Promise<void> | void} ready
 * @property {(block: any) => Promise<any>} append
 */

/**
 * The runtime substrate a feed is minted over — `ArtifactPatform/lib/peer.js`'s
 * `Peer`, at exactly the members this capability reads.
 *
 * Narrow rather than `any`, and narrow rather than importing the kernel's type:
 * this is the contract between a capability and the runtime, so it belongs on
 * the capability's side where a change to it is visible as a change to this
 * file. TypeScript is structural, so the kernel's `Peer` satisfies it by having
 * these members and nothing has to be declared twice.
 *
 * @typedef {object} Peer
 * @property {string} device                      this device's key, z-base32
 * @property {() => number} now                   injected, because a realm has no clock
 * @property {(purpose: Purpose, device: string, artifact: string) => WritableCore} core
 * @property {(purpose: Purpose, device: string, artifact: string) => MemberLog} log
 * @property {() => Promise<string[]>} devices    the members whose logs count, in a stable order
 */

/**
 * The one core purpose this capability touches, as a type rather than as `string`.
 *
 * Two reasons, and the second is the one that made it necessary. It is *true* — a
 * feed reads and writes exactly one of the substrate's three cores, and the blob
 * index and content cores are not reachable from here — so writing `string` would
 * describe a wider capability than this is. And under `strictFunctionTypes` the
 * members above are property-position function types, so their parameters are
 * checked contravariantly: a substrate whose own `core` takes its narrow purpose
 * union would not satisfy a `string` here, and the kernel would need a cast at the
 * one line that hands `this` over. A cast at a boundary this file exists to
 * describe would be describing it in the one place it stops being checked.
 *
 * @typedef {'feed'} Purpose
 */

/**
 * One merged entry.
 *
 * @typedef {object} Entry
 * @property {string} device
 * @property {number} seq
 * @property {number} at
 * @property {any} value
 */

/**
 * What the kernel binds a `platform:*` port to.
 *
 * Declared here rather than imported from the kernel, for the reason the `Peer`
 * typedef is: the shape is what this capability produces, and this repo must not
 * require its own consumer.
 *
 * @typedef {object} NativeInstance
 * @property {string} id
 * @property {string} contract
 * @property {Record<string, (...args: any[]) => any>} methods
 */

module.exports = { PURPOSE, feed, merge }
