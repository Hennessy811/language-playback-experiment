import { getWordsFromFragment } from '$lib/utils';
import { json, type RequestHandler } from '@sveltejs/kit';
import * as googleTTS from 'google-tts-api'; // ES6 or TypeScript

export const POST = (async ({ request }) => {
	const { text, lang } = await request.json();
	const res = await Promise.all(
		getWordsFromFragment(text).map((word) => {
			return googleTTS.getAllAudioBase64(word, {
				lang: lang ?? 'en'
			});
		})
	).catch((e) => {
		console.log(e);
		return [];
	});

	return json({ data: res.flat() });
}) satisfies RequestHandler;
