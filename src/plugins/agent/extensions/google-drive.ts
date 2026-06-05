import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import { createDriveClient, type DriveClient } from '../../drive-client.js';

export default function createGoogleDriveExtension(
  fastify: FastifyInstance,
  driveClient?: DriveClient
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const client = driveClient ?? createDriveClient(fastify.googleAuth.oauth2Client);

    pi.registerTool({
      name: 'drive_list_docs',
      label: 'List Google Docs',
      description:
        'List Google Docs in the user\'s Drive. Optionally filter by name. Returns file ID, name, and last modified time.',
      parameters: Type.Object({
        query: Type.Optional(
          Type.String({ description: 'Search term to filter documents by name' })
        ),
        maxResults: Type.Optional(
          Type.Number({ description: 'Maximum number of results (default 20, max 100)' })
        )
      }),
      promptSnippet: 'List or search Google Docs in the user\'s Drive',
      promptGuidelines: [
        'Use drive_list_docs to find documents by name before using drive_read_doc to read their content.'
      ],
      async execute(_toolCallId, params) {
        try {
          const files = await client.listDocs(params.query, params.maxResults);

          if (files.length === 0) {
            const searchNote = params.query ? ` matching "${params.query}"` : '';
            return {
              content: [
                { type: 'text' as const, text: `No Google Docs found${searchNote}.` }
              ],
              details: {}
            };
          }

          const lines = [
            `Found ${files.length} Google Doc${files.length === 1 ? '' : 's'}${params.query ? ` matching "${params.query}"` : ''}:`,
            '',
            ...files.map((f) => {
              const modified = f.modifiedTime ? ` | modified ${f.modifiedTime}` : '';
              return `- ${f.id} | ${f.name}${modified}`;
            })
          ];

          return {
            content: [{ type: 'text' as const, text: lines.join('\n') }],
            details: {}
          };
        } catch (error) {
          fastify.log.error(error, 'Failed to list Google Docs');
          const message = error instanceof Error ? error.message : String(error);
          const hint
            = /insufficient|403|permission/i.test(message)
              ? '\n\nHint: Your Google OAuth token may not have Drive scope. Re-run `tsx scripts/get-google-refresh-token.ts` to authorize.'
              : '';
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Failed to list Google Docs.\n${message}${hint}`
              }
            ],
            details: {}
          };
        }
      }
    });

    pi.registerTool({
      name: 'drive_read_doc',
      label: 'Read Google Doc',
      description:
        'Read the text content of a Google Doc by its file ID. Use drive_list_docs to find the ID first.',
      parameters: Type.Object({
        docId: Type.String({ description: 'The Google Drive file ID of the document' })
      }),
      promptSnippet: 'Read the content of a Google Doc',
      promptGuidelines: [
        'Use drive_read_doc when the user asks about a document. Use drive_list_docs first to find the doc ID.'
      ],
      async execute(_toolCallId, params) {
        try {
          const { name, content } = await client.readDoc(params.docId);

          const text = [`Document: "${name}" (${params.docId})`, '', content].join('\n');

          return {
            content: [{ type: 'text' as const, text }],
            details: {}
          };
        } catch (error) {
          fastify.log.error(error, 'Failed to read Google Doc');
          const message = error instanceof Error ? error.message : String(error);
          const hint
            = /insufficient|403|permission/i.test(message)
              ? '\n\nHint: Your Google OAuth token may not have Drive scope. Re-run `tsx scripts/get-google-refresh-token.ts` to authorize.'
              : '';
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Failed to read Google Doc ${params.docId}.\n${message}${hint}`
              }
            ],
            details: {}
          };
        }
      }
    });
  };
}
