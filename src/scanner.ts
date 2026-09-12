import fs from 'node:fs';
import path from 'node:path';

export interface CrawlFileSnippet {
  path: string;
  excerpt: string;
}

export interface ScanOptions {
  crawl?: boolean;
}

export interface ProjectScanResult {
  targetDir: string;
  dirName: string;
  packageJson?: {
    name?: string;
    description?: string;
    keywords?: string[];
    dependencies?: Record<string, string>;
    bin?: string | Record<string, string>;
  };
  cargoToml?: string;
  pyprojectToml?: string;
  readmeSnippet?: string;
  detectedFiles: string[];
  fileTreeSummary: string[];
  languages: string[];
  crawlEnabled?: boolean;
  crawlFileSnippets?: CrawlFileSnippet[];
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'target',
  '.turbo',
  'coverage',
  '.cache',
  'vendor',
  'venv',
  '.venv',
  '__pycache__',
  '.system_generated',
]);

const DEFAULT_MAX_SCAN_DEPTH = 3;
const DEFAULT_MAX_FILES_LISTED = 60;
const CRAWL_MAX_SCAN_DEPTH = 6;
const CRAWL_MAX_FILES_LISTED = 150;
const CRAWL_MAX_SNIPPETS = 25;
const CRAWL_MAX_FILE_BYTES = 2000;
const CRAWL_MAX_TOTAL_BYTES = 30000;
const MAX_README_CHARS = 1200;

const CONTENT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.rb',
  '.php',
  '.java',
  '.kt',
  '.swift',
  '.cs',
  '.md',
  '.txt',
  '.yaml',
  '.yml',
  '.toml',
  '.json',
]);

const MANIFEST_BASENAMES = new Set([
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'setup.py',
  'requirements.txt',
  'composer.json',
  'Gemfile',
  'Makefile',
  'Dockerfile',
]);

const ENTRYPOINT_BASENAMES = new Set([
  'index.ts',
  'index.js',
  'main.ts',
  'main.js',
  'main.py',
  'lib.rs',
  'main.go',
  'app.py',
  'server.ts',
  'server.js',
  'cli.ts',
  'cli.js',
]);

const README_BASENAMES = new Set(['readme.md', 'readme', 'readme.txt']);

function isReadmeFile(name: string): boolean {
  return README_BASENAMES.has(name.toLowerCase());
}

function detectLanguage(ext: string, languageSet: Set<string>): void {
  if (['.ts', '.tsx'].includes(ext)) languageSet.add('TypeScript');
  else if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) languageSet.add('JavaScript');
  else if (['.py'].includes(ext)) languageSet.add('Python');
  else if (['.rs'].includes(ext)) languageSet.add('Rust');
  else if (['.go'].includes(ext)) languageSet.add('Go');
  else if (['.rb'].includes(ext)) languageSet.add('Ruby');
  else if (['.php'].includes(ext)) languageSet.add('PHP');
  else if (['.java', '.kt'].includes(ext)) languageSet.add('JVM (Java/Kotlin)');
  else if (['.swift'].includes(ext)) languageSet.add('Swift');
  else if (['.c', '.cpp', '.h', '.hpp'].includes(ext)) languageSet.add('C/C++');
  else if (['.cs'].includes(ext)) languageSet.add('C#');
  else if (['.html', '.css', '.scss'].includes(ext)) languageSet.add('Web frontend');
}

function crawlPriority(relPath: string): number {
  const base = path.basename(relPath);
  const lower = base.toLowerCase();
  if (isReadmeFile(lower)) return 0;
  if (MANIFEST_BASENAMES.has(base)) return 1;
  if (ENTRYPOINT_BASENAMES.has(base)) return 2;
  if (base.endsWith('.test.ts') || base.endsWith('.test.js') || base.endsWith('_test.py')) return 5;
  return 3;
}

function shouldReadContent(relPath: string, crawl: boolean): boolean {
  if (!crawl) return false;
  const base = path.basename(relPath);
  const ext = path.extname(base).toLowerCase();
  if (isReadmeFile(base.toLowerCase())) return true;
  if (MANIFEST_BASENAMES.has(base)) return true;
  if (ENTRYPOINT_BASENAMES.has(base)) return true;
  return CONTENT_EXTENSIONS.has(ext);
}

function readFileExcerpt(absolutePath: string, maxBytes: number): string | undefined {
  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() || stat.size === 0) return undefined;
    const fd = fs.openSync(absolutePath, 'r');
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    return buffer.slice(0, bytesRead).toString('utf8').trim();
  } catch {
    return undefined;
  }
}

function collectCrawlSnippets(
  targetDir: string,
  candidatePaths: string[],
  maxSnippets: number,
  maxFileBytes: number,
  maxTotalBytes: number
): CrawlFileSnippet[] {
  const sorted = [...candidatePaths].sort((a, b) => crawlPriority(a) - crawlPriority(b));
  const snippets: CrawlFileSnippet[] = [];
  let totalBytes = 0;

  for (const relPath of sorted) {
    if (snippets.length >= maxSnippets || totalBytes >= maxTotalBytes) break;
    const remaining = maxTotalBytes - totalBytes;
    if (remaining <= 0) break;

    const excerpt = readFileExcerpt(
      path.join(targetDir, relPath),
      Math.min(maxFileBytes, remaining)
    );
    if (!excerpt) continue;

    snippets.push({ path: relPath, excerpt });
    totalBytes += excerpt.length;
  }

  return snippets;
}

export async function scanDirectory(
  targetDir: string,
  options: ScanOptions = {}
): Promise<ProjectScanResult> {
  const crawl = Boolean(options.crawl);
  const resolvedPath = path.resolve(targetDir);
  const dirName = path.basename(resolvedPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Directory does not exist: ${resolvedPath}`);
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolvedPath}`);
  }

  let packageJson: ProjectScanResult['packageJson'];
  let cargoToml: string | undefined;
  let pyprojectToml: string | undefined;
  let readmeSnippet: string | undefined;

  const pkgPath = path.join(resolvedPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const raw = fs.readFileSync(pkgPath, 'utf8');
      const parsed = JSON.parse(raw);
      packageJson = {
        name: parsed.name,
        description: parsed.description,
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : undefined,
        dependencies: parsed.dependencies
          ? Object.fromEntries(
              Object.keys(parsed.dependencies)
                .slice(0, 15)
                .map((k) => [k, parsed.dependencies[k]])
            )
          : undefined,
        bin: parsed.bin,
      };
    } catch {
      // Ignore parse failure
    }
  }

  const cargoPath = path.join(resolvedPath, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    try {
      cargoToml = fs.readFileSync(cargoPath, 'utf8').slice(0, 500);
    } catch {
      // Ignore
    }
  }

  const pyPath = path.join(resolvedPath, 'pyproject.toml');
  if (fs.existsSync(pyPath)) {
    try {
      pyprojectToml = fs.readFileSync(pyPath, 'utf8').slice(0, 500);
    } catch {
      // Ignore
    }
  }

  const readmeCandidates = ['README.md', 'README', 'readme.md', 'Readme.md', 'README.txt'];
  for (const candidate of readmeCandidates) {
    const full = path.join(resolvedPath, candidate);
    if (fs.existsSync(full)) {
      try {
        const content = fs.readFileSync(full, 'utf8');
        readmeSnippet = content.trim().slice(0, MAX_README_CHARS);
        break;
      } catch {
        // Ignore
      }
    }
  }

  const maxDepth = crawl ? CRAWL_MAX_SCAN_DEPTH : DEFAULT_MAX_SCAN_DEPTH;
  const maxFiles = crawl ? CRAWL_MAX_FILES_LISTED : DEFAULT_MAX_FILES_LISTED;

  const detectedFiles: string[] = [];
  const fileTreeSummary: string[] = [];
  const languageSet = new Set<string>();
  const crawlCandidates: string[] = [];

  function walk(currentDir: string, currentDepth: number, relativePrefix: string = '') {
    if (currentDepth > maxDepth || detectedFiles.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (detectedFiles.length >= maxFiles) break;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const relPath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        fileTreeSummary.push(`${relPath}/`);
        walk(path.join(currentDir, entry.name), currentDepth + 1, relPath);
      } else {
        detectedFiles.push(relPath);
        fileTreeSummary.push(relPath);

        const ext = path.extname(entry.name).toLowerCase();
        detectLanguage(ext, languageSet);

        if (shouldReadContent(relPath, crawl)) {
          crawlCandidates.push(relPath);
        }
      }
    }
  }

  walk(resolvedPath, 1, '');

  const crawlFileSnippets = crawl
    ? collectCrawlSnippets(
        resolvedPath,
        crawlCandidates,
        CRAWL_MAX_SNIPPETS,
        CRAWL_MAX_FILE_BYTES,
        CRAWL_MAX_TOTAL_BYTES
      )
    : undefined;

  return {
    targetDir: resolvedPath,
    dirName,
    packageJson,
    cargoToml,
    pyprojectToml,
    readmeSnippet,
    detectedFiles,
    fileTreeSummary,
    languages: Array.from(languageSet),
    ...(crawl ? { crawlEnabled: true as const } : {}),
    crawlFileSnippets,
  };
}

export function formatScanContext(scan: ProjectScanResult, customContext?: string): string {
  const parts: string[] = [];

  parts.push(`Target Directory: ${scan.dirName}`);

  if (scan.crawlEnabled) {
    parts.push('Scan Mode: deep crawl (bounded tree walk with file excerpts)');
  }

  if (scan.languages.length > 0) {
    parts.push(`Identified Tech/Languages: ${scan.languages.join(', ')}`);
  }

  if (scan.packageJson) {
    const pkg = scan.packageJson;
    const pkgDetails: string[] = [];
    if (pkg.name) pkgDetails.push(`Name: ${pkg.name}`);
    if (pkg.description) pkgDetails.push(`Description: ${pkg.description}`);
    if (pkg.keywords && pkg.keywords.length) pkgDetails.push(`Keywords: ${pkg.keywords.join(', ')}`);
    if (pkg.dependencies) pkgDetails.push(`Key Dependencies: ${Object.keys(pkg.dependencies).join(', ')}`);
    if (pkg.bin) pkgDetails.push(`Has CLI bin definition: yes`);
    if (pkgDetails.length > 0) {
      parts.push(`package.json Manifest:\n${pkgDetails.map((d) => `  - ${d}`).join('\n')}`);
    }
  }

  if (scan.cargoToml) {
    parts.push(`Cargo.toml excerpt:\n${scan.cargoToml}`);
  }

  if (scan.pyprojectToml) {
    parts.push(`pyproject.toml excerpt:\n${scan.pyprojectToml}`);
  }

  if (scan.readmeSnippet) {
    parts.push(`README Content Excerpt:\n${scan.readmeSnippet}`);
  }

  if (scan.fileTreeSummary.length > 0) {
    const treeLimit = scan.crawlEnabled ? 50 : 35;
    parts.push(
      `Key Files & Folders (${scan.fileTreeSummary.length} scanned):\n${scan.fileTreeSummary
        .slice(0, treeLimit)
        .map((f) => `  ${f}`)
        .join('\n')}`
    );
  }

  if (scan.crawlFileSnippets && scan.crawlFileSnippets.length > 0) {
    const snippetBlocks = scan.crawlFileSnippets.map(
      (snippet) => `  ${snippet.path}:\n${snippet.excerpt.replace(/\n/g, '\n    ')}`
    );
    parts.push(
      `Crawled File Excerpts (${scan.crawlFileSnippets.length} files):\n${snippetBlocks.join('\n\n')}`
    );
  }

  if (customContext) {
    parts.push(`Additional User Provided Context:\n${customContext}`);
  }

  return parts.join('\n\n');
}
