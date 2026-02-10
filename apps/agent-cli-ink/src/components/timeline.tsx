import React, { memo } from "react";
import { Box } from "ink";
import type { TimelineEntry } from "../types";
import { TimelineItem } from "./timeline-item";

// 使用 memo 优化 Timeline 组件
export const Timeline = memo(function Timeline({ entries }: { entries: TimelineEntry[] }): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {entries.map((entry) => (
        <TimelineItem key={entry.id} entry={entry} />
      ))}
    </Box>
  );
}, (prevProps, nextProps) => {
  // 只在数量或最后一条消息的 ID/内容变化时才重新渲染
  if (prevProps.entries.length !== nextProps.entries.length) return false;
  
  const prevLast = prevProps.entries[prevProps.entries.length - 1];
  const nextLast = nextProps.entries[nextProps.entries.length - 1];
  
  if (!prevLast || !nextLast) {
    return prevProps.entries.length === nextProps.entries.length;
  }
  
  // 比较最后一条消息的关键属性
  if (prevLast.id !== nextLast.id) return false;
  if (prevLast.type !== nextLast.type) return false;
  
  switch (nextLast.type) {
    case 'assistant':
      if (prevLast.text !== (nextLast as any).text || 
          prevLast.loading !== (nextLast as any).loading) return false;
      break;
    case 'tool':
      if ((prevLast as any).loading !== (nextLast as any).loading ||
          (prevLast as any).status !== (nextLast as any).status ||
          (prevLast as any).output !== (nextLast as any).output) return false;
      break;
    case 'user':
    case 'system':
      if ((prevLast as any).text !== (nextLast as any).text) return false;
      break;
  }
  
  // 如果只是历史消息的增量更新（loading 变化），不重新渲染
  return true;
});
