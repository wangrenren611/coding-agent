import BashTool from './src/agent-v2/tool/bash';



async function test() {
    const bashTool = new BashTool();
    const result = await bashTool.execute({ command: 'ls -la' });
    console.log(result);
}


test();