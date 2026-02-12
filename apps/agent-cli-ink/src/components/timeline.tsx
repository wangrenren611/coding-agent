import React, { memo } from "react";
import { Box } from "ink";
import type { TimelineEntry } from "../types";
import { TimelineItem } from "./timeline-item";

// 使用 memo 优化 Timeline 组件，比较 entries 数组
export const Timeline = memo(function Timeline({ entries }: { entries: TimelineEntry[] }): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {entries.map((entry) => (
        <TimelineItem key={entry.id} entry={entry} />
      ))}
    </Box>
  );
}, (prevProps, nextProps) => {
  // 如果数量不同，需要重新渲染
  if (prevProps.entries.length !== nextProps.entries.length) {
    return false;
  }

  // 比较每一条消息的 ID 是否相同
  for (let i = 0; i < prevProps.entries.length; i++) {
    if (prevProps.entries[i].id !== nextProps.entries[i].id) {
      return false;
    }
  }

  // ID 都相同，不需要重新渲染
  return true;
});
