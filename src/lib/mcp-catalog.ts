// ─── Curated MCP-SERVER CATALOG (Builder Epic #119) — PURE, zero-IO ───────────────────────────────
//
// The founder's ask: "there are 100s of open-source tools; some library/collection bundles them —
// go get those and bundle them for ease of use." The standard collection is MCP (Model Context
// Protocol) servers. This module is the CURATED, PURE catalog + the pure install-payload builder +
// the air-gap gating rule. It holds NO I/O — the browse-and-install UI (a thin route/component)
// consumes it, and the actual registered `mcp` tool is written through the EXISTING tool-create
// path (POST /api/v1/admin/tools). We do NOT duplicate tool storage; the catalog is static curated
// metadata + an "add" action that prefills the tool-create form.
//
// ── AIR-GAP SAFETY (non-negotiable, on-prem default = "nothing leaves the network") ──────────────
// MCP servers run on the OPERATOR'S network — the console never auto-connects out. Some servers
// (Brave Search, Fetch, Google Drive, Slack, GitHub, Sentry…) reach the PUBLIC INTERNET when they
// run. On an air-gapped deployment those need the operator to run/point at the server themselves;
// nothing here auto-reaches out. Every entry declares `reachesInternet` + an `airgapNote`, and the
// install action ALWAYS requires the operator to supply their own on-prem endpoint URL (the catalog
// only gives a hint + the install command). The pure `isInstallable`/`buildInstallPayload` rules
// enforce that an endpoint is present before a tool can be written.
//
// GROUNDED IN REAL SERVERS ONLY. Sources:
//   • Official reference servers — github.com/modelcontextprotocol/servers
//     (Fetch, Filesystem, Git, Memory, Sequential Thinking, Everything, Time, Postgres, SQLite,
//      Puppeteer, Brave Search, Slack, GitHub, Google Drive, Sentry).
//   • Registry — registry.modelcontextprotocol.io. Community lists — mcpservers.org, glama.ai, mcp.so.
// Nothing beyond these + clearly-known servers is invented.

// ─── Category — the group a server sorts under in the browse UI ───────────────────────────────────
export type McpCategory =
  | 'Filesystem & Dev'
  | 'Data & DB'
  | 'Web & Browse'
  | 'Search'
  | 'Comms'
  | 'Memory'
  | 'Productivity';

export const MCP_CATEGORIES: McpCategory[] = [
  'Filesystem & Dev',
  'Data & DB',
  'Web & Browse',
  'Search',
  'Comms',
  'Memory',
  'Productivity',
];

// ─── Transport — how the server speaks MCP ────────────────────────────────────────────────────────
// stdio: the console/agent launches the server as a local subprocess (endpoint = the launch command
//   the operator runs on-prem, e.g. `npx -y @modelcontextprotocol/server-filesystem /data`).
// http:  the server is a long-running HTTP/SSE endpoint the operator hosts on their network
//   (endpoint = the URL, e.g. `http://mcp-fetch.internal:8080/sse`).
export type McpTransport = 'stdio' | 'http';

// ─── McpServer — one curated MCP server ───────────────────────────────────────────────────────────
export interface McpServer {
  /** Stable id, used as the catalog key + prefilled tool name slug. */
  id: string;
  /** Human name shown in the catalog card. */
  name: string;
  category: McpCategory;
  /** Plain-language "what it does / when to use it" — for the non-technical operator. */
  description: string;
  /** Where to read more (the server's repo/homepage). Informational only — no auto-fetch. */
  homepage: string;
  /** How the server speaks MCP (stdio subprocess vs hosted http/sse). */
  transport: McpTransport;
  /** A sample endpoint the operator adapts to their own network — NOT auto-used. */
  defaultEndpointHint: string;
  /** True if RUNNING this server sends requests to the PUBLIC internet (air-gap relevant). */
  reachesInternet: boolean;
  /** A one-line note explaining the server's air-gap posture. */
  airgapNote: string;
  /** How the operator runs/installs the server on-prem (the command to copy). */
  install: string;
}

// ─── THE CATALOG — curated, real MCP servers grouped by category ──────────────────────────────────
export const MCP_SERVERS: McpServer[] = [
  // ── Filesystem & Dev ────────────────────────────────────────────────────────────────────────────
  {
    id: 'filesystem',
    name: 'Filesystem',
    category: 'Filesystem & Dev',
    description:
      'Read, write, and search files within directories you allow. Use it to let an app work with documents, spreadsheets, and files on your own storage.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    transport: 'stdio',
    defaultEndpointHint: 'npx -y @modelcontextprotocol/server-filesystem /data',
    reachesInternet: false,
    airgapNote: 'Local file operations only — never leaves your network. Safe on an air-gapped deploy.',
    install: 'npx -y @modelcontextprotocol/server-filesystem /path/to/allowed/dir',
  },
  {
    id: 'git',
    name: 'Git',
    category: 'Filesystem & Dev',
    description:
      'Read and search a Git repository — history, diffs, and file contents. Use it when an app needs to reason over a codebase you host.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    transport: 'stdio',
    defaultEndpointHint: 'npx -y @modelcontextprotocol/server-git --repository /repo',
    reachesInternet: false,
    airgapNote: 'Operates on a local repo path — no network egress. Safe on an air-gapped deploy.',
    install: 'npx -y @modelcontextprotocol/server-git --repository /path/to/repo',
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'Filesystem & Dev',
    description:
      'Manage GitHub issues, pull requests, and repositories. Use it to let an app triage issues or open PRs on GitHub.',
    homepage: 'https://github.com/github/github-mcp-server',
    transport: 'http',
    defaultEndpointHint: 'http://github-mcp.internal:8080/sse',
    reachesInternet: true,
    airgapNote:
      'Reaches GitHub over the internet. On an air-gapped deploy, point it at your GitHub Enterprise host or leave it off.',
    install: 'Run the GitHub MCP server with a GITHUB_TOKEN; host it on your network.',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'Filesystem & Dev',
    description:
      'Look up and analyze Sentry error reports and issues. Use it to let an app investigate production errors and stack traces.',
    homepage: 'https://github.com/getsentry/sentry-mcp',
    transport: 'http',
    defaultEndpointHint: 'http://sentry-mcp.internal:8080/sse',
    reachesInternet: true,
    airgapNote:
      'Reaches Sentry over the internet. On an air-gapped deploy, point it at your self-hosted Sentry or leave it off.',
    install: 'Run the Sentry MCP server pointed at your Sentry instance (SENTRY_AUTH_TOKEN).',
  },

  // ── Data & DB ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'Data & DB',
    description:
      'Run read-only SQL queries against a PostgreSQL database and inspect its schema. Use it to let an app answer questions from your database.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
    transport: 'stdio',
    defaultEndpointHint: 'npx -y @modelcontextprotocol/server-postgres postgresql://host/db',
    reachesInternet: false,
    airgapNote:
      'Connects only to the database you point it at. Keep it on your network — safe on an air-gapped deploy.',
    install: 'npx -y @modelcontextprotocol/server-postgres postgresql://user@host:5432/db',
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    category: 'Data & DB',
    description:
      'Query and manage a local SQLite database file. Use it for a lightweight, file-based database an app can read and write.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    transport: 'stdio',
    defaultEndpointHint: 'npx -y @modelcontextprotocol/server-sqlite --db-path /data/app.db',
    reachesInternet: false,
    airgapNote: 'Operates on a local database file — no network egress. Safe on an air-gapped deploy.',
    install: 'npx -y @modelcontextprotocol/server-sqlite --db-path /path/to/database.db',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    category: 'Data & DB',
    description:
      'Search and read files stored in Google Drive. Use it to let an app pull documents and sheets from your Drive.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive',
    transport: 'http',
    defaultEndpointHint: 'http://gdrive-mcp.internal:8080/sse',
    reachesInternet: true,
    airgapNote:
      'Reaches Google Drive over the internet. On an air-gapped deploy it cannot connect — leave it off unless you allow that egress.',
    install: 'Run the Google Drive MCP server with your OAuth credentials; host it on your network.',
  },

  // ── Web & Browse ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'fetch',
    name: 'Fetch',
    category: 'Web & Browse',
    description:
      'Fetch a web page by URL and return its content as readable text/markdown. Use it to pull the content of a specific link an app already has.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    transport: 'stdio',
    defaultEndpointHint: 'npx -y @modelcontextprotocol/server-fetch',
    reachesInternet: true,
    airgapNote:
      'Reaches the public internet to fetch URLs. On an air-gapped deploy it can only reach hosts on your own network.',
    install: 'npx -y @modelcontextprotocol/server-fetch',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer (browser)',
    category: 'Web & Browse',
    description:
      'Drive a headless browser — navigate pages, click, fill forms, and screenshot. Use it when an app must interact with a website, not just read it.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
    transport: 'stdio',
    defaultEndpointHint: 'npx -y @modelcontextprotocol/server-puppeteer',
    reachesInternet: true,
    airgapNote:
      'Can browse any site, including the public internet. On an air-gapped deploy it can only reach internal sites.',
    install: 'npx -y @modelcontextprotocol/server-puppeteer',
  },
  {
    id: 'playwright',
    name: 'Playwright (browser)',
    category: 'Web & Browse',
    description:
      'Automate a browser with Playwright — navigation, interaction, and testing across Chromium/Firefox/WebKit. A modern alternative to Puppeteer.',
    homepage: 'https://github.com/microsoft/playwright-mcp',
    transport: 'stdio',
    defaultEndpointHint: 'npx -y @playwright/mcp',
    reachesInternet: true,
    airgapNote:
      'Can browse any site, including the public internet. On an air-gapped deploy it can only reach internal sites.',
    install: 'npx -y @playwright/mcp@latest',
  },

  // ── Search ──────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'brave-search',
    name: 'Brave Search',
    category: 'Search',
    description:
      'Search the public web with the Brave Search API and return results. Use it when an app needs fresh facts that are not in your knowledge base.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    transport: 'stdio',
    defaultEndpointHint: 'npx -y @modelcontextprotocol/server-brave-search',
    reachesInternet: true,
    airgapNote:
      'Reaches the Brave Search API over the internet. On an air-gapped deploy it cannot connect — leave it off unless you allow that egress.',
    install: 'BRAVE_API_KEY=… npx -y @modelcontextprotocol/server-brave-search',
  },

  // ── Comms ───────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'slack',
    name: 'Slack',
    category: 'Comms',
    description:
      'Read channels and post messages in Slack. Use it to let an app summarize a channel or send a notification to your team.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
    transport: 'stdio',
    defaultEndpointHint: 'npx -y @modelcontextprotocol/server-slack',
    reachesInternet: true,
    airgapNote:
      'Reaches Slack over the internet. On an air-gapped deploy it cannot connect unless you allow egress to Slack.',
    install: 'SLACK_BOT_TOKEN=… npx -y @modelcontextprotocol/server-slack',
  },

  // ── Memory ──────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'memory',
    name: 'Memory (knowledge graph)',
    category: 'Memory',
    description:
      'Give an app a persistent memory — a knowledge graph of facts it can store and recall across runs. Use it to remember context between sessions.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    transport: 'stdio',
    defaultEndpointHint: 'npx -y @modelcontextprotocol/server-memory',
    reachesInternet: false,
    airgapNote: 'Stores memory locally — no network egress. Safe on an air-gapped deploy.',
    install: 'npx -y @modelcontextprotocol/server-memory',
  },

  // ── Productivity ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    category: 'Productivity',
    description:
      'A structured step-by-step reasoning aid — helps an app break a hard problem into ordered thoughts. Use it for planning and multi-step reasoning.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    transport: 'stdio',
    defaultEndpointHint: 'npx -y @modelcontextprotocol/server-sequential-thinking',
    reachesInternet: false,
    airgapNote: 'Pure local reasoning helper — no network egress. Safe on an air-gapped deploy.',
    install: 'npx -y @modelcontextprotocol/server-sequential-thinking',
  },
  {
    id: 'time',
    name: 'Time',
    category: 'Productivity',
    description:
      'Get the current time and convert between time zones. Use it when an app needs to reason about dates, times, and scheduling.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    transport: 'stdio',
    defaultEndpointHint: 'npx -y @modelcontextprotocol/server-time',
    reachesInternet: false,
    airgapNote: 'Local clock/timezone math — no network egress. Safe on an air-gapped deploy.',
    install: 'npx -y @modelcontextprotocol/server-time',
  },
  {
    id: 'everything',
    name: 'Everything (test server)',
    category: 'Productivity',
    description:
      'A reference/test MCP server exercising every protocol feature. Use it to verify your MCP wiring end-to-end before adding a real server.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everything',
    transport: 'stdio',
    defaultEndpointHint: 'npx -y @modelcontextprotocol/server-everything',
    reachesInternet: false,
    airgapNote: 'Self-contained test server — no network egress. Safe on an air-gapped deploy.',
    install: 'npx -y @modelcontextprotocol/server-everything',
  },
];

// ─── Lookup + grouping helpers (PURE) ─────────────────────────────────────────────────────────────
export function getMcpServer(id: string): McpServer | null {
  return MCP_SERVERS.find((s) => s.id === id) ?? null;
}

export interface McpCategoryGroup {
  category: McpCategory;
  servers: McpServer[];
}

// Group the catalog by category, in the canonical category order. Empty categories are dropped so
// the browse UI never renders an empty heading.
export function mcpCatalogByCategory(servers: McpServer[] = MCP_SERVERS): McpCategoryGroup[] {
  return MCP_CATEGORIES.map((category) => ({
    category,
    servers: servers.filter((s) => s.category === category),
  })).filter((g) => g.servers.length > 0);
}

// Every server that reaches the public internet — the ones an air-gapped operator must scrutinize.
export function internetReachingServers(servers: McpServer[] = MCP_SERVERS): McpServer[] {
  return servers.filter((s) => s.reachesInternet);
}

// ─── isInstallable — the PURE install gating rule ─────────────────────────────────────────────────
// A catalog entry can be turned into a registered tool ONLY when the operator has supplied a real,
// non-empty on-prem endpoint. The catalog's `defaultEndpointHint` is a SAMPLE, never auto-used — the
// operator must type/confirm their own endpoint so the console never guesses where a server lives.
export function isBlankEndpoint(endpoint: string | undefined | null): boolean {
  return !endpoint || endpoint.trim().length === 0;
}

export function isInstallable(server: McpServer | null, endpoint: string): boolean {
  if (!server) return false;
  return !isBlankEndpoint(endpoint);
}

// ─── buildInstallPayload — the PURE tool-create payload builder ───────────────────────────────────
// Turns a catalog entry + the operator's endpoint into EXACTLY the body the EXISTING tool-create
// route expects (POST /api/v1/admin/tools → createTool): {name, type:'mcp', endpoint, description}.
// We prefill name + description from the catalog and force type='mcp'; the operator's endpoint is
// required (isInstallable enforced by the caller). Internet-reaching servers get a leading air-gap
// marker in the description so the registered tool carries its egress posture forward.
export interface McpInstallPayload {
  name: string;
  type: 'mcp';
  endpoint: string;
  description: string;
}

export function buildInstallPayload(server: McpServer, endpoint: string): McpInstallPayload {
  const egressPrefix = server.reachesInternet ? '[reaches internet] ' : '';
  return {
    name: `MCP: ${server.name}`,
    type: 'mcp',
    endpoint: endpoint.trim(),
    description: `${egressPrefix}${server.description}`,
  };
}
