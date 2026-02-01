export default `Executes a given bash command with optional timeout. Working directory persists between
commands; shell state (everything else) does not. The shell environment is initialized
from the user's profile (bash or zsh).

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc.
DO NOT use it for file operations (reading, writing, editing, searching, finding files) -
use the specialized tools instead.

Usage notes:
- The command argument is required.
- You can specify an optional timeout in milliseconds (up to 600000ms / 10 minutes).
  If not specified, commands timeout after 120000ms (2 minutes).
- It's very helpful if you write a clear, concise description of what the command does.
  For simple commands (git, npm, standard CLI tools), keep it brief (5-10 words).
  For commands harder to parse at a glance (piped commands, obscure flags, or anything
  hard to understand at a glance), add enough context to clarify what it does.
- You can use the \`run_in_background\` parameter to run the command in the background.
  Only use this if you don't need the result immediately and are OK being notified when
  it completes later. You do not need to check the output right away - you'll be notified
  when it finishes.
- Don't use '&' at the end of the command when using this parameter.

When issuing multiple commands:
- If the commands are independent and can run in parallel, use the Bash tool in parallel
  with multiple tool calls.
- If the commands depend on each other and must run sequentially, use a single Bash
  call with '&&' to chain them together (e.g., \`mkdir foo && cd foo && ls\`), or ';'
  if they can run sequentially but the later commands should run even if earlier ones fail.

Try to maintain your current working directory throughout the session by using absolute
paths and avoiding usage of \`cd\`. You may use \`cd\` if the User explicitly requests it.`;
