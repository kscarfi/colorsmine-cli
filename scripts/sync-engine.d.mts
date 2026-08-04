/**
 * Types for the two helpers the drift test borrows from sync-engine.mjs.
 *
 * The script stays plain JS — it is a build tool, not shipped code — but the
 * test must apply exactly the same banner-stripping and import-rewriting rules
 * the sync applies, or it would be checking against a different transform than
 * the one that produced the files. Without this the imports resolve as `any`
 * and the test would accept being called wrongly.
 */

/** Vendored file contents with the leading banner comment removed. */
export function bodyOf(vendored: string): string

/** App source rewritten the way it is stored under src/engine/. */
export function vendoredBody(upstream: string): string
