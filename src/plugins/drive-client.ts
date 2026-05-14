import { type drive_v3, google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string | null;
}

export interface DriveDoc {
  name: string;
  content: string;
}

export interface DriveClient {
  listDocs(query?: string, maxResults?: number): Promise<DriveFile[]>;
  readDoc(docId: string): Promise<DriveDoc>;
}

const DOCS_MIME_TYPE = 'application/vnd.google-apps.document';
const MAX_EXPORT_BYTES = 50 * 1024;

export function createDriveClient(oauth2Client: OAuth2Client): DriveClient {
  const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: oauth2Client });
  return createDriveClientFromDrive(drive);
}

export function createDriveClientFromDrive(drive: drive_v3.Drive): DriveClient {
  return {
    async listDocs(query?: string, maxResults?: number): Promise<DriveFile[]> {
      const pageSize = Math.min(maxResults ?? 20, 100);

      const conditions: string[] = [`mimeType = '${DOCS_MIME_TYPE}'`];
      if (query) {
        const escaped = query.replace(/'/g, '\\\'');
        conditions.push(`name contains '${escaped}'`);
      }

      const q = conditions.join(' and ');

      const res = await drive.files.list({
        q,
        pageSize,
        fields: 'files(id, name, modifiedTime)',
        orderBy: 'modifiedTime desc'
      });

      return (res.data.files ?? [])
        .filter((f): f is drive_v3.Schema$File & { id: string; name: string } =>
          typeof f.id === 'string' && typeof f.name === 'string'
        )
        .map((file): DriveFile => ({
          id: file.id,
          name: file.name,
          modifiedTime: file.modifiedTime ?? null
        }));
    },

    async readDoc(docId: string): Promise<DriveDoc> {
      const meta = await drive.files.get({
        fileId: docId,
        fields: 'id, name, mimeType'
      });

      const name = meta.data.name ?? 'Untitled';

      if (meta.data.mimeType !== DOCS_MIME_TYPE) {
        throw new Error(
          `File "${name}" is not a Google Doc (mimeType: ${meta.data.mimeType}). Only Google Docs can be read.`
        );
      }

      const exportRes = await drive.files.export({
        fileId: docId,
        mimeType: 'text/plain'
      });

      const rawContent = typeof exportRes.data === 'string'
        ? exportRes.data
        : String(exportRes.data ?? '');

      const content = rawContent.length > MAX_EXPORT_BYTES
        ? rawContent.slice(0, MAX_EXPORT_BYTES)
        + `\n\n[Document truncated: ${rawContent.length} characters total. Showing first ${MAX_EXPORT_BYTES} characters.]`
        : rawContent;

      return { name, content };
    }
  };
}
