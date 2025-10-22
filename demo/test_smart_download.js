#!/usr/bin/env node
/**
 * 智能下载功能测试脚本
 * 测试跨平台下载功能和系统检测
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// 测试用的PMC论文列表
const testPapers = [
    {
        pmid: "26000488",
        pmcid: "PMC4481139",
        title: "Drop-seq_Macosko_2015",
        url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4481139/pdf/"
    },
    {
        pmid: "26000487", 
        pmcid: "PMC4441768",
        title: "inDrop_Klein_2015",
        url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4441768/pdf/"
    }
];

async function testSystemCheck() {
    console.log("🔍 测试系统环境检测...");
    
    return new Promise((resolve) => {
        const child = spawn('node', ['src/index.js'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                FULLTEXT_MODE: 'enabled'
            }
        });
        
        let output = '';
        let errorOutput = '';
        
        child.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        // 发送系统检测请求
        setTimeout(() => {
            const request = {
                jsonrpc: "2.0",
                id: 1,
                method: "tools/call",
                params: {
                    name: "pubmed_system_check",
                    arguments: {}
                }
            };
            
            child.stdin.write(JSON.stringify(request) + '\n');
        }, 1000);
        
        // 等待响应
        setTimeout(() => {
            child.kill();
            
            try {
                const lines = output.split('\n').filter(line => line.trim());
                const response = JSON.parse(lines[lines.length - 1]);
                
                if (response.result && response.result.content) {
                    const systemInfo = JSON.parse(response.result.content[0].text);
                    console.log("✅ 系统检测结果:");
                    console.log(`   平台: ${systemInfo.system_environment.system.platform}`);
                    console.log(`   推荐工具: ${systemInfo.system_environment.recommended}`);
                    console.log("   工具状态:");
                    systemInfo.system_environment.tools.forEach(tool => {
                        console.log(`     ${tool.name}: ${tool.available ? '✅' : '❌'}`);
                    });
                    console.log("   建议:");
                    systemInfo.recommendations.forEach(rec => {
                        console.log(`     ${rec}`);
                    });
                }
            } catch (error) {
                console.log("❌ 系统检测失败:", error.message);
            }
            
            resolve();
        }, 3000);
    });
}

async function testBatchDownload() {
    console.log("\n📥 测试批量下载功能...");
    
    return new Promise((resolve) => {
        const child = spawn('node', ['src/index.js'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                FULLTEXT_MODE: 'enabled'
            }
        });
        
        let output = '';
        let errorOutput = '';
        
        child.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        // 发送批量下载请求
        setTimeout(() => {
            const request = {
                jsonrpc: "2.0",
                id: 2,
                method: "tools/call",
                params: {
                    name: "pubmed_batch_download",
                    arguments: {
                        pmids: testPapers.map(p => p.pmid),
                        human_like: true
                    }
                }
            };
            
            child.stdin.write(JSON.stringify(request) + '\n');
        }, 1000);
        
        // 等待响应
        setTimeout(() => {
            child.kill();
            
            try {
                const lines = output.split('\n').filter(line => line.trim());
                const response = JSON.parse(lines[lines.length - 1]);
                
                if (response.result && response.result.content) {
                    const downloadResult = JSON.parse(response.result.content[0].text);
                    console.log("✅ 批量下载结果:");
                    console.log(`   请求论文: ${downloadResult.batch_download.total_requested}`);
                    console.log(`   可下载: ${downloadResult.batch_download.available_for_download}`);
                    console.log(`   成功下载: ${downloadResult.batch_download.successful_downloads}`);
                    console.log(`   下载失败: ${downloadResult.batch_download.failed_downloads}`);
                    
                    if (downloadResult.results) {
                        console.log("   详细结果:");
                        downloadResult.results.forEach((result, index) => {
                            const status = result.result.success ? '✅' : '❌';
                            console.log(`     ${index + 1}. ${result.title}: ${status}`);
                            if (!result.result.success) {
                                console.log(`        错误: ${result.result.error}`);
                            }
                        });
                    }
                }
            } catch (error) {
                console.log("❌ 批量下载测试失败:", error.message);
            }
            
            resolve();
        }, 10000); // 给更多时间进行下载
    });
}

async function main() {
    console.log("🚀 开始智能下载功能测试");
    console.log("=" * 50);
    
    // 检查缓存目录
    const cacheDir = path.join(process.cwd(), 'cache', 'fulltext');
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
        console.log(`📁 创建缓存目录: ${cacheDir}`);
    }
    
    // 测试系统检测
    await testSystemCheck();
    
    // 测试批量下载
    await testBatchDownload();
    
    console.log("\n🎉 测试完成！");
    console.log("📁 检查缓存目录查看下载的文件:");
    console.log(`   ${cacheDir}`);
    
    if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir);
        console.log(`   找到 ${files.length} 个文件:`);
        files.forEach(file => {
            if (file.endsWith('.pdf')) {
                const filePath = path.join(cacheDir, file);
                const stats = fs.statSync(filePath);
                console.log(`     ${file} (${Math.round(stats.size / 1024)} KB)`);
            }
        });
    }
}

main().catch(console.error);
