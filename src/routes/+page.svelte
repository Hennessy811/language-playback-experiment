<script lang="ts">
	import parseSRT from '$lib/srtToJson';
	import { cx, getWordsFromFragment, secondsToDuration } from '$lib/utils';
	import { Howl } from 'howler';
	import _ from 'lodash';
	import { settings } from '@/stores/settings';
	import { onDestroy, onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import type {
		PlaybackMode,
		PlaybackModeState,
		PlaybackState,
		StudentLanguage,
		StudentLevel
	} from '@/utils/types';
	import Settings from '@/components/Settings.svelte';
	import LoadingScreen from '@/components/LoadingScreen.svelte';
	import { languages } from '@/lib/languages';

	const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	let subs: ReturnType<typeof parseSRT> = [];
	let interval: NodeJS.Timeout;

	$: lang = 'en' as StudentLanguage;
	$: studentLevel = 'beginner' as StudentLevel;
	$: studentLang = 'en';
	$: mode = 'regular' as PlaybackMode;
	$: state = {
		dictionary: 'initial',
		regular: 'initial',
		slow_replay: 'initial'
	} as PlaybackState;

	const bgPerMode: Record<PlaybackMode, string> = {
		dictionary: 'bg-yellow-100',
		regular: 'bg-blue-100',
		slow_replay: 'bg-green-100'
	};

	let main = {
		// loaded: false,
		playing: false,
		audio: null as Howl | null,
		time: 0,
		replayingFragmentIdx: -1,

		// replayingWords: false,
		replayingWordsIdx: -1,
		replayingWordsAudioQueue: [] as Howl[],
		replaySingleWord: false,

		replayExplanation: false,
		replayingWordsExplanationAudio: null as Howl | null,

		explanationAbortController: new AbortController()
	};

	$: replayingWordsList = getWordsFromFragment(subs[main.replayingFragmentIdx]?.text ?? '');
	$: replayingWord = replayingWordsList[main.replayingWordsIdx];
	$: currentFragmentIdx = subs.findIndex((sub) => main.time >= sub.start && main.time < sub.end);

	const setState = (type: PlaybackMode, value: PlaybackModeState) => {
		state[type] = value;
		state = { ...state };
	};

	async function load(langCode: StudentLanguage) {
		lang = langCode;

		const res = await fetch(`/${langCode}/sub.srt`);
		const text = await res.text();
		subs = parseSRT(text);

		setState('regular', 'loading');
		main.audio = new Howl({
			src: [`/${langCode}/audio.mp3`],
			autoplay: false,
			onload: () => {
				setState('regular', 'paused');
			},
			onplay: () => {
				mode = 'regular';
				setState('regular', 'playing');
			},
			onend: () => {
				setState('regular', 'paused');
			},
			onpause: () => {
				setState('regular', 'paused');
			},
			onstop: () => {
				setState('regular', 'paused');
			}
		});

		interval = setInterval(() => {
			main.time = main.audio?.seek() || 0;
		}, 100);
	}

	onDestroy(() => {
		clearInterval(interval);
	});

	async function getVoiceoverSrc(text: string, merge = false, lang = studentLang) {
		const loader = (await fetch('/api/voiceover', {
			method: 'POST',
			body: JSON.stringify({
				text,
				lang
			})
		}).then((res) => res.json())) as {
			data: {
				shortText: string;
				base64: string;
			}[];
		};

		if (merge)
			return `data:audio/mp3;base64,${loader.data
				.map((r: { base64: string }) => r.base64)
				.join('')}`;
		else return loader.data;
	}

	async function voiceoverForPhrase(text: string, lang = studentLang) {
		const src = await getVoiceoverSrc(text, true, lang);
		new Howl({
			src: [src as string],
			autoplay: true
		});
	}

	async function playAudioQueue(cb: () => void) {
		if (main.replayingWordsIdx > main.replayingWordsAudioQueue.length - 1) {
			if (cb) cb();
			return;
		}

		if (mode !== 'slow_replay') return;

		const audio = main.replayingWordsAudioQueue[main.replayingWordsIdx];

		if (audio) {
			audio.rate($settings.replayWordsRate);
			await delay($settings.delayBetweenWordsReplay * 1000);

			console.log('playAudioQueue', mode, state.slow_replay);
			if (state.slow_replay === 'stopped') return;
			audio.play();

			audio.once('end', async () => {
				main.replayingWordsIdx += 1;
				if (main.replaySingleWord) {
					main.replaySingleWord = false;
					return;
				}
				playAudioQueue(cb);
			});
		}
	}

	async function playWordsVoiceOver() {
		main.audio?.pause();
		mode = 'slow_replay';
		state.slow_replay = 'loading';

		main.replayingFragmentIdx = currentFragmentIdx;
		const fragment = subs[currentFragmentIdx];

		const res = (await getVoiceoverSrc(fragment.text)) as {
			shortText: string;
			base64: string;
		}[];

		main.replayingWordsAudioQueue = res.map((r, i) => {
			const howl = new Howl({
				src: [`data:audio/mp3;base64,${r.base64}`],
				// onload: () => {
				// 	setState('slow_replay', 'paused');
				// },
				onplay: () => {
					setState('slow_replay', 'playing');
				},
				onend: () => {
					setState('slow_replay', 'paused');
				},
				onpause: () => {
					setState('slow_replay', 'paused');
				},
				onstop: () => {
					setState('slow_replay', 'stopped');
				}
			});

			return howl;
		});

		main.replayingWordsIdx = 0;
		main.replaySingleWord = false;
		playAudioQueue(() => {
			if (mode === 'dictionary') {
				return;
			}

			if (state.regular === 'playing' && !main.audio?.playing()) {
				main.audio?.play();
			}
		});
	}

	async function getWordExplanation() {
		// main.replayExplanation = true;
		mode = 'dictionary';
		setState('dictionary', 'loading');

		const fragment = subs[currentFragmentIdx];

		const context = [
			subs[currentFragmentIdx - 1]?.text,
			fragment.text,
			subs[currentFragmentIdx + 1]?.text
		].join(' ');

		await delay(500);
		voiceoverForPhrase(`${replayingWord}`);

		const res = (await fetch('/api/explanation', {
			method: 'POST',
			body: JSON.stringify({
				word: replayingWord,
				lang: lang === 'en' ? 'English' : lang === 'pt' ? 'Portuguese' : 'French',
				langCode: lang,
				...(studentLevel === 'beginner' && { translateTo: studentLang }),
				context
			}),
			signal: main.explanationAbortController.signal
		}).then((res) => res.json())) as {
			audio: {
				base64: string;
			}[];
			translatedAudio?: {
				base64: string;
			}[];
		};

		/**
		 * Merge all audio base64 files into one track and play it
		 */
		const audio = new Howl({
			src: [
				`data:audio/mp3;base64,${[
					res.audio.map((r) => r.base64).join(''),
					res.translatedAudio?.map((r) => r.base64).join('') ?? ''
				].join('')}`
			],
			autoplay: true,
			onplay: (e) => {
				setState('dictionary', 'playing');
			},
			onend: () => {
				setState('dictionary', 'paused');
				stopReplayExplanation();
				if (main.playing && !main.audio?.playing()) main.audio?.play();
			},
			onpause: () => {
				setState('dictionary', 'paused');
			},
			onstop: () => {
				setState('dictionary', 'paused');
			}
		});

		main.replayingWordsExplanationAudio = audio;
	}

	function unloadReplayWords() {
		main.replayingWordsAudioQueue.forEach((audio) => {
			audio.unload();
		});
		main.replayingWordsAudioQueue = [];
	}

	function stopReplayWords() {
		setState('slow_replay', 'paused');
		main.replayingWordsAudioQueue.forEach((audio) => {
			audio.stop();
		});
	}

	function stopReplayExplanation() {
		main.replayingWordsExplanationAudio?.stop();
		main.replayingWordsExplanationAudio?.unload();
		main.replayingWordsExplanationAudio = null;
		mode = 'regular';
		setState('dictionary', 'paused');
	}

	function abortLoadingExplanation() {
		voiceoverForPhrase(`Explanation stopped`, 'en');
		mode = 'regular';
		setState('dictionary', 'paused');
		main.explanationAbortController.abort();
		main.explanationAbortController = new AbortController();

		stopReplayExplanation();
	}

	function handlePlayMain(play?: boolean) {
		if (!main.audio) return;
		const shouldPlay = play ?? !main.playing;

		if (!shouldPlay) {
			main.audio.pause();
		} else {
			main.audio.play();
		}

		shouldPlay ? setState('regular', 'playing') : setState('regular', 'paused');
		main.playing = shouldPlay;
	}

	function moveToPreviousFragment() {
		if (!main.audio) return;
		if (currentFragmentIdx < 1) return;

		const prev = subs[currentFragmentIdx - 1];
		main.audio.seek(prev.start);
		main.time = prev.start;
	}

	function moveToNextFragment() {
		if (!main.audio) return;
		if (currentFragmentIdx === subs.length - 1) return;

		const next = subs[currentFragmentIdx + 1];
		main.audio.seek(next.start);
		main.time = next.start;
	}

	/**
	 	
		REGULAR MODE
		> next fragment
		< previous fragment
		^ move to slow play mode

		SLOW REPLAY mode
		> next word
		< previous word
		^ dictionary mode
		[down] back to REGULAR mode

		DICTIONARY mode
		<> translate - definition - synonyms/antonyms - example in context
		^ back to slow play mode

	 */
	async function handleKeyPress(e: KeyboardEvent) {
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (state.regular === 'initial') return;

			/**
			 * Load explanation for the word
			 */
			if (mode === 'slow_replay') {
				getWordExplanation();
			}

			if (mode === 'regular') {
				playWordsVoiceOver();
			}
		}

		/**
		 * Move one mode back
		 */
		if (e.code === 'ArrowDown') {
			e.preventDefault();
			if (state.regular === 'initial') return;

			if (mode === 'slow_replay') {
				mode = 'regular';
				stopReplayWords();
				unloadReplayWords();

				await delay(1000);
				voiceoverForPhrase(`Normal play mode`, 'en');
			}

			/**
			 * Back to slow play mode
			 */
			if (mode === 'dictionary') {
				abortLoadingExplanation();

				await delay(2000);

				voiceoverForPhrase(`Words replay mode`, 'en');
				await delay(2000);

				playWordsVoiceOver();
			}
		}

		if (e.code === 'ArrowLeft') {
			e.preventDefault();
			if (state.regular === 'initial') return;
			if (mode === 'regular') {
				moveToPreviousFragment();
			}
			if (mode === 'slow_replay') {
				if (main.replayingWordsIdx < 0) return;
				stopReplayWords();
				main.replaySingleWord = true;
				main.replayingWordsIdx--;
				main.replayingWordsAudioQueue[main.replayingWordsIdx].play();
			}
		}

		if (e.code === 'ArrowRight') {
			e.preventDefault();
			if (state.regular === 'initial') return;
			if (mode === 'regular') {
				moveToNextFragment();
			}
			if (mode === 'slow_replay') {
				if (main.replayingWordsIdx === main.replayingWordsAudioQueue.length - 1) return;
				stopReplayWords();
				main.replaySingleWord = true;
				main.replayingWordsIdx++;
				main.replayingWordsAudioQueue[main.replayingWordsIdx].play();
			}
		}

		if (e.code === 'Space') {
			e.preventDefault();

			if (mode === 'regular') {
				handlePlayMain();
			}
			if (mode === 'dictionary') {
				abortLoadingExplanation();
			}
			if (mode === 'slow_replay') {
				// stopReplayWords();
				if (state.slow_replay === 'stopped') {
					playWordsVoiceOver();
				} else if (state.slow_replay === 'playing' || state.slow_replay === 'paused') {
					stopReplayWords();

					voiceoverForPhrase(`Replay stopped`, 'en');
				}
			}
		}
	}
</script>

<svelte:head>
	<title>SvelteKit ToDo App</title>
	<meta name="description" content="Todo app" />
</svelte:head>

<svelte:window on:keydown={handleKeyPress} />

<div class={cx('fixed top-0 left-0 w-full h-full transition', bgPerMode[mode])} />

{#if state.dictionary === 'loading'}
	<div class="fixed top-4 right-4 text-xl font-medium animate-pulse text-slate-600">
		<i class="fa-solid fa-spinner animate-spin" />
		Loading...
	</div>
{/if}

<main class="px-4 m-auto py-12 max-w-4xl relative">
	<div class="fixed top-4 left-4">
		<pre>
{JSON.stringify(
				{
					mode,
					state,
					studentLevel,
					studentLang,
					time: main.time,
					replayingWord,
					replayingWordsIdx: main.replayingWordsIdx,
					replayingWordsList
				},
				null,
				2
			)
				.replace('{', '')
				.replace('}', '')}
</pre>

		<Settings />
	</div>

	<div class="flex gap-4">
		{#if main.audio && state.regular !== 'loading'}
			{#if main.playing}
				<button class="btn" on:click={() => handlePlayMain()}>Pause</button>
			{:else}
				<button class="btn" on:click={() => handlePlayMain()}>Play</button>
			{/if}
			<div class="bg-slate-200 w-0.5" />

			<div>
				<p class="text-xs font-mono">
					{secondsToDuration(main.time)} / {secondsToDuration(main.audio?.duration())}
				</p>
			</div>

			<div class="bg-slate-200 w-0.5" />

			<div class="space-y-2">
				<div class="text-sm">
					<p class="kbd kbd-xs font-mono font-bold">Space</p>
					- play/pause
				</div>
				<div class="text-sm">
					<p class="kbd kbd-xs font-mono font-bold">Arrow Left</p>
					- Enter replay mode (Play each word in segment)
				</div>
				<div class="text-sm">
					<p class="kbd kbd-xs font-mono font-bold">Arrow Left (in replay mode)</p>
					- Select the word for explanation
				</div>
				<div class="text-sm">
					<p class="kbd kbd-xs font-mono font-bold">Arrow Right</p>
					- Continue playing
				</div>
			</div>
		{/if}

		{#if state.regular === 'initial'}
			<div class="prose m-auto text-center max-w-md">
				<h1>Select your language level</h1>

				<select class="select w-full" bind:value={studentLevel}>
					<option value="beginner">Beginner</option>
					<option value="intermediate">Intermediate+</option>
				</select>

				{#if studentLevel === 'beginner'}
					<select class="select w-full mt-4" bind:value={studentLang}>
						{#each _.entries(languages) as lang}
							<option value={lang[0]}>{lang[1]}</option>
						{/each}
					</select>
				{/if}

				<h2>then pick the language to start</h2>

				<div class="flex gap-4 justify-center">
					<button class="btn" on:click={() => load('en')}> English </button>
					<button class="btn" on:click={() => load('fr')}> French </button>
					<button class="btn" on:click={() => load('pt')}> Portuguese </button>
				</div>
			</div>
		{/if}
	</div>

	<hr class="mt-4" />

	{#if subs && main.audio && state.regular !== 'loading'}
		<div
			in:fade
			class={`space-y-4 mt-4 transition relative ${
				main.replayExplanation ? 'pointer-events-none opacity-30' : ''
			}`}
		>
			{#if main.replayExplanation}
				<div
					in:fade
					class="prose max-w-full m-auto text-center top-36 left-0 w-full my-12 absolute flex justify-center"
				>
					<h1 class="animate-pulse bg-slate-600 text-white font-mono">Explaining...</h1>
				</div>
			{/if}
			{#each subs as sub}
				{@const words = getWordsFromFragment(sub.text)}
				{@const currentFragment = main.time >= sub.start && main.time < sub.end}
				<!-- svelte-ignore a11y-click-events-have-key-events -->
				<div
					on:click={() => {
						main.audio?.seek(sub.start);
						main.time = sub.start;

						if (mode === 'dictionary') abortLoadingExplanation();
						stopReplayWords();
						unloadReplayWords();
						mode = 'regular';
					}}
					class={`border-2 rounded-md flex gap-4 items-start px-4 py-2 cursor-pointer  transition ${
						currentFragment ? 'border-black' : 'border-transparent hover:border-slate-400'
					}`}
				>
					<p class="text-xs font-mono w-16 text-right pr-4 border-r border-slate-400">
						{secondsToDuration(sub.start)}
						<br />
						{secondsToDuration(sub.end)}
					</p>
					<p>
						{#each sub.text.split(' ') as word}
							<span
								class={cx(
									'cursor-pointer',
									currentFragment
										? word.includes(replayingWord)
											? 'bg-slate-700 text-white'
											: 'bg-slate-200'
										: ''
								)}
							>
								{word}
							</span>
						{/each}
					</p>
				</div>
			{/each}
		</div>
	{/if}

	{#if main.audio && state.regular === 'loading' && mode === 'regular'}
		<LoadingScreen />
	{/if}
</main>
