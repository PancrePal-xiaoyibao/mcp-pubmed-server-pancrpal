import os from 'os';
import fs from 'fs';
import { exec } from 'child_process';
import { FULLTEXT_ENABLED } from '../config.js';

export function detectSystemEnvironment() {
    const platform = os.platform();
    const arch = os.arch();

    return {
        platform: platform,
        arch: arch,
        isWindows: platform === 'win32',
        isMacOS: platform === 'darwin',
        isLinux: platform === 'linux',
        downloadCommand: getDownloadCommand(platform),
        userAgent: getUserAgent(platform)
    };
}

export function getDownloadCommand(platform) {
    switch (platform) {
        case 'win32':
            return 'powershell';
        case 'darwin':
        case 'linux':
            return 'wget';
        default:
            return 'curl';
    }
}

export function getUserAgent(platform) {
    const userAgents = {
        'win32': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'darwin': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'linux': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    return userAgents[platform] || userAgents['linux'];
}

export function getSystemRecommendations(systemInfo) {
    const recommendations = [];

    if (systemInfo.system.isWindows) {
        const powershell = systemInfo.tools.find(t => t.name === 'PowerShell');
        if (powershell && powershell.available) {
            recommendations.push("✅ PowerShell available - Windows downloads will use Invoke-WebRequest");
        } else {
            recommendations.push("❌ PowerShell not available - Windows downloads may fail");
        }
    } else {
        const wget = systemInfo.tools.find(t => t.name === 'wget');
        const curl = systemInfo.tools.find(t => t.name === 'curl');

        if (wget && wget.available) {
            recommendations.push("✅ wget available - Recommended for Linux/macOS downloads");
        } else if (curl && curl.available) {
            recommendations.push("✅ curl available - Will use curl as fallback");
        } else {
            recommendations.push("❌ Neither wget nor curl available - Downloads may fail");
        }
    }

    if (FULLTEXT_ENABLED) {
        recommendations.push("✅ Full-text mode enabled");
    } else {
        recommendations.push("⚠️ Full-text mode disabled - Enable with FULLTEXT_MODE=enabled");
    }

    return recommendations;
}

export async function downloadWithPowerShell(downloadUrl, filePath, system) {
    return new Promise((resolve) => {
        const command = `powershell -Command "& {Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${filePath}' -UserAgent '${system.userAgent}' -TimeoutSec 60}"`;

        console.error(`[PowerShell] Executing: ${command}`);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`[PowerShell] Error: ${error.message}`);
                resolve({
                    success: false,
                    error: error.message,
                    stderr: stderr
                });
                return;
            }

            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                if (stats.size > 0) {
                    resolve({
                        success: true,
                        filePath: filePath,
                        fileSize: stats.size,
                        method: 'PowerShell'
                    });
                } else {
                    resolve({
                        success: false,
                        error: 'Downloaded file is empty',
                        filePath: filePath
                    });
                }
            } else {
                resolve({
                    success: false,
                    error: 'File not found after download',
                    stderr: stderr
                });
            }
        });
    });
}

export async function downloadWithWgetOrCurl(downloadUrl, filePath, system) {
    return new Promise((resolve) => {
        let command;

        if (system.downloadCommand === 'wget') {
            command = `wget --user-agent='${system.userAgent}' --timeout=60 --tries=3 --continue -O '${filePath}' '${downloadUrl}'`;
        } else {
            command = `curl -L --user-agent '${system.userAgent}' --connect-timeout 60 --max-time 300 -o '${filePath}' '${downloadUrl}'`;
        }

        console.error(`[${system.downloadCommand}] Executing: ${command}`);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`[${system.downloadCommand}] Error: ${error.message}`);
                resolve({
                    success: false,
                    error: error.message,
                    stderr: stderr
                });
                return;
            }

            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                if (stats.size > 0) {
                    resolve({
                        success: true,
                        filePath: filePath,
                        fileSize: stats.size,
                        method: system.downloadCommand
                    });
                } else {
                    resolve({
                        success: false,
                        error: 'Downloaded file is empty',
                        filePath: filePath
                    });
                }
            } else {
                resolve({
                    success: false,
                    error: 'File not found after download',
                    stderr: stderr
                });
            }
        });
    });
}

export async function checkDownloadTools() {
    const system = detectSystemEnvironment();
    const tools = [];

    if (system.isWindows) {
        try {
            await new Promise((resolve, reject) => {
                exec('powershell -Command "Get-Host"', (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
            tools.push({ name: 'PowerShell', available: true });
        } catch (error) {
            tools.push({ name: 'PowerShell', available: false, error: error.message });
        }
    } else {
        try {
            await new Promise((resolve, reject) => {
                exec('wget --version', (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
            tools.push({ name: 'wget', available: true });
        } catch (error) {
            tools.push({ name: 'wget', available: false, error: error.message });
        }

        try {
            await new Promise((resolve, reject) => {
                exec('curl --version', (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
            tools.push({ name: 'curl', available: true });
        } catch (error) {
            tools.push({ name: 'curl', available: false, error: error.message });
        }
    }

    return {
        system: system,
        tools: tools,
        recommended: system.downloadCommand
    };
}
