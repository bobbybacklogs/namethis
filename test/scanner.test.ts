import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { formatScanContext, scanDirectory } from '../src/scanner.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = path.join(projectRoot, 'test/fixtures/crawl-sample');

describe('scanDirectory', () => {
  it('uses surface scan by default', async () => {
    const scan = await scanDirectory(fixtureDir);

    assert.equal(scan.crawlEnabled, undefined);
    assert.equal(scan.crawlFileSnippets, undefined);
    assert.ok(scan.detectedFiles.includes('package.json'));
    assert.ok(scan.detectedFiles.includes('README.md'));
    assert.ok(!scan.detectedFiles.includes('src/lib/deep/nested/handler.ts'));
  });

  it('deep-crawls nested files when --crawl is enabled', async () => {
    const scan = await scanDirectory(fixtureDir, { crawl: true });

    assert.equal(scan.crawlEnabled, true);
    assert.ok(scan.detectedFiles.includes('src/index.ts'));
    assert.ok(scan.detectedFiles.includes('src/lib/processor.ts'));
    assert.ok(scan.detectedFiles.includes('src/lib/deep/nested/handler.ts'));
    assert.ok(scan.detectedFiles.includes('docs/guide.md'));
    assert.ok(scan.crawlFileSnippets && scan.crawlFileSnippets.length > 0);

    const excerptPaths = scan.crawlFileSnippets!.map((snippet) => snippet.path);
    assert.ok(excerptPaths.includes('src/index.ts'));
    assert.ok(
      scan.crawlFileSnippets!.some((snippet) => snippet.excerpt.includes('webhook ingestion'))
    );
  });

  it('includes crawled excerpts in formatted context', async () => {
    const scan = await scanDirectory(fixtureDir, { crawl: true });
    const context = formatScanContext(scan);

    assert.match(context, /Scan Mode: deep crawl/);
    assert.match(context, /Crawled File Excerpts/);
    assert.match(context, /src\/index\.ts/);
    assert.match(context, /webhook ingestion/);
  });

  it('does not include crawl excerpts in default formatted context', async () => {
    const scan = await scanDirectory(fixtureDir);
    const context = formatScanContext(scan);

    assert.doesNotMatch(context, /Scan Mode: deep crawl/);
    assert.doesNotMatch(context, /Crawled File Excerpts/);
  });

  it('respects crawl bounds for file count and total bytes', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'namethis-crawl-'));

    try {
      for (let i = 0; i < 40; i++) {
        const dir = path.join(tempDir, `pkg${i}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, `module${i}.ts`),
          `export const marker${i} = 'payload-${'x'.repeat(800)}';`
        );
      }

      const scan = await scanDirectory(tempDir, { crawl: true });

      assert.ok(scan.detectedFiles.length <= 150);
      assert.ok(scan.crawlFileSnippets && scan.crawlFileSnippets.length <= 25);

      const totalBytes = scan.crawlFileSnippets!.reduce(
        (sum, snippet) => sum + snippet.excerpt.length,
        0
      );
      assert.ok(totalBytes <= 8000);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

after(() => {
  // no-op: keeps node:test happy when this file is the entrypoint
});
