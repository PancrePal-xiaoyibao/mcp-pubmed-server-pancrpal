# 远程部署：安全加固与连接排查

README 的[传输模式](../README.md#传输模式)一节已经说明了怎么启动 Streamable HTTP 模式。本文补充两件它没覆盖、但把服务暴露给远程客户端时一定会遇到的事：

1. **安全** —— 默认配置下服务是完全开放的，对外暴露前必须处理
2. **连接排查** —— 客户端连不上时，怎么判断是服务的问题还是客户端配置的问题

适用场景：客户端只接受一个 URL、无法把本服务作为子进程拉起。例如云端 Agent 平台（iFlytek astron-agent 的 `mcp_server_url`）、服务端工作流引擎，或多个客户端共用一份服务。

---

## 1. ⚠️ 暴露到本机之外前，先读这节

README 在 Cherry Studio 一节建议把 `baseUrl` 设成 `http://<服务器IP>:8745/mcp`。这样配是能用，但请注意当前 HTTP 模式的默认状态：

- **没有任何认证** —— `/mcp` 不校验任何凭据
- **CORS 是 `Access-Control-Allow-Origin: *`** —— 任意网页都能从浏览器发起调用
- **监听 `0.0.0.0`** —— 绑定到所有网卡，日志里那行 `[HTTP] http://0.0.0.0:8745/mcp` 就是它

三者叠加的结果是：**只要能访问到这个端口，就能完全使用这个服务**。具体损失：

- 你的 NCBI API Key 配额会被别人消耗（`PUBMED_API_KEY` / `api-keys.json`）。NCBI 对超频有封禁策略，配额被跑满会连带影响你自己的正常使用。
- `pubmed_manage_cache` 可以被任意调用，缓存会被清空或污染。

### 推荐做法（三选一）

**① 只在本机用**（最省事，也最安全）

客户端和服务在同一台机器，不做任何端口映射。Docker 部署时把端口绑到回环即可：

```yaml
ports:
  - "127.0.0.1:8745:8745"    # 而不是 "8745:8745"
```

**② 放到反向代理后面**，由代理负责 TLS 和鉴权，只对外开放代理端口：

```nginx
location /mcp {
    auth_basic           "mcp";
    auth_basic_user_file /etc/nginx/.htpasswd;

    proxy_pass           http://127.0.0.1:8745/mcp;
    proxy_http_version   1.1;

    # 以下两行是 SSE 必需的：缺了会导致响应被缓冲，
    # 客户端一直收不到数据、表现为「连上了但没反应」
    proxy_set_header     Connection '';
    proxy_buffering      off;
    proxy_read_timeout   3600s;
}
```

注意反代模式下，服务本身也应只监听回环，否则 `8745` 仍然可以被绕过代理直接访问。

**③ 只在私有网络内暴露** —— VPC、容器内网或 WireGuard 之类，不给公网路由。

**不建议**把 `8745` 直接映射到公网。

---

## 2. 连接排查：用 curl 复现一次完整握手

客户端报错信息通常很模糊。下面这段不依赖任何客户端，能直接区分「服务没起来」和「客户端配错了」。

```bash
# 1) 健康检查 —— 失败说明服务没起来或端口不对
curl -s http://127.0.0.1:8745/health
# {"status":"ok","mode":"streamableHttp","sessions":0}

# 2) initialize —— 会话 ID 在响应头里
curl -s -D /tmp/h.txt \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -X POST http://127.0.0.1:8745/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'

SID=$(grep -i '^mcp-session-id:' /tmp/h.txt | tr -d '\r' | awk '{print $2}')
echo "session = $SID"

# 3) 通知初始化完成 —— 期望 202
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "MCP-Session-Id: $SID" \
  -X POST http://127.0.0.1:8745/mcp \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# 4) 列出工具
curl -s \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "MCP-Session-Id: $SID" \
  -X POST http://127.0.0.1:8745/mcp \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

第 4 步应当列出 `pubmed_search`、`pubmed_get_details`、`pubmed_extract_info`、`pubmed_find_related`、`pubmed_manage_cache`。

走到这一步都正常，就说明服务端没问题，接下来查客户端的 URL（是否带 `/mcp` 路径）、网络可达性和代理配置。

### 三个容易踩的点

**① `Accept` 头必须同时包含两种类型**

只写 `application/json` 会得到：

```json
{"jsonrpc":"2.0","error":{"code":-32000,"message":"Not Acceptable: Client must accept both application/json and text/event-stream"},"id":null}
```

**② 响应是 SSE 格式，不是裸 JSON**

返回体长这样，用脚本解析时要先剥掉 `data: ` 前缀：

```
event: message
data: {"result":{...},"jsonrpc":"2.0","id":1}
```

**③ 除 `initialize` 外每个请求都要带 `MCP-Session-Id`**

否则返回 `400`：`No active session. Send an initialize request first.`

---

## 3. 传输模式没生效？先看这行日志

除了 README 写的 `--mode=streamableHttp`，也可以用环境变量（`.env.example` 里的 `MCP_TRANSPORT`）：

```bash
MCP_TRANSPORT=streamableHttp node dist/index.js
```

**`--mode=` 的优先级高于 `MCP_TRANSPORT`。** 两者取值都无法识别时，服务会**静默回落到 stdio**，只在 stderr 打印一行：

```
[Config] Unknown mode 'bogus', falling back to stdio
```

所以「以为开了 HTTP 但 `/health` 连不上」，第一件事是看启动日志最后一行是 `running on Streamable HTTP` 还是 `running on stdio`。
