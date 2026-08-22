/**
 * The declaration and the implementation, driven against each other.
 *
 * Before Phase 6a, `platform:feed`'s shape was proved by the kernel's suite or by
 * nothing at all: `artifact-protocol` held the declaration and ran a parse over
 * it, `ArtifactPatform/lib/peer.js` held the implementation, and the only thing
 * that ever compared them was `assemble.js`'s `checkedCall` — at runtime, on a
 * device, for whichever operation an artifact happened to call. An operation no
 * shipped artifact calls was never checked against its declared shape anywhere.
 *
 * This suite is the answer to that, and it is why the repo exists rather than
 * being a folder with two files moved into it. It reads the *shipped*
 * declaration — the same frozen, parsed object the kernel resolves — walks every
 * operation in it, and does to each one what `checkedCall` does: validates the
 * arguments going in and the return value coming back, with `contract.validate`,
 * against the schema the declaration carries. Nothing here restates a shape.
 *
 * ## What the substrate is, and the exact edge of what that proves
 *
 * A feed is minted over a `Peer` — the kernel's per-network cores, keyed by a
 * derivation both members compute, refusing forks. None of that is here, and an
 * in-memory stand-in is used instead. That is deliberate and it is also a limit
 * that has to be stated rather than implied:
 *
 *   - **What this proves.** That the operations exist, that each answers in the
 *     declared shape, that `entries()` merges and orders the way the declaration
 *     says, that `own()` needs no member list, that `append` writes as one device
 *     and no other, and that a garbage block does not shift anybody's sequence
 *     numbers. Every one of those is this capability's own logic.
 *
 *   - **What it cannot prove.** That two machines find each other's cores without
 *     a rendezvous, that a member cannot append to somebody else's log, that a
 *     truncate-and-rewrite is refused, or that any of it replicates. Those are
 *     properties of hypercore and of the kernel's `Peer`, and
 *     `ArtifactPatform/test/peer.test.js` (two devices on a real DHT testnet) and
 *     `test/peer-integrity.test.js` (in-process replication, adversarial) are
 *     still the only things that hold them. A suite here that stood up a corestore
 *     would be re-testing the substrate through a capability, which is how you end
 *     up with two half-proofs of one property and no owner for either.
 *
 * The stand-in is written to be *honest about failure*, not merely to work: a
 * block that is not JSON comes back as `null` at its own index, exactly as the
 * kernel's `Log` hands it over, because that is the case `merge` has a rule for.
 *
 * ## Why the fixture is asserted before anything uses it
 *
 * The first case checks the stand-in against the properties the rest of the file
 * relies on. A conformance suite driving a fixture that quietly stopped recording
 * appends would pass everything and mean nothing, and this file has no network
 * and no timing to blame for a silence — so the fixture is the one thing that
 * gets checked twice.
 */
const t = require('bare-tap')
const assert = require('bare-assert')

const { contract } = require('artifact-protocol')
const { DECLARATION, ID, VERSION, feed, merge } = require('..')

/** @type {[string, () => Promise<void> | void][]} */
const cases = []
const test = (/** @type {string} */ n, /** @type {any} */ f) => cases.push([n, f])

/**
 * Narrow a thrown value, loudly.
 *
 * Duck-typed rather than `instanceof Error`, matching every other suite in this
 * tree: a value thrown across a realm boundary carries that realm's
 * `Error.prototype` and fails the host's check while being an error in every
 * sense a test cares about. Nothing here crosses a realm, and copying the strict
 * version would be a difference between suites with no argument behind it.
 *
 * @param {unknown} err
 * @returns {asserts err is Error}
 */
function threw (err) {
  const shape = /** @type {{ message?: unknown } | null | undefined} */ (err)
  assert.ok(typeof shape?.message === 'string', `threw something with no message: ${String(err)}`)
}

/** One declared operation, by name, failing loudly rather than returning undefined. */
function operation (/** @type {string} */ name) {
  const op = DECLARATION.shape.operations.find((o) => o.name === name)
  // Not `?.` and not a default. A renamed operation means every case below is
  // exercising a shape of this file's invention, which is the whole failure mode
  // the "read the shipped declaration" argument is about.
  assert.ok(op !== undefined,
    `${ID} no longer declares ${name}; it declares ` +
    DECLARATION.shape.operations.map((o) => o.name).join(', '))
  return op
}

/**
 * Do to one call exactly what `assemble.js`'s `checkedCall` does to it.
 *
 * Arguments through the declared parameter schemas, the answer through the
 * declared return schema, both with `contract.validate`, which throws on a fault.
 * That is the point of driving it this way rather than writing `assert.equal` on
 * each shape by hand: the kernel's check and this one are the *same function over
 * the same document*, so a declaration this implementation cannot satisfy fails
 * here rather than on somebody's device mid-call.
 *
 * The declared params are walked rather than the supplied args, so a call that
 * forgot a required argument is a fault and not a silent skip. `optional` is the
 * declaration's way of saying an absence is legal, and `validate` reads it.
 *
 * @param {any} instance @param {string} name @param {any[]} args
 */
async function checked (instance, name, args) {
  const op = operation(name)

  op.params.forEach((param, i) => {
    if (args[i] === undefined && param.optional === true) return
    contract.validate(args[i], param, `${ID}.${name}(${param.name})`)
  })

  const method = instance.methods[name]
  assert.equal(typeof method, 'function', `${name} is not a function on the built instance`)

  const answer = await method(...args)
  if (op.returns !== undefined) contract.validate(answer, op.returns, `${ID}.${name}() return value`)
  return answer
}

/* ───────────────────────────── the substrate ────────────────────────────── */

/**
 * An in-memory stand-in for the kernel's `Peer`, at the five members
 * `lib/feed.js` declares it needs and not one more.
 *
 * Blocks are kept as the `Buffer`s the implementation appends, and `log()`
 * decodes them the way the kernel's `Log` does — `JSON.parse`, `null` for
 * anything that is not a JSON object, and index *n* is sequence *n*. Writing the
 * decode here rather than storing parsed values is what makes the garbage-block
 * case reachable: if this fixture stored objects, `merge`'s `null` rule would be
 * unreachable and the case asserting it would be theatre.
 *
 * `now` is fixed rather than `Date.now`, because `at` is a declared field and a
 * test that could not predict it would have to assert `typeof` and stop there —
 * and one case below needs to write a *dishonest* `at`, which only works if the
 * honest one is known.
 *
 * @param {string} device
 * @param {string[]} [members]   what `devices()` answers; defaults to this device alone
 */
function substrate (device, members) {
  /** @type {Map<string, any[]>} */
  const cores = new Map()
  const at = () => 1700000000000

  const held = (/** @type {string} */ purpose, /** @type {string} */ d, /** @type {string} */ a) => {
    const key = `${purpose}/${d}/${a}`
    const open = cores.get(key)
    if (open !== undefined) return open
    /** @type {any[]} */
    const fresh = []
    cores.set(key, fresh)
    return fresh
  }

  return {
    device,
    now: at,
    core (/** @type {string} */ purpose, /** @type {string} */ d, /** @type {string} */ a) {
      const blocks = held(purpose, d, a)
      return {
        get length () { return blocks.length },
        async ready () { /* nothing to open */ },
        async append (/** @type {any} */ block) { blocks.push(block); return blocks.length }
      }
    },
    log (/** @type {string} */ purpose, /** @type {string} */ d, /** @type {string} */ a) {
      const blocks = held(purpose, d, a)
      return {
        async entries () {
          return blocks.map((block) => {
            try {
              const value = JSON.parse(block.toString())
              return value !== null && typeof value === 'object' ? value : null
            } catch {
              return null
            }
          })
        }
      }
    },
    async devices () { return [...(members ?? [device])].sort() },

    // Not part of the interface `lib/feed.js` declares — the two cases that need
    // to write a block no honest implementation would write reach for this, so
    // that they cannot do it by calling `append` and accidentally testing that.
    raw (/** @type {string} */ purpose, /** @type {string} */ d, /** @type {string} */ a) {
      return held(purpose, d, a)
    },
    at: at()
  }
}

/* ─────────────────────── the fixture, checked first ─────────────────────── */

test('the in-memory substrate behaves the way every case below assumes', async () => {
  const peer = substrate('device-a')
  const core = peer.core('feed', 'device-a', 'send')

  assert.equal(core.length, 0)
  await core.append(Buffer.from(JSON.stringify({ at: 1, value: 'x' })))
  assert.equal(core.length, 1, 'an append is recorded, and length moves with it')

  const [entry] = await peer.log('feed', 'device-a', 'send').entries()
  assert.equal(entry.value, 'x', 'and a decode of it comes back')

  // The property `merge`'s null rule needs, and the reason this fixture stores
  // buffers rather than objects.
  peer.raw('feed', 'device-a', 'send').push(Buffer.from('not json at all'))
  const both = await peer.log('feed', 'device-a', 'send').entries()
  assert.equal(both.length, 2, 'a bad block still occupies its index')
  assert.strictEqual(both[1], null, 'and decodes to null rather than throwing')

  // Two cores under two purposes are two cores, or the blobs-side purposes would
  // be reading a feed.
  assert.equal(peer.core('index', 'device-a', 'send').length, 0, 'purposes do not share storage')
})

/* ───────────────────── the surface is the declared one ──────────────────── */

test('the built instance is exactly the declared surface, no more and no less', () => {
  const built = feed(substrate('device-a'), 'feed-1', 'send')

  // `conforms` is `artifact-protocol`'s own answer to "is there an operation here
  // by this name, bound to something callable", and it is the function the kernel
  // uses on an artifact's instance. Using it rather than a hand-rolled loop means
  // this case cannot pass a rule the kernel would fail.
  assert.equal(contract.conforms(built.methods, DECLARATION.shape).join('; '), '',
    'the implementation is missing an operation its declaration promises')

  // And the other direction, which `conforms` does not answer and which matters
  // here for a reason it does not for an artifact: an *undeclared* method on a
  // native is reachable from an artifact — `assemble.js` resolves the operation
  // list from the declaration to decide what to validate, so a method with no
  // declared shape is a method whose arguments and return value nothing checks.
  // For a platform capability that is an unchecked path into the runtime.
  const declared = DECLARATION.shape.operations.map((o) => o.name).sort()
  const present = Object.keys(built.methods).sort()
  assert.equal(present.join(','), declared.join(','),
    `the instance offers ${present.join(',')} and declares ${declared.join(',')}`)
})

test('the instance answers on the contract it declares, at the version it declares', () => {
  const built = feed(substrate('device-a'), 'feed-1', 'send')

  // `targetChecks` looks the declaration up by *the contract the native says it
  // answers on*, not by the port's. A native whose `contract` string drifted from
  // its declaration would resolve no shape and go silently unchecked, which is
  // the exact hole the platform declarations were introduced to close.
  assert.equal(built.contract, ID)
  assert.equal(built.id, 'feed-1', 'the plan\'s target name is carried through')
  assert.equal(DECLARATION.version, VERSION)
  assert.equal(ID, 'platform:feed', 'the id the repo is named after')
})

/* ──────────────── every operation, driven through its shape ─────────────── */

test('every declared operation is driven and every answer validates against its schema', async () => {
  const peer = substrate('device-a')
  const built = feed(peer, 'feed-1', 'send')

  const seq = await checked(built, 'append', [{ type: 'hello' }])
  assert.equal(seq, 0, 'the first entry in this device\'s own log')

  assert.equal(await checked(built, 'who', []), 'device-a')

  const entries = await checked(built, 'entries', [])
  assert.equal(entries.length, 1)

  const own = await checked(built, 'own', [])
  assert.equal(own.length, 1)

  // Coverage of this file over its own subject, asserted rather than eyeballed:
  // the four calls above are the four declared operations. A seventh operation
  // added to the declaration fails here instead of being quietly undriven, which
  // is the failure mode of a conformance suite written as a list of cases.
  assert.equal(DECLARATION.shape.operations.length, 4,
    'an operation was added or removed; drive it above rather than editing this number')
})

test('append returns the position it wrote at, and the positions keep counting', async () => {
  const built = feed(substrate('device-a'), 'feed-1', 'send')

  assert.equal(await checked(built, 'append', ['first']), 0)
  assert.equal(await checked(built, 'append', ['second']), 1)
  assert.equal(await checked(built, 'append', ['third']), 2)

  // The declaration says this number is "the position in this device's own log"
  // and not a global one. `own()` is where that claim is observable.
  const own = await checked(built, 'own', [])
  assert.equal(own.map((/** @type {any} */ e) => e.seq).join(','), '0,1,2')
  assert.equal(own.map((/** @type {any} */ e) => e.value).join(','), 'first,second,third')
})

test('value is declared any, so the platform refuses nothing an artifact records', async () => {
  const built = feed(substrate('device-a'), 'feed-1', 'send')

  // Stated as a case rather than left as an absence, because the obvious shape for
  // a conformance suite is "and here is the argument the declaration refuses" —
  // and for this contract there is none. `append(value)` is `any` on purpose: the
  // schema vocabulary would have to be the artifact's, and an artifact cannot
  // declare a shape for a platform contract. So the honest assertion is that the
  // declaration says `any` and that awkward values really do survive the round
  // trip, rather than a refusal case invented to make the file look symmetrical.
  const param = operation('append').params[0]
  assert.equal(param.type, 'any')

  const recorded = [null, 0, false, '', [], { nested: { deep: [1, 2] } }]
  for (const value of recorded) await checked(built, 'append', [value])

  const own = await checked(built, 'own', [])
  assert.equal(own.length, recorded.length)

  // All six, and not the three this case used to sample. `0`, `''` and `[]` went
  // unasserted, and `[]` is the one that mattered: an `append` that spread the
  // value on its way into the block — one `{ ...value }` away — writes `{}` there,
  // and an artifact reading `.length` off the answer gets `undefined` with nothing
  // anywhere having failed. Composites are compared by canonical encoding,
  // because `[]` and `{}` encode differently and that is exactly the difference
  // being watched for; primitives by identity, because `null`, `false`, `''` and
  // `0` are four values a loose comparison confuses with each other and with
  // absence.
  recorded.forEach((value, i) => {
    if (value === null || typeof value !== 'object') {
      assert.strictEqual(own[i].value, value,
        `entry ${i} went in as ${JSON.stringify(value)} and came back as ${JSON.stringify(own[i].value)}`)
      return
    }
    assert.equal(JSON.stringify(own[i].value), JSON.stringify(value), `entry ${i} did not survive the log`)
    assert.equal(Array.isArray(own[i].value), Array.isArray(value),
      `entry ${i} changed between an array and an object, which is the loss no encoding shows`)
  })

  // And the edge that "refuses nothing" hides, stated as a case rather than left
  // for somebody to discover from a `{}`. A value JSON cannot carry is not
  // refused *and* does not survive: a `Set` is accepted, written as `{}`, and read
  // back as `{}`. The loss is real and it is silent, and it belongs to the door
  // rather than to this capability — `append` serialises with `JSON.stringify`
  // and there is no second encoding for it to reach for. Asserted so that an
  // `append` which grew a refusal, and an `append` which grew a richer encoder,
  // both fail here and have to say which of the two they are.
  assert.equal(await checked(built, 'append', [new Set(['a'])]), recorded.length,
    'append refused a value, and the declaration says it refuses nothing')
  const after = await checked(built, 'own', [])
  assert.equal(JSON.stringify(after[recorded.length].value), '{}',
    'a Set now survives the door; the declaration promises any, and JSON is what any means here')
})

/* ──────────────────── the order, which is the whole rule ────────────────── */

test('entries merges every member and orders by (seq, device), not by arrival', async () => {
  // Three members, uneven logs. The order the declaration promises is every
  // member's first entry, then every member's second, ties broken by device key —
  // the only order two members compute identically from the same set of logs.
  const peer = substrate('device-b', ['device-a', 'device-b', 'device-c'])

  const append = async (/** @type {string} */ device, /** @type {any} */ value) => {
    const core = peer.core('feed', device, 'send')
    await core.append(Buffer.from(JSON.stringify({ at: peer.at, value })))
  }

  await append('device-c', 'c0')
  await append('device-a', 'a0')
  await append('device-b', 'b0')
  await append('device-a', 'a1')
  await append('device-c', 'c1')
  await append('device-a', 'a2')

  const built = feed(peer, 'feed-1', 'send')
  const entries = await checked(built, 'entries', [])

  assert.equal(entries.map((/** @type {any} */ e) => e.value).join(','), 'a0,b0,c0,a1,c1,a2')

  // And the exported rule answers identically to the operation, because the
  // operation is a one-line call to it — asserted so that a future refactor
  // cannot leave two orderings in one repo.
  const direct = await merge(peer, 'send')
  assert.equal(JSON.stringify(direct), JSON.stringify(entries))
})

test('a member claiming a timestamp cannot reorder anybody else s history', async () => {
  // The attack the ordering rule exists to refuse. `at` is written by the device
  // that appended and nothing checks it, so a member that sorted on `at` could put
  // its own entry first — or last — in every reader's merge by lying about a
  // number. This writes the lie and asserts the order did not move.
  const peer = substrate('device-a', ['device-a', 'device-z'])

  const core = peer.core('feed', 'device-a', 'send')
  await core.append(Buffer.from(JSON.stringify({ at: peer.at, value: 'honest' })))

  const liar = peer.core('feed', 'device-z', 'send')
  await liar.append(Buffer.from(JSON.stringify({ at: 0, value: 'claims to be first' })))

  const built = feed(peer, 'feed-1', 'send')
  const entries = await checked(built, 'entries', [])

  assert.equal(entries[0].value, 'honest', 'the earlier `at` did not win')
  assert.equal(entries[0].device, 'device-a', 'device key broke the tie, as declared')
  assert.equal(entries[1].at, 0, 'and the dishonest hint is still carried, because it is declared')
})

test('a block that is not JSON is skipped and shifts nobody s sequence numbers', async () => {
  // A member can append anything to its own log, including garbage. Skipping the
  // block rather than throwing keeps one bad append from making the rest of that
  // member's history — and everyone else's — unreadable; leaving its index
  // occupied is what keeps `seq` equal to the position the writer wrote at.
  // Renumbering to close the gap would silently move every later entry, and a
  // reader quoting a position back would mean a different entry from the writer.
  const peer = substrate('device-a', ['device-a', 'device-b'])
  const built = feed(peer, 'feed-1', 'send')

  await checked(built, 'append', ['ours-0'])
  peer.raw('feed', 'device-a', 'send').push(Buffer.from('  not json'))
  await checked(built, 'append', ['ours-2'])

  const theirs = peer.raw('feed', 'device-b', 'send')
  theirs.push(Buffer.from(JSON.stringify({ at: peer.at, value: 'theirs-0' })))

  const entries = await checked(built, 'entries', [])
  assert.equal(entries.length, 3, 'the garbage block is not an entry')

  const ours = entries.filter((/** @type {any} */ e) => e.device === 'device-a')
  assert.equal(ours.map((/** @type {any} */ e) => e.seq).join(','), '0,2',
    'the surviving entries keep the positions they were written at')

  // And `own()` agrees, since it applies the same rule over one log.
  const own = await checked(built, 'own', [])
  assert.equal(own.map((/** @type {any} */ e) => e.seq).join(','), '0,2')
})

/* ──────────── what an artifact cannot get out of this capability ────────── */

test('append writes as this device and there is no argument that changes that', async () => {
  const peer = substrate('device-a', ['device-a', 'device-b'])
  const built = feed(peer, 'feed-1', 'send')

  // The identity is closed over rather than passed, so the only way to try is to
  // pass one anyway and see whose log moved. `append(value)` takes one declared
  // parameter; a second argument is not an error the declaration reports, so what
  // has to be asserted is that it changed nothing.
  await built.methods.append('mine', 'device-b')

  assert.equal(peer.raw('feed', 'device-a', 'send').length, 1, 'our own log took it')
  assert.equal(peer.raw('feed', 'device-b', 'send').length, 0, 'and the colleague\'s did not move')

  const entries = await checked(built, 'entries', [])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].device, 'device-a', 'attributed to the device that wrote it')
})

test('own needs no member list, which is what makes it complete rather than eventual', async () => {
  // `devices()` is the member list and it arrives over a network. The declaration
  // says `own()` is complete; that can only be true if it never asks. So the
  // substrate here refuses the question, and `own()` still answers while
  // `entries()` fails — which is the difference stated as behaviour rather than as
  // a sentence in a description.
  const peer = substrate('device-a')
  const built = feed(peer, 'feed-1', 'send')
  await checked(built, 'append', ['recorded before the network went away'])

  peer.devices = async () => { throw new Error('the member list is not available') }

  const own = await checked(built, 'own', [])
  assert.equal(own.length, 1, 'own answered with no member list at all')
  assert.equal(own[0].device, 'device-a')

  let caught = null
  try { await built.methods.entries() } catch (err) { caught = err }
  assert.notEqual(caught, null, 'entries does depend on the member list, or this case proves nothing')
  threw(caught)
  assert.ok(/member list/.test(caught.message), caught.message)
})

test('a feed is scoped to one artifact, and another artifact s is a different log', async () => {
  // The scoping itself is `chain.js`'s `NATIVE` decision and does not live here —
  // what lives here is that the artifact name really does reach the cores, so two
  // instances minted for two artifacts over one substrate do not read each other.
  const peer = substrate('device-a')
  const send = feed(peer, 'feed-send', 'send')
  const notes = feed(peer, 'feed-notes', 'notes')

  await checked(send, 'append', ['for send'])

  assert.equal((await checked(send, 'entries', [])).length, 1)
  assert.equal((await checked(notes, 'entries', [])).length, 0, 'notes is reading a log nobody wrote')
  assert.equal((await checked(notes, 'own', [])).length, 0)
})

/* ─────────────────── the declaration is the shipped one ─────────────────── */

test('the shipped declaration is parsed, frozen, and in the platform namespace', () => {
  // The case that would notice this file testing a shape of its own invention, and
  // the case that would notice the declaration having stopped going through
  // `artifact-protocol`'s parser — which is what makes it the same kind of object
  // a manifest's declaration is, rather than an object literal that looks like one.
  assert.equal(ID.startsWith('platform:'), true)
  assert.equal(Object.isFrozen(DECLARATION), true, 'a consumer could edit the platform\'s promise')

  // `parseShape` normalises and refuses; re-parsing what it produced has to be a
  // fixed point, and if it throws then what the kernel resolves is not what this
  // package validated at load.
  const reparsed = contract.parseShape(DECLARATION.shape, `${ID}.shape`)
  assert.equal(JSON.stringify(reparsed), JSON.stringify(DECLARATION.shape),
    'the parsed shape is not stable under its own parser')

  // Every operation carries the two things `checkedCall` needs, or an operation is
  // declared and unenforceable — the state four contracts in this tree were in
  // before the platform declarations existed.
  for (const op of DECLARATION.shape.operations) {
    assert.ok(typeof op.description === 'string' && op.description.length > 0, `${op.name} has no description`)
    assert.ok(Array.isArray(op.params), `${op.name} has no params list`)
    assert.ok(op.returns !== undefined, `${op.name} declares no return value, so nothing checks what it answers`)
  }
})

/* ─────────────────────────────── run them ───────────────────────────────── */

async function main () {
  t.plan(cases.length)
  for (const [name, fn] of cases) {
    try { await fn(); t.pass(name) } catch (err) { t.fail(`${name} — ${err instanceof Error ? err.message : err}`) }
  }
}

main()
