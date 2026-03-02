import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AtomicJsonStore } from '../atomic-json';

describe('AtomicJsonStore', () => {
    let tempDir: string;
    let store: AtomicJsonStore;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-json-store-'));
        store = new AtomicJsonStore();
    });

    afterEach(async () => {
        await store.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('writes and reads json content', async () => {
        const filePath = path.join(tempDir, 'data.json');
        await store.writeJsonFile(filePath, { value: 1 });
        const loaded = await store.readJsonFile<{ value: number }>(filePath);
        expect(loaded).toEqual({ value: 1 });
    });

    it('recovers from corrupted primary file using backup', async () => {
        const filePath = path.join(tempDir, 'data.json');
        await store.writeJsonFile(filePath, { value: 'v1' });
        await store.writeJsonFile(filePath, { value: 'v2' }); // backup becomes v1
        await fs.writeFile(filePath, '{', 'utf-8');

        const loaded = await store.readJsonFile<{ value: string }>(filePath);
        expect(loaded).toEqual({ value: 'v1' });
    });

    it('restores missing primary file from backup', async () => {
        const filePath = path.join(tempDir, 'data.json');
        await store.writeJsonFile(filePath, { value: 'v1' });
        await store.writeJsonFile(filePath, { value: 'v2' }); // backup becomes v1
        await fs.unlink(filePath);

        const loaded = await store.readJsonFile<{ value: string }>(filePath);
        expect(loaded).toEqual({ value: 'v1' });
        await expect(fs.access(filePath)).resolves.toBeUndefined();
    });
});
