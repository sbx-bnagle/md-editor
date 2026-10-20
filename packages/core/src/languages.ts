// File extension -> highlight.js language name, for code files embedded as content blocks.

const MAP: Record<string, string> = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'ini', '.ini': 'ini',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.html': 'xml', '.htm': 'xml', '.xml': 'xml', '.plist': 'xml',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'bash',
  '.py': 'python', '.rb': 'ruby', '.php': 'php', '.pl': 'perl', '.lua': 'lua', '.r': 'r',
  '.swift': 'swift', '.m': 'objectivec', '.mm': 'objectivec', '.h': 'c', '.c': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp', '.cs': 'csharp', '.java': 'java', '.kt': 'kotlin',
  '.go': 'go', '.rs': 'rust', '.sql': 'sql', '.diff': 'diff', '.patch': 'diff',
  '.graphql': 'graphql', '.makefile': 'makefile', '.mk': 'makefile', '.vb': 'vbnet',
};

export function languageForExtension(ext: string): string | undefined {
  return MAP[ext.toLowerCase()];
}
