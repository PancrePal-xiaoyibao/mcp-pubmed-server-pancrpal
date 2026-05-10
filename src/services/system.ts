import os from 'os';
import fs from 'fs';
import { exec } from 'child_process';
import { FULLTEXT_ENABLED } from '../config.js';

export interface SystemInfo {
  platform: string;
  arch: string;
  isWindows: boolean;
  isMacOS: boolean;
  isLinux: boolean;
  downloadCommand: string;
  userAgent: string;
}

export interface ToolAvailability {
  name: string;
  available: boolean;
  error?: string;
}

export function detectSystemEnvironment(): SystemInfo {
  const platform = os.platform();
  const arch = os.arch();
  return {
    platform,
    arch,
    isWindows: platform === 'win32',
    isMacOS: platform === 'darwin',
    isLinux: platform === 'linux',
    downloadCommand: getDownloadCommand(platform),
    userAgent: getUserAgent(platform),
  };
}

function getDownloadCommand(platform: string): string {
  if (platform === 'win32') return 'powershell';
  return 'wget';
}

function getUserAgent(platform: string): string {
  const agents: Record<string, string> = {
    win32: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    darwin: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  };
  return agents[platform] || agents.linux;
}

export function getSystemRecommendations(systemInfo: { system: SystemInfo; tools: ToolAvailability[] }): string[] {
  const recs: string[] = [];
  if (systemInfo.system.isWindows) {
    const ps = systemInfo.tools.find(t => t.name === 'PowerShell');
    recs.push(ps?.available
      ? 'PowerShell available for Windows downloads'
      : 'PowerShell not available — Windows downloads may fail');
  } else {
    const wget = systemInfo.tools.find(t => t.name === 'wget');
    const curl = systemInfo.tools.find(t => t.name === 'curl');
    if (wget?.available) recs.push('wget available for downloads');
    else if (curl?.available) recs.push('curl available as fallback');
    else recs.push('Neither wget nor curl available — downloads may fail');
  }
  recs.push(FULLTEXT_ENABLED ? 'Full-text mode enabled' : 'Full-text mode disabled');
  return recs;
}

export function downloadWithPowerShell(
  url: string, filePath: string, system: SystemInfo,
): Promise<{ success: boolean; filePath?: string; fileSize?: number; method?: string; error?: string }> {
  return new Promise(resolve => {
    const cmd = `powershell -Command "& {Invoke-WebRequest -Uri '${url}' -OutFile '${filePath}' -UserAgent '${system.userAgent}' -TimeoutSec 60}"`;
    exec(cmd, (error) => {
      if (error) {
        resolve({ success: false, error: error.message });
        return;
      }
      if (fs.existsSync(filePath)) {
        const s = fs.statSync(filePath);
        resolve(s.size > 0
          ? { success: true, filePath, fileSize: s.size, method: 'PowerShell' }
          : { success: false, error: 'Downloaded file is empty' });
      } else {
        resolve({ success: false, error: 'File not found after download' });
      }
    });
  });
}

export function downloadWithWgetOrCurl(
  url: string, filePath: string, system: SystemInfo,
): Promise<{ success: boolean; filePath?: string; fileSize?: number; method?: string; error?: string }> {
  return new Promise(resolve => {
    const cmd = system.downloadCommand === 'wget'
      ? `wget --user-agent='${system.userAgent}' --timeout=60 --tries=3 -O '${filePath}' '${url}'`
      : `curl -L --user-agent '${system.userAgent}' --connect-timeout 60 --max-time 300 -o '${filePath}' '${url}'`;
    exec(cmd, (error) => {
      if (error) {
        resolve({ success: false, error: error.message });
        return;
      }
      if (fs.existsSync(filePath)) {
        const s = fs.statSync(filePath);
        resolve(s.size > 0
          ? { success: true, filePath, fileSize: s.size, method: system.downloadCommand }
          : { success: false, error: 'Downloaded file is empty' });
      } else {
        resolve({ success: false, error: 'File not found after download' });
      }
    });
  });
}

export async function checkDownloadTools(): Promise<{ system: SystemInfo; tools: ToolAvailability[]; recommended: string }> {
  const system = detectSystemEnvironment();
  const tools: ToolAvailability[] = [];

  const checkTool = (cmd: string, name: string): Promise<ToolAvailability> =>
    new Promise(resolve => {
      exec(cmd, error => {
        resolve(error ? { name, available: false, error: error.message } : { name, available: true });
      });
    });

  if (system.isWindows) {
    tools.push(await checkTool('powershell -Command "Get-Host"', 'PowerShell'));
  } else {
    tools.push(
      await checkTool('wget --version', 'wget'),
      await checkTool('curl --version', 'curl'),
    );
  }

  return { system, tools, recommended: system.downloadCommand };
}
