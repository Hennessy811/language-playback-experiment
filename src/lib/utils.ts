function uniq(array: any[]) {
	return Array.from(new Set(array));
}

export const getWordsFromFragment = (fragment: string) =>
	uniq(
		fragment
			.split(' ')
			.map((i) => i.trim().replace(/[-[\]{}()*+?.,^$|#\s]/g, '')) // remove punctuation
			.filter((i) => i.length > 2)
	);

export function secondsToDuration(seconds: number) {
	if (isNaN(seconds)) {
		return 'Invalid input';
	}

	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	let duration = '';
	if (hours > 0) {
		duration += hours + 'h ';
	}
	if (minutes > 0) {
		duration += minutes + 'm ';
	}
	if (secs >= 0) {
		duration += secs.toFixed(0) + 's';
	}

	return duration.trim();
}
