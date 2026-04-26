# Website

React + Vite + Hono + Tailwind + Node.js local server

## Project Structure

- `src/web/` — React frontend: pages, components, styles, hooks
- `src/api/` — Hono API server (`/api/*`)
- `public/` — Static assets (favicon, og-image, logo)
- `server.ts` — Local Node server that serves the API and the built frontend

## Quick Start

```bash
# Install dependencies
npm install

# Build the frontend
npm run build

# Start the local server
npm run start
```

The app will run at `http://localhost:3000` by default.

## Dev Mode

```bash
npm run dev
```

`dev` runs the same Node server through `tsx`.

## Routing

Client-side routing uses [wouter](https://github.com/molefrog/wouter). Add routes in `src/web/app.tsx`:

```tsx
import { Route, Switch } from "wouter";

<Switch>
  <Route path="/" component={Home} />
  <Route path="/about" component={About} />
</Switch>
```

## API

Backend uses [Hono](https://hono.dev/) on Node.js. All routes are mounted under `/api/*` in `src/api/index.ts`.

```ts
app.get('/ping', (c) => c.json({ message: 'Hello' }));
```

## Config

`website.config.json` contains the site name, description, and URL — use it as the source of truth for site-wide values.

## Agent Rules

**CRITICAL: This project uses Tailwind CSS v4.** No `tailwind.config.js`, no `postcss.config.js`, no `@tailwind` directives. All configuration is CSS-first via `@theme` in `src/web/styles.css` and the `@tailwindcss/vite` plugin. Do NOT use Tailwind v3 syntax.

**IMPORTANT: Don't assume how a package works from memory.** Check the installed version in `package.json` and read docs in `node_modules/<pkg>/` before using any package. APIs change between major versions — guessing leads to broken code.
