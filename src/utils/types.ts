export type StudentLevel = 'beginner' | 'intermediate';
export type PlaybackMode = 'regular' | 'slow_replay' | 'dictionary';
export type PlaybackModeState = 'initial' | 'playing' | 'paused' | 'loading' | 'stopped';
export type PlaybackState = Record<PlaybackMode, PlaybackModeState>;
export type StudentLanguage = 'en' | 'fr' | 'pt';
