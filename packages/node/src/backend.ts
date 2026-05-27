/**
 * Manages the lifecycle of the spawned .NET backend executable.
 *
 * Responsibilities:
 *   - spawn / respawn the child process
 *   - parse line-delimited JSON from stdout
 *   - re-emit typed messages
 *   - apply an exponential-backoff reconnect policy on crash
 *   - clean shutdown on stop()
 *
 * This class deliberately knows nothing about MediaSession semantics — that
 * lives in {@link SessionManager}.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';

import { parseBackendMessage, PROTOCOL_VERSION, type BackendMessage } from './protocol.js';
import { resolveBackendPath } from './backendPath.js';

export interface BackendProcessOptions {
  /** Override the path to the backend exe. Useful for tests. */
  backendPath?: string;
  /**
   * Extra arguments passed to the spawned process. Mainly used by tests that
   * invoke `node fakeBackend.mjs`; the bundled backend takes no arguments.
   */
  spawnArgs?: readonly string[];
  /** Maximum reconnect delay in ms. Defaults to 5000. */
  maxReconnectDelayMs?: number;
  /** Base reconnect delay in ms. Defaults to 250. */
  baseReconnectDelayMs?: number;
}

export interface BackendProcessEvents {
  message: (msg: BackendMessage) => void;
  ready: (version: string) => void;
  /** Emitted whenever the backend process exits, before any restart. */
  exit: (code: number | null, signal: NodeJS.Signals | null) => void;
  error: (err: Error) => void;
}

export class BackendProcess extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = '';
  private stopping = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readonly backendPath: string;
  private readonly spawnArgs: readonly string[];
  private readonly maxReconnectDelayMs: number;
  private readonly baseReconnectDelayMs: number;

  constructor(options: BackendProcessOptions = {}) {
    super();
    this.backendPath = resolveBackendPath(options.backendPath);
    this.spawnArgs = options.spawnArgs ?? [];
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 5000;
    this.baseReconnectDelayMs = options.baseReconnectDelayMs ?? 250;
  }

  override on<E extends keyof BackendProcessEvents>(event: E, listener: BackendProcessEvents[E]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override emit<E extends keyof BackendProcessEvents>(
    event: E,
    ...args: Parameters<BackendProcessEvents[E]>
  ): boolean {
    return super.emit(event, ...args);
  }

  /** Start the backend. Idempotent — calling twice does nothing. */
  start(): void {
    if (this.child || this.stopping) return;
    this.spawnChild();
  }

  /** Send a `refresh` command, requesting a fresh snapshot. */
  requestRefresh(): void {
    this.child?.stdin.write('refresh\n');
  }

  /**
   * Stop the backend gracefully. Sends `exit` over stdin, waits up to
   * `timeoutMs` for the process to exit, then SIGKILLs if necessary.
   */
  async stop(timeoutMs = 1500): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const child = this.child;
    if (!child) return;

    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };

      child.once('exit', settle);

      // Best-effort graceful exit. If stdin is already closed this will throw
      // synchronously — swallow it; the kill path below covers us.
      try {
        child.stdin.write('exit\n');
        child.stdin.end();
      } catch {
        /* stream may already be closed */
      }

      setTimeout(() => {
        if (!settled && !child.killed) {
          child.kill();
        }
      }, timeoutMs);
    });
  }

  private spawnChild(): void {
    if (!fs.existsSync(this.backendPath)) {
      const err = new Error(
        `Backend executable not found at "${this.backendPath}". ` +
          `Did you run "npm run build:backend"? You can also point at a custom binary ` +
          `via the WINDOWS_MEDIA_SESSIONS_BACKEND environment variable.`,
      );
      this.emit('error', err);
      return;
    }

    const child = spawn(this.backendPath, [...this.spawnArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    this.stdoutBuffer = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdoutChunk(chunk));

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // Backend writes diagnostics to stderr; surface them as non-fatal errors.
      const message = chunk.trim();
      if (message.length > 0) {
        this.emit('error', new Error(`[backend stderr] ${message}`));
      }
    });

    child.once('error', (err) => {
      this.emit('error', err);
    });

    child.once('exit', (code, signal) => {
      this.child = null;
      this.emit('exit', code, signal);
      if (!this.stopping) {
        this.scheduleReconnect();
      }
    });
  }

  private onStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.length === 0) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      this.emit('error', new Error(`Invalid JSON from backend: ${(err as Error).message}`));
      return;
    }
    const msg = parseBackendMessage(raw);
    if (!msg) {
      this.emit('error', new Error(`Unrecognized backend message: ${line}`));
      return;
    }
    if (msg.type === 'ready') {
      if (msg.protocol !== PROTOCOL_VERSION) {
        this.emit(
          'error',
          new Error(
            `Backend protocol mismatch: expected ${PROTOCOL_VERSION}, got ${msg.protocol}. ` +
              `Reinstall the package or rebuild the backend.`,
          ),
        );
        return;
      }
      this.reconnectAttempts = 0; // successful handshake → reset backoff
      this.emit('ready', msg.version);
    }
    this.emit('message', msg);
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    const delay = Math.min(
      this.baseReconnectDelayMs * 2 ** (this.reconnectAttempts - 1),
      this.maxReconnectDelayMs,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.spawnChild();
    }, delay);
  }
}
