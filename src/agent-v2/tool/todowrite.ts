export const DESCRIPTION_WRITE = `⚠️ CRITICAL: Use this tool to BREAK DOWN and TRACK complex tasks.

## 🎯 PRIMARY USE: Task Breakdown & Progress Tracking

This tool is your PRIMARY way to:
1. **Break down complex tasks into manageable steps**
2. **Track your progress in real-time**
3. **Communicate your plan to the user**
4. **Ensure nothing is forgotten**

## ⚠️ MANDATORY USAGE (NON-NEGOTIABLE)

You MUST use this tool IMMEDIATELY when:
- Task requires 3+ steps
- Multiple files need to be analyzed/modified
- User provides multiple requirements
- Any non-trivial implementation work
- Analysis tasks involving multiple files

**YOUR FIRST ACTION for complex tasks should be: Create a todo list**

## 📋 How to Break Down Tasks

### Good Task Breakdown Example:
❌ BAD: "Implement feature" (too vague)
✅ GOOD:
  - "Analyze current codebase structure"
  - "Review existing authentication implementation"
  - "Design new API endpoint structure"
  - "Implement backend API endpoint"
  - "Create frontend components"
  - "Add error handling"
  - "Write unit tests"
  - "Test the complete feature"
  - "Document the changes"

### Task Breakdown Principles:
1. **Be specific** - Each task should be clear and actionable
2. **Be granular** - Break large tasks into 30min-2hr chunks
3. **Use action verbs** - "Implement", "Fix", "Test", "Review", "Analyze"
4. **Think in steps** - What needs to happen first? What depends on what?
5. **Include testing** - Always add test/verification steps
6. **Include documentation** - Add doc updates if needed


## 🔄 Real-Time Updates (CRITICAL)

You MUST update the todo list after EACH subtask:
- Mark current task as completed
- Mark next task as in_progress
- Add new tasks if discovered
- Remove irrelevant tasks

### Update Workflow:
Initial: [Task1: in_progress, Task2: pending, Task3: pending]
After Task1: [Task1: completed, Task2: in_progress, Task3: pending]

## 📊 Task States

- pending: Not started yet
- in_progress: Currently working (ONLY ONE at a time!)
- completed: Successfully finished
- cancelled: No longer needed

## ⚡ Quick Examples

### Example 1: Feature Implementation
User: "Add user login with JWT"
You: Create todo:
  - "Review existing authentication code"
  - "Design JWT token structure"
  - "Implement login API endpoint"
  - "Create JWT middleware"
  - "Add frontend login form"
  - "Implement token refresh logic"
  - "Write tests for authentication"
  - "Test login flow end-to-end"

### Example 2: Bug Fix
User: "Fix the memory leak in the dashboard"
You: Create todo:
  - "Analyze dashboard component code"
  - "Identify potential memory leak sources"
  - "Add memory profiling logs"
  - "Implement fix for identified leak"
  - "Test memory usage before/after"
  - "Verify fix resolves issue"

### Example 3: Code Analysis
User: "Analyze this project's architecture"
You: Create todo:
  - "Explore project structure"
  - "Identify main entry points"
  - "Analyze component dependencies"
  - "Review data flow patterns"
  - "Document architecture findings"

## ❌ When NOT to Use

Skip for:
- Single trivial actions (e.g., "read this file")
- Pure informational queries
- One-command executions

## ✅ Best Practices

1. **Create FIRST** - Before any other tool calls for complex tasks
2. **Update OFTEN** - After each subtask completion
3. **Be SPECIFIC** - Clear, actionable task names
4. **Think SEQUENTIALLY** - What's the logical order?
5. **Include VERIFICATION** - Always add test/verify steps
6. **One IN_PROGRESS** - Never have multiple active tasks
7. **CommunicATE** - Let user see your plan and progress

Remember: Good task breakdown = Better results = Happy user
`;
