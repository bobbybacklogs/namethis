#!/usr/bin/env node

import { Command } from 'commander';
import dotenv from 'dotenv';
import path from 'node:path';
import pc from 'picocolors';
import { NameThisEngine } from './engine.js';
import { scanDirectory } from './scanner.js';
import {
  renderHeader,
  renderScanSummary,
  renderProgress,
  renderEvent,
  renderSuggestions,
  renderError
} from './ui.js';

dotenv.config({ quiet: true });

const VERSION = '0.2.1';

const program = new Command();

program
  .name('namethis')
  .description(
    'A lightweight, repo-aware naming tool that infers top 2-3 names with a short rationale from your current directory or specified path.'
  )
  .version(VERSION, '-v, --version', 'Output current version')
  .argument('[dir]', 'Directory path to analyze', '.')
  .option('-c, --count <number>', 'Number of name suggestions to generate (default: 3)', '3')
  .option('--context <text>', 'Additional context, target audience, or requirements')
  .option('-k, --key <api-key>', 'AI Gateway API key (or set AI_GATEWAY_API_KEY env)')
  .option('-p, --provider <provider>', 'Primary ModelHitch provider (default: vercel-ai-gateway)')
  .option('-m, --model <model>', 'Specific model override (e.g. openai/gpt-5.4)')
  .option('-t, --temperature <number>', 'Temperature for generation (default: 0.7)', '0.7')
  .option('--ollama <host>', 'Custom Ollama host for local fallback (default: http://localhost:11434)')
  .option('--ollama-model <model>', 'Ollama model tag used on local fallback (default: llama3.2)')
  .option('--json', 'Output results purely in JSON format for scripting/piping')
  .option('--inspect', 'Only inspect and print scanned directory context without making LLM calls')
  .option('--crawl', 'Deep-crawl the directory tree for richer naming context (bounded depth, file count, and size)')
  .helpOption('-h, --help', 'Display help menu');

program.action(async (dir: string, options: Record<string, unknown>) => {
  const isJson = Boolean(options.json);
  const targetDir = path.resolve((dir as string) || '.');

  try {
    const crawl = Boolean(options.crawl);

    if (options.inspect) {
      const scan = await scanDirectory(targetDir, { crawl });
      if (isJson) {
        console.log(JSON.stringify(scan, null, 2));
      } else {
        renderHeader();
        renderScanSummary(scan);
        console.log(`  ${pc.bold('Scanned Files Sample:')}`);
        scan.detectedFiles.slice(0, 20).forEach((f) => console.log(`    ${pc.gray('•')} ${f}`));
        if (scan.readmeSnippet) {
          console.log(`\n  ${pc.bold('Readme Excerpt:')}`);
          console.log(`    ${pc.gray(scan.readmeSnippet.replace(/\n/g, '\n    '))}`);
        }
        if (scan.crawlFileSnippets && scan.crawlFileSnippets.length > 0) {
          console.log(`\n  ${pc.bold('Crawled File Excerpts:')}`);
          for (const snippet of scan.crawlFileSnippets.slice(0, 5)) {
            console.log(`    ${pc.gray('•')} ${snippet.path}`);
            console.log(`      ${pc.gray(snippet.excerpt.slice(0, 120).replace(/\n/g, ' '))}${snippet.excerpt.length > 120 ? '…' : ''}`);
          }
          if (scan.crawlFileSnippets.length > 5) {
            console.log(`    ${pc.dim(`…and ${scan.crawlFileSnippets.length - 5} more excerpts`)}`);
          }
        }
        console.log('\n');
      }
      return;
    }

    if (!isJson) {
      renderHeader();
    }

    const count = parseInt(String(options.count), 10) || 3;
    const temperature = parseFloat(String(options.temperature)) || 0.7;

    const engine = new NameThisEngine({
      apiKey: options.key as string | undefined,
      provider: options.provider as string | undefined,
      model: options.model as string | undefined,
      ollamaHost: options.ollama as string | undefined,
      ollamaModel: options.ollamaModel as string | undefined,
    });

    if (!isJson) {
      const scan = await scanDirectory(targetDir, { crawl });
      renderScanSummary(scan);
      renderProgress(`Inferring ${count} grounded names with ModelHitch...`);
    }

    const result = await engine.generateNames({
      cwd: targetDir,
      count,
      crawl,
      context: options.context as string | undefined,
      apiKey: options.key as string | undefined,
      provider: options.provider as string | undefined,
      model: options.model as string | undefined,
      temperature,
      ollamaHost: options.ollama as string | undefined,
      ollamaModel: options.ollamaModel as string | undefined,
      onFailover: (event) => {
        if (!isJson) {
          const reason = event.error.message || event.error.code;
          renderEvent(
            'rotation',
            `${event.from.providerId}/${event.from.model} -> ${event.to.providerId}/${event.to.model} (${reason})`
          );
          if (event.to.providerId === 'ollama') {
            renderEvent('ollama', `Switched to Ollama (${event.to.model})`);
          }
        }
      },
      onExhausted: (info) => {
        if (!isJson) {
          const last = info.attempts[info.attempts.length - 1];
          const detail = last
            ? `${last.target.providerId}/${last.target.model}: ${last.error.message}`
            : 'all lanes failed';
          renderEvent('exhausted', detail);
        }
      },
    });

    if (!isJson && result.providerUsed === 'ollama') {
      renderEvent('ollama', `Using ${result.providerUsed}/${result.modelUsed}`);
    }

    if (isJson) {
      console.log(
        JSON.stringify(
          {
            directory: result.scan.dirName,
            stack: result.scan.languages,
            model: result.modelUsed,
            provider: result.providerUsed,
            suggestions: result.suggestions,
          },
          null,
          2
        )
      );
    } else {
      renderSuggestions(result.suggestions, {
        model: result.modelUsed,
        provider: result.providerUsed,
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (isJson) {
      console.error(JSON.stringify({ error: message }));
    } else {
      renderError(
        message || 'An unexpected error occurred',
        'Set AI_GATEWAY_API_KEY (or run `vercel login`), pass --key, or ensure a local Ollama instance is reachable.'
      );
    }
    process.exit(1);
  }
});

program
  .command('models')
  .description('List ModelHitch providers and discoverable models')
  .option('-p, --provider <provider>', 'Only list models for a specific provider')
  .option('-k, --key <api-key>', 'AI Gateway API key (or set AI_GATEWAY_API_KEY env)')
  .option('--ollama <host>', 'Custom Ollama host (default: http://localhost:11434)')
  .action(async (options: Record<string, unknown>) => {
    try {
      const engine = new NameThisEngine({
        apiKey: options.key as string | undefined,
        ollamaHost: options.ollama as string | undefined,
      });

      renderHeader();
      console.log(`  ${pc.bold('MODELHITCH PROVIDERS')}`);
      console.log(`  ${pc.dim('─'.repeat(50))}`);
      for (const provider of engine.listProviders()) {
        console.log(`  ${pc.green('[READY]')} ${pc.bold(pc.white(provider.id))}`);
      }

      console.log(`\n  ${pc.bold('DISCOVERED MODELS')}`);
      console.log(`  ${pc.dim('─'.repeat(50))}`);
      const listings = await engine.listModels(options.provider as string | undefined);
      for (const listing of listings) {
        if (listing.models.length === 0) {
          console.log(`  ${pc.dim(listing.providerId)} ${pc.gray('(none discovered / unavailable)')}`);
          continue;
        }
        console.log(`  ${pc.bold(listing.providerId)}`);
        for (const model of listing.models.slice(0, 20)) {
          const name = model.name ? pc.dim(`— ${model.name}`) : '';
          console.log(`    ${pc.white(model.id)} ${name}`);
        }
        if (listing.models.length > 20) {
          console.log(`    ${pc.dim(`…and ${listing.models.length - 20} more`)}`);
        }
      }
      console.log(`  ${pc.dim('─'.repeat(50))}\n`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      renderError(message, 'Gateway listing needs AI_GATEWAY_API_KEY; Ollama listing needs a running Ollama host.');
      process.exit(1);
    }
  });

program.parse(process.argv);
