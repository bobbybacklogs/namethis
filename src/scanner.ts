import fs from 'node:fs';
import path from 'node:path';

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
  '.system_generated'
]);

const MAX_SCAN_DEPTH = 3;
const MAX_FILES_LISTED = 60;
const MAX_README_CHARS = 1200;

export async function scanDirectory(targetDir: string): Promise<ProjectScanResult> {
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

  // 1. Read package.json if present
  const pkgPath = path.join(resolvedPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const raw = fs.readFileSync(pkgPath, 'utf8');
      const parsed = JSON.parse(raw);
      packageJson = {
        name: parsed.name,
        description: parsed.description,
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : undefined,
        dependencies: parsed.dependencies ? Object.fromEntries(Object.keys(parsed.dependencies).slice(0, 15).map(k => [k, parsed.dependencies[k]])) : undefined,
        bin: parsed.bin
      };
    } catch {
      // Ignore parse failure
    }
  }

  // 2. Read Cargo.toml if present
  const cargoPath = path.join(resolvedPath, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    try {
      cargoToml = fs.readFileSync(cargoPath, 'utf8').slice(0, 500);
    } catch {
      // Ignore
    }
  }

  // 3. Read pyproject.toml / requirements.txt / setup.py
  const pyPath = path.join(resolvedPath, 'pyproject.toml');
  if (fs.existsSync(pyPath)) {
    try {
      pyprojectToml = fs.readFileSync(pyPath, 'utf8').slice(0, 500);
    } catch {
      // Ignore
    }
  }

  // 4. Read README.md or README
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

  // 5. Gather file structure
  const detectedFiles: string[] = [];
  const fileTreeSummary: string[] = [];
  const languageSet = new Set<string>();

  function walk(currentDir: string, currentDepth: number, relativePrefix: string = '') {
    if (currentDepth > MAX_SCAN_DEPTH || detectedFiles.length >= MAX_FILES_LISTED) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (detectedFiles.length >= MAX_FILES_LISTED) break;
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
    }
  }

  walk(resolvedPath, 1, '');

  return {
    targetDir: resolvedPath,
    dirName,
    packageJson,
    cargoToml,
    pyprojectToml,
    readmeSnippet,
    detectedFiles,
    fileTreeSummary,
    languages: Array.from(languageSet)
  };
}

export function formatScanContext(scan: ProjectScanResult, customContext?: string): string {
  const parts: string[] = [];

  parts.push(`Target Directory: ${scan.dirName}`);

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
      parts.push(`package.json Manifest:\n${pkgDetails.map(d => `  - ${d}`).join('\n')}`);
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
    parts.push(`Key Files & Folders (${scan.fileTreeSummary.length} scanned):\n${scan.fileTreeSummary.slice(0, 35).map(f => `  ${f}`).join('\n')}`);
  }

  if (customContext) {
    parts.push(`Additional User Provided Context:\n${customContext}`);
  }

  return parts.join('\n\n');
}
