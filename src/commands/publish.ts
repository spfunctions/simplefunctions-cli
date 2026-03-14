/**
 * sf publish / sf unpublish
 *
 * Publish a thesis for public viewing or remove it from public.
 */

import { SFClient } from '../client.js'

/** Convert any string to a URL-safe slug: lowercase, hyphens, strip invalid chars */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')  // remove non-alphanumeric except spaces/hyphens
    .replace(/[\s_]+/g, '-')        // spaces/underscores → hyphens
    .replace(/-+/g, '-')            // collapse multiple hyphens
    .replace(/^-|-$/g, '')          // trim leading/trailing hyphens
    .slice(0, 60)                   // max 60 chars
}

export async function publishCommand(
  thesisId: string,
  opts: { slug: string; description?: string; apiKey?: string; apiUrl?: string }
) {
  const slug = slugify(opts.slug)
  if (slug.length < 3) {
    console.error(`\n  Error: slug too short after normalization: "${slug}" (need 3+ chars)\n`)
    process.exit(1)
  }
  if (slug !== opts.slug) {
    console.log(`  Slug normalized: "${opts.slug}" → "${slug}"`)
  }
  const client = new SFClient(opts.apiKey, opts.apiUrl)
  await client.publish(thesisId, slug, opts.description)
  console.log(`\n  ✓ Published: https://simplefunctions.dev/thesis/${slug}\n`)
}

export async function unpublishCommand(
  thesisId: string,
  opts: { apiKey?: string; apiUrl?: string }
) {
  const client = new SFClient(opts.apiKey, opts.apiUrl)
  await client.unpublish(thesisId)
  console.log(`\n  ✓ Unpublished thesis ${thesisId}\n`)
}
