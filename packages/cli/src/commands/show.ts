import { execSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ShowStartupData {
  port: number;
  url: string;
}

// ─── Formatting ─────────────────────────────────────────────────────────────────

/**
 * Format a human-readable startup message with the web server URL.
 */
export function formatShowStartup(data: ShowStartupData): string {
  const lines: string[] = [];
  lines.push(`Kaiju web UI started on port ${data.port}`);
  lines.push(`  ${data.url}`);
  lines.push('');
  lines.push('Press Ctrl+C to stop the server.');
  return lines.join('\n');
}

/**
 * Format show startup data as JSON for agent consumption.
 */
export function formatShowJson(data: ShowStartupData): string {
  return JSON.stringify(
    {
      url: data.url,
      port: data.port,
    },
    null,
    2,
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Detect the current git repo's remote origin URL and extract org/repo.
 * Returns null if not inside a git repo or remote not parseable.
 */
export function detectGitRepo(): { org: string; repo: string } | null {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Parse SSH format: git@github.com:org/repo.git
    const sshMatch = remoteUrl.match(/git@[^:]+:([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (sshMatch) {
      return { org: sshMatch[1]!, repo: sshMatch[2]! };
    }

    // Parse HTTPS format: https://github.com/org/repo.git
    const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (httpsMatch) {
      return { org: httpsMatch[1]!, repo: httpsMatch[2]! };
    }

    return null;
  } catch {
    // Not inside a git repo or git not available
    return null;
  }
}

/**
 * Open the given URL in the default browser using platform-native commands.
 */
export function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    let cmd: string;
    let args: string[];
    if (platform === 'darwin') {
      cmd = 'open';
      args = [url];
    } else if (platform === 'win32') {
      cmd = 'cmd';
      args = ['/c', 'start', url];
    } else {
      cmd = 'xdg-open';
      args = [url];
    }
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Silently fail if browser can't be opened (e.g., headless environment)
  }
}

/**
 * Wait for a server to be ready by polling the health endpoint.
 */
export async function waitForServer(url: string, timeoutMs: number = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// ─── Command ────────────────────────────────────────────────────────────────────

export const showCommand = new Command('show')
  .description('Launch the web UI to visualize PR chunks')
  .argument('[pr-ref]', 'PR reference: org/repo#N (optional, opens dashboard)')
  .option('-p, --port <port>', 'Port for the web server', '1954')
  .option('-a, --all', 'Show all reviews in dashboard (ignore repo context)')
  .option('--json', 'Output server info as JSON')
  .action(
    async (
      _prRef: string | undefined,
      options: { port?: string; all?: boolean; json?: boolean },
    ) => {
      const port = Number.parseInt(options.port ?? '1954', 10);
      if (Number.isNaN(port) || port < 1 || port > 65535) {
        console.error(
          `Error: Invalid port "${options.port}". Must be a number between 1 and 65535.`,
        );
        process.exitCode = 1;
        return;
      }

      const url = `http://localhost:${port}`;

      // Build environment variables for the web server
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        PORT: String(port),
      };

      // Context detection: if inside a git repo and --all not set, pass context
      if (!options.all) {
        const gitRepo = detectGitRepo();
        if (gitRepo) {
          env.KAIJU_CONTEXT_ORG = gitRepo.org;
          env.KAIJU_CONTEXT_REPO = gitRepo.repo;
        }
      }

      // Find the web package directory
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const webDir = resolve(__dirname, '../../../web');

      // Start the Vite dev server as a child process
      // Use process.argv[0] to get the full path to the bun binary
      const bunBin = process.argv[0] ?? 'bun';
      const child = spawn(bunBin, ['run', 'dev'], {
        cwd: webDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let serverReady = false;

      child.on('error', (err) => {
        if (!serverReady) {
          console.error(`Error: Failed to start web server: ${err.message}`);
          process.exitCode = 1;
        }
      });

      child.on('exit', (code) => {
        if (!serverReady && code !== 0) {
          console.error(`Error: Web server exited with code ${code}`);
          process.exitCode = 1;
        }
      });

      // Forward Ctrl+C to the child
      process.on('SIGINT', () => {
        child.kill('SIGINT');
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        child.kill('SIGTERM');
        process.exit(0);
      });

      // Wait for the server to be ready
      const ready = await waitForServer(url);

      if (!ready) {
        console.error('Error: Web server failed to start within 15 seconds.');
        child.kill();
        process.exitCode = 1;
        return;
      }

      serverReady = true;

      const startupData: ShowStartupData = { port, url };

      if (options.json) {
        console.log(formatShowJson(startupData));
      } else {
        console.log(formatShowStartup(startupData));
      }

      // Open browser
      openBrowser(url);

      // Keep the process alive — the server runs as a child process
      await new Promise(() => {
        // This promise never resolves, keeping the CLI process alive
        // until the user presses Ctrl+C
      });
    },
  );
