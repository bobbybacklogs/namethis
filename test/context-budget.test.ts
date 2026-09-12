import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  estimatePromptTokens,
  estimateTokens,
  scanCharBudget,
  truncateToCharBudget,
} from '../src/context-budget.js';
import { formatScanContext } from '../src/scanner.js';
import type { ProjectScanResult } from '../src/scanner.js';

describe('context budget', () => {
  it('uses a compact budget for ollama 4k models', () => {
    const budget = scanCharBudget('ollama', 'deepseek-r1:7b');
    assert.ok(budget > 0);
    assert.ok(budget < 12000);
  });

  it('truncates formatted scan context to the requested char budget', () => {
    const scan: ProjectScanResult = {
      targetDir: '/tmp/demo',
      dirName: 'demo',
      detectedFiles: ['a.ts'],
      fileTreeSummary: ['a.ts'],
      languages: ['TypeScript'],
      crawlEnabled: true,
      readmeSnippet: 'x'.repeat(5000),
      crawlFileSnippets: [{ path: 'src/a.ts', excerpt: 'y'.repeat(5000) }],
    };

    const budget = scanCharBudget('ollama', 'deepseek-r1:7b');
    const formatted = formatScanContext(scan, { maxChars: budget });

    assert.ok(formatted.length <= budget);
    assert.match(formatted, /context truncated for model context limits/);
  });

  it('keeps a 4k ollama prompt under the context window', () => {
    const scan: ProjectScanResult = {
      targetDir: '/tmp/demo',
      dirName: 'demo',
      detectedFiles: Array.from({ length: 40 }, (_, i) => `src/file${i}.ts`),
      fileTreeSummary: Array.from({ length: 40 }, (_, i) => `src/file${i}.ts`),
      languages: ['TypeScript'],
      crawlEnabled: true,
      crawlFileSnippets: Array.from({ length: 12 }, (_, i) => ({
        path: `src/file${i}.ts`,
        excerpt: `export const payload${i} = '${'z'.repeat(900)}';`,
      })),
    };

    const systemInstructions = 'system '.repeat(200);
    const promptTemplate = 'prompt '.repeat(200);
    const scannedContext = formatScanContext(scan, {
      maxChars: scanCharBudget('ollama', 'deepseek-r1:7b'),
    });

    const totalTokens = estimatePromptTokens({
      systemInstructions,
      promptTemplate,
      scannedContext,
    });

    assert.ok(totalTokens < 4096);
    assert.ok(estimateTokens(truncateToCharBudget(scannedContext, 1000)) <= 250);
  });
});
