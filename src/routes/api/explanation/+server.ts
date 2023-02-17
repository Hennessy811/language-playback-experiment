import { GOOGLE_TRANSLATE_API_KEY, OPENAI_KEY } from '$env/static/private';
import { openai } from '$lib/openai';
import { getWordsFromFragment } from '$lib/utils';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import axios from 'axios';
// @ts-expect-error this is fine
import { ChatGPTClient } from '@waylaidwanderer/chatgpt-api';

import * as googleTTS from 'google-tts-api'; // ES6 or TypeScript
import { languages } from '@/lib/languages';

interface TranslateResponse {
	data: {
		translations: {
			translatedText: string;
			detectedSourceLanguage: string;
		}[];
	};
}

const cacheOptions = {};

const chatGptClient = new ChatGPTClient(
	OPENAI_KEY,
	{
		modelOptions: {
			model: 'text-davinci-003'
		},
		debug: false
	},
	cacheOptions
);

const getPromptWithWordExamples = (
	word: string,
	context: string,
	textLanguage: string,
	mode: 'usage' | 'explanation'
) => {
	const usageSamples =
		'I want you to act as an AI language tutor. I will provide you with a word and a context in which the word is used. You will then write a few simple sentences with examples of using this word, which help the beginner to understand and learn the word.';
	const explanationPrefix =
		'I want you to act as an AI language tutor. I will provide you with a word and a context in which the word is used. You will then write a simple explanation of the word in the given context, which help the beginner to understand and learn the word.';

	const prefix = mode === 'usage' ? usageSamples : explanationPrefix;
	const prompt = `${prefix}
	
I have a word for you: ${word}. This word was used in the following context: "${context}". Answer in ${textLanguage} language`;

	return prompt;
};

async function translate({ text, to, source }: { text: string; to: string; source?: string }) {
	const url = `https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_TRANSLATE_API_KEY}`;
	const response = await axios
		.post<TranslateResponse>(url, {
			target: to,
			format: 'text',
			q: text,
			...(source && { source })
		})
		.catch((e) => {
			console.error(e);
			return null;
		});
	if (!response) throw error(500, 'Could not translate the word');

	const data = response.data?.data?.translations[0];

	return data?.translatedText;
}

export const POST = (async ({ request }) => {
	const { word, context, studentLanguage, textLanguage, isBeginner, studentName } =
		await request.json();

	const studentLangLong = languages[studentLanguage as keyof typeof languages];
	const textLangLong = languages[textLanguage as keyof typeof languages];

	/**
	 * BEGINNER FLOW:
	 * We provide a translation service for the student language with explanation.
	 *
	 * Step 1 - Translate the word to the student language
	 * Step 2 - Translate the context to the student language:
	 * Step 3 - Generate a few example sentences using the word
	 *
	 * -----
	 *
	 * So we get the following sequence:
	 *
	 * translated word (student lang) -> translated context (student lang) -> example sentences (source lang) -> translated example sentences (student lang)
	 *
	 * -----
	 *
	 * ADVANCED FLOW:
	 * We provide explanation in the source language with more context, synonyms, antonyms, and example sentences.
	 *
	 * Step 1 - Generate a simple explanation for the word in the source language
	 * Step 2 - Generate a few example sentences using the word
	 * Step 3 - Generate a few synonyms for the word
	 * Step 4 - Generate a few antonyms for the word
	 *
	 */

	if (isBeginner) {
		const introForWordTranslation = 'Translating the word';
		const introForWordTranslationText =
			studentLanguage === 'en'
				? introForWordTranslation
				: await translate({
						text: introForWordTranslation,
						to: studentLanguage,
						source: 'en'
				  });
		const introForWordTranslationAudio = await googleTTS.getAudioBase64(
			introForWordTranslationText,
			{ lang: studentLanguage }
		);

		/**
		 * Generate audio for the source word
		 */
		const sourceVoiceOverAudio = await googleTTS.getAudioBase64(word, {
			lang: textLanguage,
			slow: true
		});

		const introMergedAudio = `${introForWordTranslationAudio}${sourceVoiceOverAudio}`;

		/**
		 * Step 1 - Translate the word to the student language
		 */
		const translatedWord = await translate({
			text: word,
			to: studentLanguage,
			source: textLanguage
		});

		/**
		 * Generate audio for the translated word
		 */
		const translatedWordAudioRes = await googleTTS.getAllAudioBase64(translatedWord, {
			lang: studentLanguage
		});

		if (!translatedWordAudioRes) throw error(500, 'Could not generate audio for the word');

		const translatedWordAudio = translatedWordAudioRes.map((i) => i.base64).join('');

		/**
		 * Step 3 - Generate a few example sentences using the word
		 */
		const samples = await chatGptClient.sendMessage(
			getPromptWithWordExamples(word, context, textLangLong, 'usage')
		);

		/**
		 * Get explanation for the word
		 */
		const explanation = await chatGptClient.sendMessage(
			getPromptWithWordExamples(word, context, studentLangLong, 'explanation')
		);

		/**
		 * Generate audio for the example sentences
		 */
		const exampleSentencesAudioRes = await googleTTS.getAllAudioBase64(samples.response, {
			lang: textLanguage,
			slow: true
		});
		const explanationAudioRes = await googleTTS.getAllAudioBase64(explanation.response, {
			lang: studentLanguage
		});

		if (!exampleSentencesAudioRes || !explanationAudioRes)
			throw error(500, 'Could not generate audio for the word');

		const exampleSentencesAudio = exampleSentencesAudioRes.map((i) => i.base64).join('');
		const explanationAudio = explanationAudioRes.map((i) => i.base64).join('');

		const mergedAudio = `${introMergedAudio}${translatedWordAudio}${explanationAudio}${exampleSentencesAudio}`;

		console.log({
			examples: samples.response,
			explanation: explanation.response
		});

		return json({
			audio: mergedAudio
		});
	} else {
		return json({});
	}
}) satisfies RequestHandler;

/**
 * TODO:
 * I need to create different prompts for word explanations and word examples
 * Then - translate explanations to the student language
 * Then - translate examples to the student language
 * Then - merge all the audio
 * Then - return the audio
 */
