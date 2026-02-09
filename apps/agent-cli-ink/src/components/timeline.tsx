import React, { useMemo, memo } from "react";
import { Box ,Static} from "ink";
import type { TimelineEntry } from "../types";
import { TimelineItem } from "./timeline-item";

// 使用 memo 优化 TimelineItem，只有当 entry 发生实际变化时才重新渲染
const MemoizedTimelineItem = memo(TimelineItem, (prevProps, nextProps) => {
  const prevEntry = prevProps.entry;
  const nextEntry = nextProps.entry;

  // 类型不同，必须重新渲染
  if (prevEntry.type !== nextEntry.type) return false;

  // 根据 entry 类型比较关键字段
  switch (prevEntry.type) {
    case "assistant": {
      const prev = prevEntry as Extract<TimelineEntry, { type: "assistant" }>;
      const next = nextEntry as Extract<TimelineEntry, { type: "assistant" }>;
      // assistant 类型：只有当 text 或 loading 变化时才重新渲染
      return prev.text === next.text && prev.loading === next.loading;
    }
    case "user": {
      const prev = prevEntry as Extract<TimelineEntry, { type: "user" }>;
      const next = nextEntry as Extract<TimelineEntry, { type: "user" }>;
      // user 类型：只有内容变化才重新渲染
      return prev.text === next.text;
    }
    case "system": {
      const prev = prevEntry as Extract<TimelineEntry, { type: "system" }>;
      const next = nextEntry as Extract<TimelineEntry, { type: "system" }>;
      // system 类型：只有内容变化才重新渲染
      return prev.text === next.text;
    }
    case "tool": {
      const prev = prevEntry as Extract<TimelineEntry, { type: "tool" }>;
      const next = nextEntry as Extract<TimelineEntry, { type: "tool" }>;
      // tool 类型：比较 loading、status 和 output
      return (
        prev.loading === next.loading &&
        prev.status === next.status &&
        prev.output === next.output
      );
    }
    case "code_patch": {
      const prev = prevEntry as Extract<TimelineEntry, { type: "code_patch" }>;
      const next = nextEntry as Extract<TimelineEntry, { type: "code_patch" }>;
      // code_patch 类型：比较 diff
      return prev.diff === next.diff;
    }
    case "error": {
      const prev = prevEntry as Extract<TimelineEntry, { type: "error" }>;
      const next = nextEntry as Extract<TimelineEntry, { type: "error" }>;
      // error 类型：比较 error 和 phase
      return prev.error === next.error && prev.phase === next.phase;
    }
    default:
      return false;
  }
});

export function Timeline({ entries }: { entries: TimelineEntry[] }): React.JSX.Element {
  return (
    <Static  items={entries}>
      {(entry) => (
        <MemoizedTimelineItem key={entry.id} entry={entry} />
      )}
    </Static>
  );
}
