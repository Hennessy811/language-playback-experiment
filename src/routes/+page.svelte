<script lang="ts">
	import parseSRT from '$lib/srtToJson';
	import { getWordsFromFragment, secondsToDuration } from '$lib/utils';
	import { Howl } from 'howler';
	import { omit } from 'lodash';
	import { settings } from '../stores/settings';
	import { onDestroy, onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	let subs: ReturnType<typeof parseSRT> = [];
	let interval: NodeJS.Timeout;

	let lang = 'en';

	let main = {
		loaded: false,
		playing: false,
		audio: null as Howl | null,
		time: 0,
		replayingFragmentIdx: -1,

		replayingWords: false,
		replayingWordsIdx: -1,
		replayingWordsAudioQueue: [] as Howl[],

		replayExplanation: false,
		replayingWordsExplanationAudio: null as Howl | null,

		explanationAbortController: new AbortController()
	};

	/**
	 * Load audio file and subs
	 */
	// onMount(async () => {
	// });

	async function load(langCode: string) {
		lang = langCode;
		const res = await fetch(`/${langCode}/sub.srt`);
		const text = await res.text();
		subs = parseSRT(text);

		main.audio = new Howl({
			src: [`/${langCode}/audio.mp3`],
			autoplay: false,
			onload: () => {
				main.loaded = true;
			},
			onplay: () => {
				console.log('onplay');
			},
			onend: () => {
				console.log('onend');
			}
		});

		interval = setInterval(() => {
			main.time = main.audio?.seek() || 0;
		}, 100);
	}

	onDestroy(() => {
		clearInterval(interval);
	});

	function playAudioQueue(cb: () => void) {
		if (main.replayingWordsAudioQueue.length === 0) {
			if (cb) cb();
			return;
		}

		if (main.replayingFragmentIdx === -1) return;
		if (!main.replayingWords) return;

		const audio = main.replayingWordsAudioQueue.shift();
		main.replayingWordsIdx += 1;

		if (audio) {
			audio.rate($settings.replayWordsRate);
			audio.play();
			audio.once('end', () => {
				playAudioQueue(cb);
			});
		}
	}

	async function playWordsVoiceOver() {
		main.audio?.pause();

		const fragment = subs[main.replayingFragmentIdx];
		main.replayingWords = true;
		main.replayingWordsIdx = -1;

		const res = (await fetch('/api/voiceover', {
			method: 'POST',
			body: JSON.stringify({
				text: fragment.text,
				lang
			})
		}).then((res) => res.json())) as {
			data: {
				shortText: string;
				base64: string;
			}[];
		};

		main.replayingWordsAudioQueue = res.data.map((r, i) => {
			const howl = new Howl({
				src: [`data:audio/mp3;base64,${r.base64}`]
			});

			return howl;
		});

		playAudioQueue(() => {
			if (main.replayExplanation) {
				return;
			}

			_stopReplay();
			if (main.playing && !main.audio?.playing()) {
				main.audio?.play();
			}
		});
	}

	async function getWordExplanation() {
		main.replayExplanation = true;

		const fragment = subs[main.replayingFragmentIdx];
		const words = getWordsFromFragment(fragment.text);
		const word = words[main.replayingWordsIdx];

		console.log(main.replayingFragmentIdx, { word });

		const context = [
			subs[main.replayingFragmentIdx - 1]?.text,
			fragment.text,
			subs[main.replayingFragmentIdx + 1]?.text
		].join(' ');

		const loader = await fetch('/api/voiceover', {
			method: 'POST',
			body: JSON.stringify({
				text: `${word}`,
				lang
			}),
			signal: main.explanationAbortController.signal
		}).then((res) => res.json());

		new Howl({
			src: [
				`data:audio/mp3;base64,${loader.data.map((r: { base64: string }) => r.base64).join('')}`
			],
			autoplay: true
			// rate: 1.2
		});

		const res = (await fetch('/api/explanation', {
			method: 'POST',
			body: JSON.stringify({
				word,
				lang: lang === 'en' ? 'English' : lang === 'pt' ? 'Portuguese' : 'French',
				langCode: lang,
				context
			}),
			signal: main.explanationAbortController.signal
		}).then((res) => res.json())) as {
			audio: {
				base64: string;
			}[];
		};

		/**
		 * Merge all audio base64 files into one track and play it
		 */
		const audio = new Howl({
			src: [`data:audio/mp3;base64,${res.audio.map((r) => r.base64).join('')}`],
			autoplay: true,
			onload: (e) => {
				console.log('onload');
			},
			onend: () => {
				stopReplayExplanation();
				if (main.playing && !main.audio?.playing()) main.audio?.play();
			}
		});

		main.replayingWordsExplanationAudio = audio;
	}

	/**
	 * When the user presses the right arrow key, move to the beginning of the current fragment
	 * or to the previous fragment
	 * if the current time is less than 0.5 seconds from the start of the fragment
	 */
	function handleBack() {
		if (!main.audio) return;

		if (main.replayExplanation) {
			abort();
			_stopReplay();
		}

		if (main.replayingWords) {
			main.audio.pause();

			/**
			 * Get explanation for the word
			 * and play it
			 */
			getWordExplanation();

			stopReplayWords();
			return;
		}

		const current = subs.find((sub) => main.time >= sub.start && main.time < sub.end);

		if (current) {
			let replayingFragmentIdx = subs.findIndex((sub) => sub.start === current.start);

			if (main.time - current.start < $settings.fragmentBoundsTolerance) {
				if (replayingFragmentIdx < 1) return;
				replayingFragmentIdx -= 1;
				const prev = subs[replayingFragmentIdx];

				if (prev) {
					main.audio.seek(prev.start);
					main.time = prev.start;
				}
			} else {
				main.audio.seek(current.start);
				main.time = current.start;
			}

			/**
			 * Save the index of the fragment that is being replayed
			 */
			main.replayingFragmentIdx = replayingFragmentIdx;

			playWordsVoiceOver();
		}
	}

	function stopReplayWords() {
		main.replayingWords = false;
		main.replayingWordsIdx = -1;
		main.replayingWordsAudioQueue.forEach((audio) => audio.unload());
		main.replayingWordsAudioQueue = [];
	}

	function stopReplayExplanation() {
		main.replayExplanation = false;
		main.replayingWordsExplanationAudio?.unload();
		main.replayingWordsExplanationAudio = null;
	}

	function abort() {
		main.explanationAbortController.abort();
		main.explanationAbortController = new AbortController();
	}

	/**
	 * DEPRECATED
	 */
	function _stopReplay() {
		main.replayingWords = false;
		main.replayingWordsIdx = -1;
		main.replayingWordsAudioQueue.forEach((audio) => audio.unload());
		main.replayingWordsAudioQueue = [];

		if (main.replayExplanation) {
			main.replayExplanation = false;
			main.replayingWordsExplanationAudio?.unload();
			main.replayingWordsExplanationAudio = null;
		}
	}

	function handlePlayMain(play?: boolean) {
		if (!main.audio) return;
		const shouldPlay = play ?? !main.playing;

		if (!shouldPlay) {
			main.audio.pause();
		} else {
			main.audio.play();
		}

		main.playing = shouldPlay;
	}

	function handleKeyPress(e: KeyboardEvent) {
		if (e.key === ' ') {
			e.preventDefault();

			if (main.replayExplanation) {
				abort();
			}
			_stopReplay();

			handlePlayMain();
		}
		if (e.code === 'ArrowLeft') {
			e.preventDefault();
			handleBack();
		}
		if (e.code === 'ArrowRight') {
			e.preventDefault();

			if (main.replayExplanation) {
				abort();
			}
			stopReplayExplanation();
			stopReplayWords();

			// move to next fragment
			const current = subs.findIndex((sub) => main.time >= sub.start && main.time < sub.end);
			main.audio?.seek(subs[current + 1]?.start ?? subs[0].start);
			if (main.playing && !main.audio?.playing()) main.audio?.play();
		}
	}
</script>

<svelte:head>
	<title>SvelteKit ToDo App</title>
	<meta name="description" content="Todo app" />
</svelte:head>

<svelte:window on:keydown={handleKeyPress} />

<main class="px-4 m-auto py-12 max-w-4xl relative">
	<div class="fixed top-4 left-4">
		<pre>
{JSON.stringify(
				omit(main, [
					'audio',
					'replayingWordsExplanationAudio',
					'replayingWordsAudioQueue',
					'explanationAbortController'
				]),
				null,
				2
			)
				.replace('{', '')
				.replace('}', '')}
</pre>

		<div class="prose prose-sm max-w-xs">
			<hr />
			<h2>Settings</h2>

			<div class="form-control w-full max-w-xs">
				<label class="label">
					<span class="label-text">Fragment bounds tolerance (seconds)</span>
				</label>
				<input
					type="number"
					class="input input-bordered w-full max-w-xs input-sm"
					bind:value={$settings.fragmentBoundsTolerance}
					min="0"
					step="0.1"
				/>
			</div>
			<div class="form-control w-full max-w-xs">
				<label class="label">
					<span class="label-text">Replay words rate</span>
				</label>
				<input
					type="number"
					class="input input-bordered w-full max-w-xs input-sm"
					bind:value={$settings.replayWordsRate}
					min="0"
					step="0.1"
				/>
			</div>
		</div>
	</div>

	<div class="flex gap-4">
		{#if main.audio && main.loaded}
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
		{:else if main.audio && !main.loaded}
			<!-- <p>Loading...</p> -->
		{:else}
			<div class="prose m-auto text-center">
				<h1>Pick the language to start</h1>

				<div class="flex gap-4 justify-center">
					<button class="btn" on:click={() => load('en')}> English </button>
					<button class="btn" on:click={() => load('fr')}> French </button>
					<button class="btn" on:click={() => load('pt')}> Portuguese </button>
				</div>
			</div>
		{/if}
	</div>

	<hr class="mt-4" />

	{#if subs && main.audio && main.loaded}
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

						stopReplayExplanation();
						stopReplayWords();
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
								class={`${
									currentFragment &&
									main.replayingWords &&
									main.replayingWordsIdx === words.indexOf(word) &&
									!!words.find((w) => word.includes(w))
										? 'bg-slate-900 text-white'
										: currentFragment && !!words.find((w) => word.includes(w))
										? 'bg-slate-300'
										: ''
								}`}
							>
								{word}
							</span>
						{/each}
					</p>
				</div>
			{/each}
		</div>
	{/if}

	{#if main.audio && !main.loaded}
		<div class="mt-12 prose text-center m-auto">
			<h2>Loading the audio...</h2>
			<p>Please, wait - the process can take a few minutes</p>

			<hr />

			<div class="space-y-2 text-left">
				<h3>Controls</h3>
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
		</div>
	{/if}

	<!-- <button class="btn" on:click={handlePlay}>Play</button> -->
</main>
