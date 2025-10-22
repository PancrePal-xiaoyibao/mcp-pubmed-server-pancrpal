#!/usr/bin/env node
/**
 * EndNote导出功能测试脚本
 * 测试自动导出RIS和BibTeX格式
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

async function testEndNoteExport() {
    console.log("📚 测试EndNote导出功能...");
    
    return new Promise((resolve) => {
        const child = spawn('node', ['src/index.js'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                ENDNOTE_EXPORT: 'enabled'
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
        
        // 发送搜索请求
        setTimeout(() => {
            const request = {
                jsonrpc: "2.0",
                id: 1,
                method: "tools/call",
                params: {
                    name: "pubmed_search",
                    arguments: {
                        query: "machine learning healthcare",
                        max_results: 3
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
                    const searchResult = JSON.parse(response.result.content[0].text);
                    console.log("✅ 搜索完成:");
                    console.log(`   找到论文: ${searchResult.found}`);
                    console.log(`   总结果数: ${searchResult.total}`);
                    
                    if (searchResult.endnote_export) {
                        console.log("✅ EndNote导出结果:");
                        console.log(`   成功导出: ${searchResult.endnote_export.exported}`);
                        console.log(`   导出失败: ${searchResult.endnote_export.failed}`);
                        
                        if (searchResult.endnote_export.results) {
                            console.log("   导出详情:");
                            searchResult.endnote_export.results.forEach((result, index) => {
                                const status = result.success ? '✅' : '❌';
                                console.log(`     ${index + 1}. ${result.title}: ${status}`);
                                if (result.success && result.formats) {
                                    console.log(`        RIS: ${result.formats.ris ? '✅' : '❌'}`);
                                    console.log(`        BibTeX: ${result.formats.bibtex ? '✅' : '❌'}`);
                                }
                            });
                        }
                    }
                }
            } catch (error) {
                console.log("❌ 测试失败:", error.message);
            }
            
            resolve();
        }, 5000);
    });
}

async function testEndNoteStatus() {
    console.log("\n📊 测试EndNote状态查询...");
    
    return new Promise((resolve) => {
        const child = spawn('node', ['src/index.js'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                ENDNOTE_EXPORT: 'enabled'
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
        
        // 发送状态查询请求
        setTimeout(() => {
            const request = {
                jsonrpc: "2.0",
                id: 2,
                method: "tools/call",
                params: {
                    name: "pubmed_endnote_status",
                    arguments: {
                        action: "stats"
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
                    const statusResult = JSON.parse(response.result.content[0].text);
                    console.log("✅ EndNote状态:");
                    console.log(`   导出启用: ${statusResult.endnote_export.enabled}`);
                    console.log(`   导出目录: ${statusResult.endnote_export.directory}`);
                    console.log(`   总导出数: ${statusResult.endnote_export.totalExports}`);
                    console.log(`   RIS文件: ${statusResult.endnote_export.risFiles}`);
                    console.log(`   BibTeX文件: ${statusResult.endnote_export.bibtexFiles}`);
                    console.log(`   最后导出: ${statusResult.endnote_export.lastExport}`);
                    console.log(`   支持格式: ${statusResult.endnote_export.supportedFormats.join(', ')}`);
                }
            } catch (error) {
                console.log("❌ 状态查询失败:", error.message);
            }
            
            resolve();
        }, 3000);
    });
}

async function checkExportFiles() {
    console.log("\n📁 检查导出文件...");
    
    const endnoteDir = path.join(process.cwd(), 'cache', 'endnote');
    
    if (fs.existsSync(endnoteDir)) {
        const files = fs.readdirSync(endnoteDir);
        const risFiles = files.filter(f => f.endsWith('.ris'));
        const bibFiles = files.filter(f => f.endsWith('.bib'));
        
        console.log(`✅ 找到 ${risFiles.length} 个RIS文件:`);
        risFiles.forEach(file => {
            const filePath = path.join(endnoteDir, file);
            const stats = fs.statSync(filePath);
            console.log(`   ${file} (${Math.round(stats.size / 1024)} KB)`);
        });
        
        console.log(`✅ 找到 ${bibFiles.length} 个BibTeX文件:`);
        bibFiles.forEach(file => {
            const filePath = path.join(endnoteDir, file);
            const stats = fs.statSync(filePath);
            console.log(`   ${file} (${Math.round(stats.size / 1024)} KB)`);
        });
        
        // 显示示例文件内容
        if (risFiles.length > 0) {
            console.log("\n📄 RIS文件示例内容:");
            const risFile = path.join(endnoteDir, risFiles[0]);
            const risContent = fs.readFileSync(risFile, 'utf8');
            console.log(risContent.substring(0, 500) + '...');
        }
        
        if (bibFiles.length > 0) {
            console.log("\n📄 BibTeX文件示例内容:");
            const bibFile = path.join(endnoteDir, bibFiles[0]);
            const bibContent = fs.readFileSync(bibFile, 'utf8');
            console.log(bibContent.substring(0, 500) + '...');
        }
    } else {
        console.log("❌ EndNote导出目录不存在");
    }
}

async function main() {
    console.log("🚀 开始EndNote导出功能测试");
    console.log("=" * 50);
    
    // 检查缓存目录
    const cacheDir = path.join(process.cwd(), 'cache');
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
        console.log(`📁 创建缓存目录: ${cacheDir}`);
    }
    
    // 测试EndNote导出
    await testEndNoteExport();
    
    // 测试状态查询
    await testEndNoteStatus();
    
    // 检查导出文件
    await checkExportFiles();
    
    console.log("\n🎉 EndNote导出功能测试完成！");
    console.log("📁 检查导出文件:");
    console.log(`   ${path.join(process.cwd(), 'cache', 'endnote')}`);
    console.log("\n💡 使用说明:");
    console.log("   1. RIS文件可直接导入EndNote、Zotero、Mendeley");
    console.log("   2. BibTeX文件可用于LaTeX、Overleaf等工具");
    console.log("   3. 使用 pubmed_endnote_status 工具管理导出文件");
}

main().catch(console.error);
