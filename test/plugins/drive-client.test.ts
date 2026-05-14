import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDriveClientFromDrive } from '../../src/plugins/drive-client.js';
import type { drive_v3 } from 'googleapis';

function createMockDrive() {
  return {
    files: {
      list: vi.fn(),
      get: vi.fn(),
      export: vi.fn()
    }
  };
}

const DOCS_MEDIA_TYPE = 'application/vnd.google-apps.document';

describe('DriveClient', () => {
  let mockDrive: ReturnType<typeof createMockDrive>;

  beforeEach(() => {
    mockDrive = createMockDrive();
  });

  describe('listDocs', () => {
    it('lists docs without a query', async () => {
      mockDrive.files.list.mockResolvedValue({
        data: {
          files: [
            { id: 'doc-1', name: 'Meeting Notes', modifiedTime: '2024-01-15T10:30:00.000Z' },
            { id: 'doc-2', name: 'Shopping List', modifiedTime: '2024-02-20T14:00:00.000Z' }
          ]
        }
      });

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);
      const result = await client.listDocs();

      expect(result).toEqual([
        { id: 'doc-1', name: 'Meeting Notes', modifiedTime: '2024-01-15T10:30:00.000Z' },
        { id: 'doc-2', name: 'Shopping List', modifiedTime: '2024-02-20T14:00:00.000Z' }
      ]);

      expect(mockDrive.files.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: `mimeType = '${DOCS_MEDIA_TYPE}'`,
          pageSize: 20,
          fields: 'files(id, name, modifiedTime)',
          orderBy: 'modifiedTime desc'
        })
      );
    });

    it('lists docs with a name query', async () => {
      mockDrive.files.list.mockResolvedValue({
        data: {
          files: [{ id: 'doc-1', name: 'Meeting Notes', modifiedTime: '2024-01-15T10:30:00.000Z' }]
        }
      });

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);
      const result = await client.listDocs('Meeting');

      expect(result).toEqual([
        { id: 'doc-1', name: 'Meeting Notes', modifiedTime: '2024-01-15T10:30:00.000Z' }
      ]);

      expect(mockDrive.files.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: `mimeType = '${DOCS_MEDIA_TYPE}' and name contains 'Meeting'`
        })
      );
    });

    it('escapes single quotes in query terms', async () => {
      mockDrive.files.list.mockResolvedValue({ data: { files: [] } });

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);
      await client.listDocs('O\'Brien');

      expect(mockDrive.files.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: `mimeType = '${DOCS_MEDIA_TYPE}' and name contains 'O\\'Brien'`
        })
      );
    });

    it('respects maxResults with default 20', async () => {
      mockDrive.files.list.mockResolvedValue({ data: { files: [] } });

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);
      await client.listDocs();

      expect(mockDrive.files.list).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 20 })
      );
    });

    it('caps maxResults at 100', async () => {
      mockDrive.files.list.mockResolvedValue({ data: { files: [] } });

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);
      await client.listDocs(undefined, 200);

      expect(mockDrive.files.list).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 100 })
      );
    });

    it('returns empty array when no files found', async () => {
      mockDrive.files.list.mockResolvedValue({ data: { files: [] } });

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);
      const result = await client.listDocs();

      expect(result).toEqual([]);
    });

    it('filters out files missing required fields', async () => {
      mockDrive.files.list.mockResolvedValue({
        data: {
          files: [
            { id: 'doc-1', name: 'Valid Doc', modifiedTime: '2024-01-01T00:00:00.000Z' },
            { id: undefined, name: 'No ID', modifiedTime: null },
            { id: 'doc-3', name: undefined, modifiedTime: null }
          ]
        }
      });

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);
      const result = await client.listDocs();

      expect(result).toEqual([
        { id: 'doc-1', name: 'Valid Doc', modifiedTime: '2024-01-01T00:00:00.000Z' }
      ]);
    });
  });

  describe('readDoc', () => {
    it('returns document name and content', async () => {
      mockDrive.files.get.mockResolvedValue({
        data: { id: 'doc-1', name: 'My Doc', mimeType: DOCS_MEDIA_TYPE }
      });
      mockDrive.files.export.mockResolvedValue({
        data: 'Hello, this is my document content.'
      });

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);
      const result = await client.readDoc('doc-1');

      expect(result).toEqual({
        name: 'My Doc',
        content: 'Hello, this is my document content.'
      });

      expect(mockDrive.files.get).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 'doc-1', fields: 'id, name, mimeType' })
      );
      expect(mockDrive.files.export).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 'doc-1', mimeType: 'text/plain' })
      );
    });

    it('defaults name to Untitled when missing', async () => {
      mockDrive.files.get.mockResolvedValue({
        data: { id: 'doc-1', name: undefined, mimeType: DOCS_MEDIA_TYPE }
      });
      mockDrive.files.export.mockResolvedValue({
        data: 'Some content.'
      });

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);
      const result = await client.readDoc('doc-1');

      expect(result.name).toBe('Untitled');
    });

    it('truncates content exceeding 50KB', async () => {
      const longContent = 'A'.repeat(60_000);
      mockDrive.files.get.mockResolvedValue({
        data: { id: 'doc-1', name: 'Long Doc', mimeType: DOCS_MEDIA_TYPE }
      });
      mockDrive.files.export.mockResolvedValue({
        data: longContent
      });

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);
      const result = await client.readDoc('doc-1');

      expect(result.content.length).toBeLessThan(60_000);
      expect(result.content).toContain('[Document truncated: 60000 characters total');
      expect(result.content).toContain('Showing first 51200 characters');
      expect(result.content.startsWith('A')).toBe(true);
    });

    it('does not truncate content under 50KB', async () => {
      const shortContent = 'A'.repeat(1000);
      mockDrive.files.get.mockResolvedValue({
        data: { id: 'doc-1', name: 'Short Doc', mimeType: DOCS_MEDIA_TYPE }
      });
      mockDrive.files.export.mockResolvedValue({
        data: shortContent
      });

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);
      const result = await client.readDoc('doc-1');

      expect(result.content).toBe(shortContent);
      expect(result.content).not.toContain('[Document truncated');
    });

    it('throws for non-Google Doc file types', async () => {
      mockDrive.files.get.mockResolvedValue({
        data: { id: 'sheet-1', name: 'Budget Sheet', mimeType: 'application/vnd.google-apps.spreadsheet' }
      });

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);

      await expect(client.readDoc('sheet-1')).rejects.toThrow(
        'File "Budget Sheet" is not a Google Doc'
      );
    });

    it('propagates API errors from files.get', async () => {
      mockDrive.files.get.mockRejectedValue(new Error('File not found: abc123'));

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);

      await expect(client.readDoc('abc123')).rejects.toThrow('File not found: abc123');
    });

    it('propagates API errors from files.export', async () => {
      mockDrive.files.get.mockResolvedValue({
        data: { id: 'doc-1', name: 'My Doc', mimeType: DOCS_MEDIA_TYPE }
      });
      mockDrive.files.export.mockRejectedValue(new Error('Export failed'));

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);

      await expect(client.readDoc('doc-1')).rejects.toThrow('Export failed');
    });

    it('handles non-string export data', async () => {
      mockDrive.files.get.mockResolvedValue({
        data: { id: 'doc-1', name: 'My Doc', mimeType: DOCS_MEDIA_TYPE }
      });
      mockDrive.files.export.mockResolvedValue({
        data: { some: 'object' }
      });

      const client = createDriveClientFromDrive(mockDrive as unknown as drive_v3.Drive);
      const result = await client.readDoc('doc-1');

      expect(result.content).toBe('[object Object]');
    });
  });
});
