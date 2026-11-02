// Test-only Node ESM resolve hook (module.register() customization hooks
// API, stable primitive since Node 20.6/22) — exists ONLY so a database-
// free proof-of-concept smoke check can import the real, unmodified
// src/app/api/internal/ingestion/run-batch/route.ts directly under plain
// `node --test`/`node -e`, without changing that file or any other
// production source. Activated only via an explicit `--import` flag on
// one ad hoc invocation (see the accompanying report) — never added to
// package.json, next.config.js, tsconfig.json, or any existing script.
//
// Design: ALWAYS try Node's own default resolution first. Only on a
// genuine ERR_MODULE_NOT_FOUND does this hook attempt one of three narrow,
// validated rescues; every other specifier (the overwhelming majority of
// the module graph) is returned by nextResolve() completely untouched —
// this hook can never override a specifier that would have resolved
// correctly on its own.
//
// Rescues attempted, in order, once default resolution has already failed:
//   1. "next/server" (exact match)       -> the real installed next/server.js
//      (next/package.json has no "exports" map, so plain Node cannot
//      resolve this subpath at all — confirmed by a prior, separately
//      reported import failure).
//   2. "@/..." (tsconfig path alias, prefix match) -> the matching file
//      under src/, probing (exact, .ts, .tsx, /index.ts).
//   3. A relative specifier ("./x" or "../x") with no working extension
//      (e.g. route.ts's own "./parseIngestionBatchRequest",
//      admin.ts's own "./env") -> probed the same way, resolved against
//      the importing file's own directory. Empirically proven necessary
//      by this exact smoke check (see the accompanying report) — not
//      speculative.
//
// Every rescue target is validated (assertInside) to resolve to a REAL
// file strictly inside either node_modules/next/ or this project's src/.
// For rule 3, the importing file's own directory must ALSO already be
// inside src/ before any probing happens, and the final probed path must
// still land inside src/ after Node's own ".."-collapsing path
// resolution — so a specifier that tried to climb out of src/ entirely
// would be refused, while a legitimate "../sibling" within src/ (the
// normal case) is allowed.
import { register } from "node:module";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const srcRoot = path.join(projectRoot, "src");
const nextPackageRoot = path.join(projectRoot, "node_modules", "next");

/** Throws unless `candidatePath` resolves to a real path on or under `baseDir`. */
function assertInside(baseDir, candidatePath) {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(candidatePath);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error(`resolve hook refused a target outside ${resolvedBase}: ${resolved}`);
  }
  return resolved;
}

function isInside(baseDir, candidatePath) {
  try {
    assertInside(baseDir, candidatePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * First candidate among [+'.ts', +'.tsx', exact, +'/index.ts'] that is a
 * REAL FILE (never a directory — existsSync() alone matches directories
 * too, which previously made this hook try to load a directory as a
 * module and crash with EISDIR; see the accompanying report).
 */
function probeFile(basePathNoExt) {
  const candidates = [`${basePathNoExt}.ts`, `${basePathNoExt}.tsx`, basePathNoExt, path.join(basePathNoExt, "index.ts")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Unreadable (permissions, race) — treat as not found, try the next candidate.
      }
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (!err || err.code !== "ERR_MODULE_NOT_FOUND") throw err;
  }

  // Default resolution already failed — only narrow, validated rescues below.

  if (specifier === "next/server") {
    const target = path.join(nextPackageRoot, "server.js");
    const safeTarget = assertInside(nextPackageRoot, target);
    if (!existsSync(safeTarget)) {
      throw new Error(`resolve hook: expected ${safeTarget} to exist but it does not`);
    }
    return { url: pathToFileURL(safeTarget).href, shortCircuit: true };
  }

  if (specifier.startsWith("@/")) {
    const rest = specifier.slice(2);
    const found = probeFile(path.join(srcRoot, rest));
    if (!found) {
      throw new Error(`resolve hook: could not find a file for "${specifier}" under ${srcRoot} (tried exact, .ts, .tsx, /index.ts)`);
    }
    const safeTarget = assertInside(srcRoot, found);
    return { url: pathToFileURL(safeTarget).href, shortCircuit: true };
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    if (!isInside(srcRoot, parentDir)) {
      throw new Error(`resolve hook: refusing extensionless-relative rescue — importing file is outside ${srcRoot}: ${parentDir}`);
    }
    const found = probeFile(path.resolve(parentDir, specifier));
    if (!found) {
      throw new Error(`resolve hook: could not find a file for relative specifier "${specifier}" from ${parentDir}`);
    }
    const safeTarget = assertInside(srcRoot, found);
    return { url: pathToFileURL(safeTarget).href, shortCircuit: true };
  }

  // No rescue applies — re-surface the original failure by trying the
  // default resolver again so the real Node error (unresolved specifier)
  // propagates unchanged, rather than this hook inventing its own.
  return nextResolve(specifier, context);
}

// Self-registers this same file as the active hooks module — a standard,
// documented pattern for a single-file loader (the --import preload step
// and the hooks module are the same file). Runs once, at --import preload
// time, before the smoke check's own import() calls.
register(import.meta.url, import.meta.url);
