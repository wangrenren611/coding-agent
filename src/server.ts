/**
 * SSE 服务端 - 将 Agent 流式消息通过 SSE 发送给前端
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Agent } from './agent-v2/agent/agent';
import { ToolRegistry } from './agent-v2/tool/registry';
import BashTool from './agent-v2/tool/bash';
import { ProviderRegistry } from './providers';
import { AgentStreamMessage, TaskStatus } from './agent-v2/agent/stream-types';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.development' });

// ESM 中获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SSE 响应头
const SSE_HEADERS = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control',
};

/**
 * 发送 SSE 事件 - 发送统一的消息格式
 */
function sendSSEMessage(res: http.ServerResponse, message: AgentStreamMessage) {
    res.write(`event: message\n`);
    res.write(`data: ${JSON.stringify(message)}\n\n`);
}

/**
 * 创建 Agent 实例并执行查询
 */
async function executeAgent(query: string, res: http.ServerResponse) {
    const toolRegistry = new ToolRegistry({
        workingDirectory: process.cwd(),
    });

    toolRegistry.register([new BashTool()]);

    const agent = new Agent({
        provider: ProviderRegistry.createFromEnv('minimax-2.1'),
        systemPrompt: '你是一个智能助手,现在系统环境是windows系统',
        toolRegistry,
        stream: true,
        // 只需设置这一个回调，就能获取所有信息
        streamCallback: (message: AgentStreamMessage) => {
            sendSSEMessage(res, message);

            // 任务完成后自动结束连接
            if (message.isTerminal) {
                // 延迟一下，确保最后一条消息发送完成
                setTimeout(() => {
                    res.end();
                }, 100);
            }
        },
    });

    try {
        await agent.execute(query);
    } catch (error) {
        // 错误已经在 streamCallback 中处理
        // 这里只是为了兜底，确保连接关闭
        if (!res.writableEnded) {
            res.end();
        }
    }
}

// 创建 HTTP 服务器
const server = http.createServer(async (req, res) => {
    // 设置 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const reqUrl = new URL(req.url!, `http://${req.headers.host}`);

    // 首页 - 返回 HTML
    if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
        const htmlPath = path.join(__dirname, '../index.html');
        const html = fs.readFileSync(htmlPath, 'utf-8');
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
        });
        res.end(html);
        return;
    }

    // SSE 端点
    if (reqUrl.pathname === '/api/chat' && req.method === 'GET') {
        const query = reqUrl.searchParams.get('q') || '你好';
        const accept = req.headers.accept || '';

        // 如果浏览器直接访问（Accept 包含 text/html），返回提示页面
        if (accept.includes('text/html')) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>SSE Endpoint</title>
    <style>
        body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        h1 { color: #333; }
        .info { background: #e3f2fd; padding: 15px; border-radius: 8px; }
        code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }
        .links { margin-top: 20px; }
        .links a { color: #1976d2; text-decoration: none; }
        .links a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>SSE 端点</h1>
    <div class="info">
        <p>这是 SSE (Server-Sent Events) 端点，用于流式传输 Agent 事件。</p>
        <p>请使用以下方式访问：</p>
        <ul>
            <li>打开 <a href="/">http://localhost:3000</a> 使用 Web 界面</li>
            <li>或使用 JavaScript EventSource API 消费此端点</li>
        </ul>
        <p>当前查询参数: <code>q=${query}</code></p>
    </div>
    <div class="links">
        <a href="/">→ 返回首页</a>
    </div>
</body>
</html>
            `);
            return;
        }

        res.writeHead(200, SSE_HEADERS);

        // 执行 Agent
        await executeAgent(query, res);
        return;
    }

    // 健康检查
    if (reqUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`SSE Server running on http://localhost:${PORT}`);
    console.log(`Try: curl http://localhost:${PORT}/api/chat?q=当前目录有什么`);
});
