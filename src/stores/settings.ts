import { writable } from 'svelte/store';

export const settings = writable({
	// skipToPrevFragment: true,
	fragmentBoundsTolerance: 0.5,
	replayWordsRate: 1,
	delayBetweenWordsReplay: 1
});
