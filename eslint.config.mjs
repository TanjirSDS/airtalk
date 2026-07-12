import tsParser from '@typescript-eslint/parser'

// CLAUDE.md rule 1 enforcement: ElevenLabs (or any provider) code must never be
// imported outside packages/engine — everything else consumes VoiceEngine.
export default [
  { ignores: ['**/node_modules/**', '**/.next/**', '**/.turbo/**', '.claude/**'] },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    ignores: ['packages/engine/**'],
    languageOptions: { parser: tsParser },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['elevenlabs', 'elevenlabs/*', '@elevenlabs/*', '**/elevenlabs', '**/elevenlabs.*'],
              message:
                'Provider code lives only inside packages/engine (CLAUDE.md rule 1). Consume the VoiceEngine interface instead.',
            },
          ],
        },
      ],
    },
  },
]
