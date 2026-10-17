import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/**
 * Starts a throw-away PostgreSQL cluster for integration tests using the
 * locally installed server binaries (no Docker needed). If TEST_DATABASE_URL
 * is set (e.g. a CI service container), that server is used instead.
 */

export interface PgServer {
  /** Base URL without database name, e.g. postgres://postgres@127.0.0.1:5432 */
  baseUrl: string;
  stop: () => void;
}

const isWindows = process.platform === 'win32';
const EXE = isWindows ? '.exe' : '';

function findPgBin(): string | null {
  if (process.env.PG_BIN && fs.existsSync(path.join(process.env.PG_BIN, `initdb${EXE}`))) return process.env.PG_BIN;
  const roots = isWindows
    ? [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PostgreSQL'), 'D:\\pgsql', 'C:\\pgsql']
    : ['/usr/lib/postgresql'];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    if (fs.existsSync(path.join(root, 'bin', `initdb${EXE}`))) return path.join(root, 'bin');
    const versions = fs
      .readdirSync(root)
      .filter((v) => fs.existsSync(path.join(root, v, 'bin', `initdb${EXE}`)))
      .sort((a, b) => Number(b) - Number(a));
    if (versions[0]) return path.join(root, versions[0], 'bin');
  }
  for (const dir of ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']) {
    if (fs.existsSync(path.join(dir, 'initdb'))) return dir;
  }
  return null;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('no port'))));
    });
  });
}

export async function startPgServer(): Promise<PgServer> {
  if (process.env.TEST_DATABASE_URL) {
    const u = new URL(process.env.TEST_DATABASE_URL);
    u.pathname = '';
    return { baseUrl: u.toString().replace(/\/$/, ''), stop: () => {} };
  }
  const bin = findPgBin();
  if (!bin) {
    throw new Error(
      'PostgreSQL server binaries not found. Install PostgreSQL (initdb/pg_ctl) or set TEST_DATABASE_URL to a server the tests may create databases on.',
    );
  }
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  // initdb refuses to run as root; run the cluster as the `postgres` OS user.
  const runAs = isRoot ? (process.env.PG_RUN_AS ?? 'postgres') : null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoreach-pg-'));
  if (runAs) execFileSync('chown', [runAs, dir]);
  const dataDir = path.join(dir, 'data');
  const port = await freePort();
  const run = (cmd: string, args: string[]) => {
    const exe = path.join(bin, `${cmd}${EXE}`);
    const full = runAs ? ['runuser', ['-u', runAs, '--', exe, ...args]] : [exe, args];
    // `pg_ctl start` leaves a server running that inherits pg_ctl's stdio. With
    // pipes, spawnSync would wait for the server to exit (notably on Windows),
    // so send the command's output to a file instead and read it back.
    const outFile = path.join(dir, `${cmd}-${args.includes('start') ? 'start' : 'cmd'}.out`);
    const fd = fs.openSync(outFile, 'w');
    let res;
    try {
      res = spawnSync(full[0] as string, full[1] as string[], { stdio: ['ignore', fd, fd] });
    } finally {
      fs.closeSync(fd);
    }
    if (res.status !== 0) {
      const out = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
      throw new Error(`${cmd} failed: ${out || res.error?.message || `exit ${res.status}`}`);
    }
  };
  run('initdb', ['-D', dataDir, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-sync']);
  run('pg_ctl', [
    '-D',
    dataDir,
    '-o',
    `-p ${port}${isWindows ? '' : ` -k ${dir}`} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=200`,
    '-l',
    path.join(dir, 'server.log'),
    '-w',
    'start',
  ]);
  return {
    baseUrl: `postgres://postgres@127.0.0.1:${port}`,
    stop: () => {
      try {
        run('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop']);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
