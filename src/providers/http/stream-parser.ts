/**
 * 流解析器工具
 *
 * 处理 SSE（服务器发送事件）流解析，用于 LLM 流式响应。
 * 从 openai.ts 实现中提取并通用化。
 */

import {  Chunk } from "../typing";




/**
 * SSE（服务器发送事件）的流解析器
 */
export class StreamParser {
  /**
   * 解析 SSE 行并提取数据
   * 对于空行、注释或非数据行返回 null
   */
  static parseSseLine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) {
      return null;
    }
    if (trimmed.startsWith('data: ')) {
      return trimmed.slice(6).trim();
    }
    if (trimmed.startsWith('{')) {
      return trimmed;
    }
    return null;
  }

  /**
   * 检查数据是否指示流结束
   */
  static isStreamEnd(data: string): boolean {
    return data === '[DONE]';
  }

  /**
   * 安全地解析 JSON，失败时返回 null
   */
  static safeJsonParse<T>(data: string): T | null {
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  /**
   * 处理可读流并为事件调用回调
   */
  static async parse(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    callback: (chunk:Chunk) => void
  ): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    let shouldStop = false;

    while (!shouldStop) {
      const { done, value } = await reader.read();

      if (done) {
        // Process remaining buffer when stream ends
        if (buffer.trim()) {
          const data = this.parseSseLine(buffer);
          if (data && !this.isStreamEnd(data)) {
            const chunk = this.safeJsonParse<Chunk>(data);
            if (chunk) callback(chunk);
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/[\r\n]+/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const data = this.parseSseLine(line);

        if (!data) continue;

        if (this.isStreamEnd(data)) {
          shouldStop = true;
          break;
        }

        const chunk = this.safeJsonParse<Chunk>(data);
        if (!chunk) continue;

        callback(chunk);
      }
    }
  }
}
//   /**
//    * 处理单个流块
//    */
//   private static processChunk(
//     chunk: Chunk,
//     callbacks: StreamCallbacks
//   ): void {
//     const choice = chunk?.choices?.[0];
//     if (!choice) return;

//     const delta = choice.delta;

//     // 处理内容
//     const content = delta?.content;

//     if (content||content==='') {
//        callbacks.onContent(chunk);
//     }

//     // 处理工具调用
//     const toolCallsDelta = delta?.tool_calls;
//     if (toolCallsDelta && toolCallsDelta.length > 0) {
//       for (const tc of toolCallsDelta) {
//         callbacks.onToolCall({
//           index: tc.index,
//           id: tc.id,
//           type: tc.type,
//           function: {
//             name: tc.function.name,
//             arguments: tc.function.arguments,
//           },
//         });
//       }
//     }

//     // 处理结束原因
//     const finishReason = choice.finish_reason;
//     if (finishReason) {
//       callbacks.onFinish(finishReason);
//     }
//   }
// }
