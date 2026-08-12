/**
 * Types for the two things this repo's own program needs and which ship none.
 *
 * Deliberately *not* referenced from any shipping file, and that is the decision
 * in this file worth arguing. `artifact-lan` pulls its vendor modules in through
 * a `.d.ts` its source references, so the declarations travel with the code to
 * whichever consumer type-checks it through a `file:` link. Copying that here
 * would **break** the consumer it was meant to help: `ArtifactPatform` declares
 * `bare-buffer`'s global and `bare-tap` in its own `vendor.d.ts` already, and a
 * second ambient declaration for one specifier is a duplicate the consumer cannot
 * edit its way out of. `artifact-secrets/vendor.d.ts` states the same rule and
 * settled it the same way.
 *
 * So this file covers this repo's own program only, which is why the kernel needed
 * no edit to type-check `lib/feed.js` through its `file:../platform-feed` link.
 *
 * Nothing here declares `artifact-protocol`: it ships its own `.d.ts` set and its
 * `exports` names them under a `types` condition, so `lib/declaration.js` is
 * checked against the real `parseShape` and the real `Shape`. That is the whole of
 * the vendor surface a capability with no socket, no store and no key in it has.
 *
 * `bare-assert` is shadowed below, which is the one call in this file that goes
 * against `artifact-secrets/vendor.d.ts`'s advice; the note on it says why the
 * shipped declaration could not be used as it stands.
 */

/// <reference types="bare-buffer/global" />

/**
 * The test runner, at the three methods the suite uses.
 *
 * `plan`, `pass`, `fail` — the suite collects its cases into an array, plans the
 * length and reports each one; the assertions themselves are `bare-assert`'s.
 * Copied narrow from `ArtifactPatform/vendor.d.ts` rather than widened, and for
 * its stated reason: declaring `equal` or `subtest` as well would invite a case to
 * start using the runner's assertions, which report a plan count and not a diff.
 */
declare module 'bare-tap' {
  class TAP {
    plan (n: number): void
    pass (message?: string): void
    fail (message?: string): void
  }
  const t: TAP
  export = t
}

/**
 * `bare-assert` *does* ship an `index.d.ts`, and it is incomplete in the one way that
 * matters here: the runtime's `ok` narrows a value and the declaration types it as
 * returning `void`. Every helper in this suite that says "fail loudly rather than
 * return undefined" is built on `assert.ok(x !== undefined, ...)`, and without the
 * `asserts` form the thing it just proved present is still `T | undefined` at every
 * use — which means a cast or a `?.` on each line, and a `?.` is exactly the silent
 * skip those helpers exist to prevent.
 *
 * An ambient declaration shadows the package's own types wholesale, which is a
 * bigger hammer than a module augmentation; augmenting an `export =` namespace needs
 * a second module-scoped `.d.ts`, and this repo keeps its vendor types in one file
 * exactly as `ArtifactPatform` and `artifact-planner` do. So the shadow is
 * deliberate and this copy is `artifact-planner`'s, unnarrowed: a looser copy of a
 * declaration whose job is to catch a mistyped assertion name would make the strict
 * one pointless on the path that matters.
 */
declare module 'bare-assert' {
  function assert (value: any, message?: string | Error): asserts value
  namespace assert {
    class AssertionError extends Error {
      constructor (opts?: { message?: string, actual?: any, expected?: any, operator?: string })
      actual?: any
      expected?: any
      operator?: string
    }
    function ok (value: any, message?: string | Error): asserts value
    function notOk (value: any, message?: string | Error): void
    function fail (message?: string | Error): void
    function equal (actual: any, expected: any, message?: string | Error): void
    function notEqual (actual: any, expected: any, message?: string | Error): void
    function strictEqual (actual: any, expected: any, message?: string | Error): void
    function notStrictEqual (actual: any, expected: any, message?: string | Error): void
  }
  export = assert
}
