# GitHub Actions 自动发布到 npm 使用指南

本项目已配置 GitHub Actions 工作流，支持基于 Git Tag 的自动打包并发布到 npmjs 仓库。

## 🚀 快速开始

### 前置条件

1. **npm 账号和 Token**
   - 在 [npmjs.com](https://www.npmjs.com/) 注册账号（如果还没有）
   - 创建 Access Token：
     - 访问 https://www.npmjs.com/settings/your-username/tokens
     - 点击 "Generate New Token" → "Automation"
     - 复制生成的 token

2. **配置 GitHub Secrets**
   - 进入你的 GitHub 仓库
   - 点击 `Settings` → `Secrets and variables` → `Actions`
   - 点击 `New repository secret`
   - 名称：`NPM_TOKEN`
   - 值：粘贴你的 npm Access Token
   - 点击 `Add secret`

## 📦 发布方式

### 方式一：Git Tag 自动触发（推荐）

工作流完全自动化，只需推送 Git Tag 即可触发发布：

1. **在本地创建并推送 Git Tag**：
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

2. **GitHub Actions 会自动执行**：
   - ✅ 检测到 Tag 推送
   - ✅ 提取版本号（自动移除 `v` 前缀）
   - ✅ 更新 `package.json` 版本号
   - ✅ 安装依赖
   - ✅ 运行测试（如果存在）
   - ✅ 发布到 npm

**Tag 命名规则**：
- 必须以 `v` 开头（例如：`v1.0.1`）
- 版本号格式：`x.y.z`（例如：`1.0.1`, `1.1.0`, `2.0.0`）
- 工作流会自动验证版本号格式

### 方式二：手动触发（用于重试或手动发布）

如果发布失败需要重试，或者需要手动发布特定版本，可以使用手动触发：

1. **进入 GitHub 仓库的 Actions 标签页**
2. **选择左侧的 `Publish to npm` 工作流**
3. **点击 `Run workflow` 按钮**
4. **填写版本号**：
   - 输入要发布的版本号（格式：`x.y.z`，例如：`1.0.1`）
   - 注意：不要包含 `v` 前缀，直接输入版本号即可
5. **点击 `Run workflow` 开始执行**

**使用场景**：
- ✅ 重试失败的发布
- ✅ 手动发布特定版本（不创建 Tag）
- ✅ 调试和测试发布流程

## 🔍 工作流说明

### 工作流步骤

1. **检出代码** - 获取最新代码和完整 Git 历史
2. **设置 Node.js** - 安装 Node.js 22 并配置 npm registry
3. **检测版本号** - 从 Git Tag 中提取版本号（移除 `v` 前缀）
4. **验证版本号** - 确保版本号格式为 `x.y.z`
5. **更新 package.json** - 自动更新版本号
6. **安装依赖** - 运行 `npm ci`
7. **运行测试** - 如果存在测试脚本（可选，失败不阻止发布）
8. **发布到 npm** - 自动发布到 npmjs 仓库

### 版本号验证

工作流会自动验证版本号格式，必须是 `x.y.z` 格式（例如：`1.0.1`），否则会报错并停止工作流。

## 📝 发布清单

发布前请确认：

- [ ] `package.json` 中的 `name` 字段正确（确保 npm 包名可用）
- [ ] `package.json` 中的 `repository` URL 已更新为实际仓库地址
- [ ] `package.json` 中的 `author` 信息已更新
- [ ] GitHub Secrets 中已配置 `NPM_TOKEN`
- [ ] 代码已通过测试（如果有）
- [ ] 版本号遵循语义化版本规范（SemVer）
- [ ] 已提交所有代码更改到主分支

## ⚠️ 注意事项

1. **npm 包名唯一性**
   - 确保 `mcp-pubmed-llm-server` 这个包名在 npm 上可用
   - 如果已被占用，需要修改 `package.json` 中的 `name` 字段

2. **版本号递增**
   - 每次发布必须使用比当前版本更高的版本号
   - npm 不允许发布相同或更低版本号的包

3. **Git Tag 与版本号**
   - 版本号会自动从 Git Tag 中提取
   - Tag 格式：`v1.0.1` → 版本号：`1.0.1`
   - 推送 Tag 后会自动触发发布，无需手动操作

4. **自动发布**
   - 推送 Git Tag 后，工作流会自动执行发布流程
   - 无需在 GitHub Actions 界面手动触发
   - 如果发布失败，可以在 Actions 标签页查看详细日志

## 🔧 故障排除

### 问题：发布失败，提示 "You cannot publish over the previously published versions"

**解决方案**：版本号已存在，需要创建新的更高版本号的 Tag（例如：从 `v1.0.0` 改为 `v1.0.1`）

### 问题：发布失败，提示 "Invalid package name"

**解决方案**：检查 `package.json` 中的 `name` 字段，确保符合 npm 命名规范

### 问题：GitHub Actions 提示 "NPM_TOKEN not found"

**解决方案**：在 GitHub 仓库的 Settings → Secrets 中添加 `NPM_TOKEN`

### 问题：Git Tag 触发失败或未触发

**解决方案**：
- 确保 Tag 格式正确（必须以 `v` 开头，如 `v1.0.1`）
- 确保 Tag 已推送到 GitHub（`git push origin v1.0.1`）
- 检查 GitHub Actions 工作流是否启用（Settings → Actions → General）
- 如果 Tag 触发失败，可以使用手动触发方式重试（见上方"方式二"）

### 问题：版本号格式验证失败

**解决方案**：
- Tag 必须符合 `vx.y.z` 格式（例如：`v1.0.1`）
- 版本号必须是数字格式（例如：`1.0.1`，不能是 `1.0.1-beta`）

## 📚 相关资源

- [npm 发布文档](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry)
- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [语义化版本规范](https://semver.org/lang/zh-CN/)

