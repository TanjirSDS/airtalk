import tsParser from '@typescript-eslint/parser'

// CLAUDE.md rule 1 enforcement: ElevenLabs (or any provider) code must never be
// imported outside packages/engine — everything else consumes VoiceEngine.
const ELEVENLABS = {
  group: ['elevenlabs', 'elevenlabs/*', '@elevenlabs/*', '**/elevenlabs', '**/elevenlabs.*'],
  message:
    'Provider code lives only inside packages/engine (CLAUDE.md rule 1). Consume the VoiceEngine interface instead.',
}
// Phase 18: the @xyflow flow-canvas library is fenced to apps/web/components/flow/**
// so the graph editor stays isolated (mirrors the provider fence).
const XYFLOW = {
  group: ['@xyflow/react', '@xyflow/*', '@xyflow/**'],
  message: 'The flow canvas (@xyflow/react) is confined to apps/web/components/flow/** (Phase 18).',
}

export default [
  { ignores: ['**/node_modules/**', '**/.next/**', '**/.turbo/**', '.claude/**'] },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    ignores: ['packages/engine/**'],
    languageOptions: { parser: tsParser },
    rules: {
      'no-restricted-imports': ['error', { patterns: [ELEVENLABS, XYFLOW] }],
    },
  },
  {
    // The flow dir may import @xyflow (later object wins for these files); the
    // elevenlabs fence still applies here.
    files: ['apps/web/components/flow/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [ELEVENLABS] }],
    },
  },
]
