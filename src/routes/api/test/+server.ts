import { GOOGLE_TRANSLATE_API_KEY, OPENAI_KEY } from '$env/static/private';
import { openai } from '$lib/openai';
import { getWordsFromFragment } from '$lib/utils';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import axios from 'axios';

import * as googleTTS from 'google-tts-api'; // ES6 or TypeScript

interface TranslateResponse {
	data: {
		translations: {
			translatedText: string;
			detectedSourceLanguage: string;
		}[];
	};
}

// @ts-expect-error this is fine
import { ChatGPTClient } from '@waylaidwanderer/chatgpt-api';

const clientOptions = {
	modelOptions: {
		// You can override the model name and any other parameters here.
		model: 'text-davinci-003'
	},
	promptPrefix:
		'I want you to act as an AI language tutor. I will provide you with a word and a context in which the word is used. You will then write a few simple sentences with examples of using this word, which help the beginner to understand and learn the word.',
	debug: false
};

const cacheOptions = {};

const chatGptClient = new ChatGPTClient(OPENAI_KEY, clientOptions, cacheOptions);

const getPromptWithWordExamples = (
	word: string,
	context: string,
	textLanguage: string,
	name?: string
) => {
	const words = getWordsFromFragment(word);

	const prompt = ` ${
		name
			? `In your answer, appeal to a student by name. Dont ask questions. Dont use the word "you". Student name is ${name}.`
			: ''
	}
		
I have a word for you: ${word}. This word was used in the following context: "${context}". Answer in ${textLanguage} language.`;

	return prompt;
};

export const POST = (async ({ request }) => {
	const { word, context, studentLanguage, textLanguage, isBeginner, studentName } =
		await request.json();

	const response = await chatGptClient.sendMessage(
		getPromptWithWordExamples(word, context, textLanguage, studentName)
	);
	console.log(response); // { response: 'Hi! How can I help you today?', conversationId: '...', messageId: '...' }

	return json({});
}) satisfies RequestHandler;
