declare module 'marked-terminal' {
  import { Renderer } from 'marked';
  
  interface TerminalRendererOptions {
    width?: number;
    reflowText?: boolean;
    showSectionPrefix?: boolean;
    tab?: number;
    unescape?: boolean;
    codespan?: any;
    blockquote?: any;
    heading?: any;
    hr?: any;
    list?: any;
    listitem?: any;
    paragraph?: any;
    strong?: any;
    em?: any;
    codespan?: any;
    del?: any;
    link?: any;
    href?: any;
    table?: any;
    tablecell?: any;
    firstRow?: any;
  }

  export default class TerminalRenderer extends Renderer {
    constructor(options?: TerminalRendererOptions);
  }
}
