/**
 * Test utilities for tool testing
 */

import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';

export class TestEnvironment {
    private testDir: string;
    private cleanupCallbacks: Array<() => Promise<void>> = [];

    constructor(testName: string) {
        this.testDir = path.join(tmpdir(), 'agent-tool-tests', testName);
    }

    async setup(): Promise<string> {
        await mkdir(this.testDir, { recursive: true });
        return this.testDir;
    }

    async teardown(): Promise<void> {
        for (const callback of this.cleanupCallbacks) {
            try {
                await callback();
            } catch {
                // Ignore cleanup errors
            }
        }
        this.cleanupCallbacks = [];
        try {
            await rm(this.testDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    }

    getTestDir(): string {
        return this.testDir;
    }

    get workingDir(): string {
        return this.testDir;
    }

    async createFile(relativePath: string, content: string): Promise<string> {
        const fullPath = path.join(this.testDir, relativePath);
        await mkdir(path.dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content, 'utf-8');
        return fullPath;
    }

    async readFile(relativePath: string): Promise<string> {
        const fullPath = path.join(this.testDir, relativePath);
        return await readFile(fullPath, 'utf-8');
    }

    async fileExists(relativePath: string): Promise<boolean> {
        const fs = await import('fs/promises');
        const fullPath = path.join(this.testDir, relativePath);
        try {
            await fs.access(fullPath);
            return true;
        } catch {
            return false;
        }
    }

    onCleanup(callback: () => Promise<void>): void {
        this.cleanupCallbacks.push(callback);
    }
}

export function createMockToolContext(sessionId?: string) {
    return {
        environment: process.cwd(),
        platform: process.platform,
        time: new Date().toISOString(),
        sessionId,
    };
}

export const SAMPLE_CODE = `// Sample TypeScript file
interface User {
    id: number;
    name: string;
    email: string;
}

class UserService {
    private users: User[] = [];

    addUser(user: User): void {
        this.users.push(user);
    }

    getUserById(id: number): User | undefined {
        return this.users.find(u => u.id === id);
    }

    getAllUsers(): User[] {
        return [...this.users];
    }
}

export default UserService;
`;

export const SAMPLE_MARKDOWN = `# Sample Document

This is a **markdown** document with various formatting.

## Features

- Item 1
- Item 2
- Item 3

## Code Example

\`\`\`typescript
const hello = "world";
console.log(hello);
\`\`\`

## Text Replacement Tests

This line contains OLD_TEXT that should be replaced.
This line contains more OLD_TEXT here.
Another line with DIFFERENT_TEXT to replace.

Final line.
`;

export const LARGE_FILE_CONTENT = Array.from(
    { length: 1000 },
    (_, i) => `Line ${i + 1}: Some content here with repeated patterns.`
).join('\n');

export const MULTILINE_CONTENT = `function calculateSum(a: number, b: number): number {
    const result = a + b;
    return result;
}

const OLD_FUNCTION_NAME = "calculateSum";

function OLD_FUNCTION_NAME(a: number, b: number): number {
    return a * b;
}

console.log(OLD_FUNCTION_NAME(5, 3));
`;
