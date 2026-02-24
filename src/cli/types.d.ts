/**
 * OpenTUI JSX 类型声明
 * 扩展 JSX.IntrinsicElements 以支持 opentui 组件
 */
import type {
  BoxProps,
  TextProps,
  SpanProps,
  CodeProps,
  MarkdownProps,
  InputProps,
  TextareaProps,
  SelectProps,
  ScrollBoxProps,
  DiffProps,
  AsciiFontProps,
  TabSelectProps,
  LineNumberProps,
  LineBreakProps,
  LinkProps,
} from "@opentui/react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      // 布局组件
      box: BoxProps;
      scrollbox: ScrollBoxProps;

      // 文本组件
      text: TextProps;
      span: SpanProps;
      code: CodeProps;
      markdown: MarkdownProps;

      // 输入组件
      input: InputProps;
      textarea: TextareaProps;
      select: SelectProps;

      // 其他组件
      diff: DiffProps;
      "ascii-font": AsciiFontProps;
      "tab-select": TabSelectProps;
      "line-number": LineNumberProps;

      // 文本修饰
      b: SpanProps;
      i: SpanProps;
      u: SpanProps;
      strong: SpanProps;
      em: SpanProps;
      br: LineBreakProps;
      a: LinkProps;
    }
  }
}
