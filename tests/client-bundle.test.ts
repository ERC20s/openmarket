import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'

// The browser pages (everything under pages/ except pages/api) ship to the
// visitor. zod is the API routes' request validator (lib/validation.ts): it
// belongs on the server, and reaching it from a page adds the whole library to
// that page's bundle. This walks each page's static imports, the way the
// bundler does, and names any page that reaches it. `import type` is erased at
// build time, so it is not followed.

const ROOT = resolve(__dirname, '..')
const SERVER_ONLY = ['zod']

function pageFiles(dir: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (relative(ROOT, path) !== join('pages', 'api')) files.push(...pageFiles(path))
    } else if (/\.tsx?$/.test(name)) {
      files.push(path)
    }
  }
  return files
}

/** Module specifiers a file imports or re-exports at runtime. */
function runtimeImports(source: string): string[] {
  const specifiers: string[] = []
  const pattern = /^\s*(?:import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm
  for (const match of source.matchAll(pattern)) {
    if (match[1]) continue
    specifiers.push(match[2] ?? match[3])
  }
  return specifiers
}

function resolveLocal(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  throw new Error(`Cannot resolve ${specifier} from ${relative(ROOT, from)}`)
}

/** Every package a file reaches through its local imports, with the path that got there. */
function packagesReached(entry: string): Map<string, string[]> {
  const reached = new Map<string, string[]>()
  const seen = new Set<string>()
  const walk = (file: string, trail: string[]) => {
    if (seen.has(file)) return
    seen.add(file)
    const here = [...trail, relative(ROOT, file)]
    for (const specifier of runtimeImports(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) walk(resolveLocal(file, specifier), here)
      else if (!reached.has(specifier)) reached.set(specifier, here)
    }
  }
  walk(entry, [])
  return reached
}

describe('browser pages', () => {
  it('finds the pages and follows their local imports', () => {
    const pages = pageFiles(join(ROOT, 'pages')).map((file) => relative(ROOT, file))
    expect(pages).toContain(join('pages', 'checkout.tsx'))
    expect(pages.some((page) => page.startsWith(join('pages', 'api')))).toBe(false)
    // The walk does see through lib/: the API route reaches zod via lib/quote.ts.
    expect([...packagesReached(join(ROOT, 'pages', 'api', 'checkout.ts')).keys()]).toContain('zod')
  })

  it('never import a server-only package, directly or through lib/', () => {
    const offenders: string[] = []
    for (const page of pageFiles(join(ROOT, 'pages'))) {
      const reached = packagesReached(page)
      for (const pkg of SERVER_ONLY) {
        const trail = reached.get(pkg)
        if (trail) offenders.push(`${trail.join(' -> ')} -> ${pkg}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
