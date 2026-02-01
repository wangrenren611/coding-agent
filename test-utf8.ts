import { execCommand } from './src/agent-v2/tool/platform-cmd.ts';

// 测试 UTF-8 命令 (ls)
const result = execCommand('ls -la');
console.log('ls -la 输出:');
console.log(result.stdout.slice(0, 200));
