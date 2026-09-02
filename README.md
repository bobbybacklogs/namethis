# namethis

<p align="center">
  <img src="./repo_assets/lockup.png" alt="namethis lockup" width="480" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@genoventures-labs/namethis"><img src="https://img.shields.io/npm/v/@genoventures-labs/namethis.svg?style=flat-square&color=00d26a" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@genoventures-labs/namethis"><img src="https://img.shields.io/npm/dt/@genoventures-labs/namethis.svg?style=flat-square&color=1e90ff" alt="npm downloads" /></a>
  <a href="https://github.com/bobbybacklogs/namethis/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="license" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg?style=flat-square" alt="node version" /></a>
</p>

`namethis` is a lightweight, repo-aware naming tool that looks at the project in your current directory, figures out what you’re building, and suggests 2–3 strong names with a short rationale for each.

It uses RoundRobin to route across free Zen models, giving you quick, grounded naming suggestions without leaving your terminal or overthinking the prompt.

---

## Highlights

- **Repo-Aware Context**: Automatically analyzes project structure, file signatures, manifests, and documentation.
- **Grounded Suggestions**: Curates 2–3 strong, realistic name options (avoiding generic AI buzzwords or cliché patterns).
- **Free Model Routing**: Built on top of RoundRobin for automatic rotation across free models with local Ollama fallback.
- **Clean CLI Experience**: Monospace, distraction-free terminal formatting with zero emojis.
- **Dual Support**: Use directly from your terminal with `npx` or import programmatically in TypeScript / JavaScript.

---

## Quick Start

### Run instantly with `npx`

```bash
npx @genoventures-labs/namethis
```

### Install globally

```bash
npm install -g @genoventures-labs/namethis
```

### Add to a project

```bash
npm install @genoventures-labs/namethis
```

---

## Usage

Run `namethis` inside any project directory:

```bash
namethis
```

Or target a specific directory:

```bash
namethis ./path/to/project
```

### Common Options

| Option | Description |
|---|---|
| `-c, --count <n>` | Number of name candidates (default: 3) |
| `--context <text>` | Extra background, audience, or product nuances |
| `--inspect` | Preview scanned files and metadata without querying models |
| `--json` | Return output in raw JSON format |
| `-h, --help` | Show full help menu |

### Examples

**Add positioning context:**
```bash
namethis --context "High-throughput database migration runner for PostgreSQL"
```

**Generate 5 candidate options:**
```bash
namethis -c 5
```

**Inspect parsed repo context:**
```bash
namethis --inspect
```

---

## Programmatic API

```typescript
import { generateNames } from '@genoventures-labs/namethis';

const result = await generateNames({
  cwd: './my-app',
  count: 3
});

for (const item of result.suggestions) {
  console.log(`${item.name}: ${item.rationale}`);
}
```

---

## License

[MIT](LICENSE)
