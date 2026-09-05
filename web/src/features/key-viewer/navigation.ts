export type KeyViewerPage = 'overview' | 'analysis' | 'events' | 'auth-files' | 'ranking';
export type KeyViewerPath = '/key-overview' | '/key-analysis' | '/key-events' | '/key-auth-files' | '/key-ranking';

export const KEY_VIEWER_PAGE_PATHS: Record<KeyViewerPage, KeyViewerPath> = {
  overview: '/key-overview',
  analysis: '/key-analysis',
  events: '/key-events',
  'auth-files': '/key-auth-files',
  ranking: '/key-ranking',
};

const KEY_VIEWER_PATHS = new Set<KeyViewerPath>(Object.values(KEY_VIEWER_PAGE_PATHS));

export const isKeyViewerPath = (path: string): path is KeyViewerPath => KEY_VIEWER_PATHS.has(path as KeyViewerPath);
