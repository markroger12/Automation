import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ProcInfo = { pid: number; commandLine: string };

/** Lists running processes with their command lines (Windows: CIM via PowerShell; others: ps). */
export async function listProcesses(nameHint: string): Promise<ProcInfo[]> {
  try {
    if (process.platform === 'win32') {
      const exe = nameHint.endsWith('.exe') ? nameHint : `${nameHint}.exe`;
      const script = `Get-CimInstance Win32_Process -Filter "Name='${exe.replace(/'/g, '')}'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`;
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 20 * 1024 * 1024, timeout: 20_000 });
      const text = stdout.trim();
      if (!text) return [];
      const parsed = JSON.parse(text) as { ProcessId: number; CommandLine: string | null } | { ProcessId: number; CommandLine: string | null }[];
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.map((p) => ({ pid: p.ProcessId, commandLine: p.CommandLine ?? '' }));
    }
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,args='], { maxBuffer: 20 * 1024 * 1024, timeout: 10_000 });
    return stdout
      .split('\n')
      .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ pid: Number(m[1]), commandLine: m[2]! }))
      .filter((p) => p.commandLine.toLowerCase().includes(nameHint.replace(/\.exe$/i, '').toLowerCase()));
  } catch {
    return [];
  }
}

/** Polite stop: taskkill without /F on Windows (Chrome saves its session), SIGTERM elsewhere. */
export async function stopProcess(pid: number): Promise<void> {
  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/PID', String(pid)], { windowsHide: true, timeout: 15_000 });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // already gone
  }
}
