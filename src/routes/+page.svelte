<script lang="ts">
	import parseSRT from '$lib/srtToJson';
	import { getWordsFromFragment, secondsToDuration } from '$lib/utils';
	import { Howl } from 'howler';
	import { onDestroy, onMount } from 'svelte';

	let subs: ReturnType<typeof parseSRT> = [];
	let interval: NodeJS.Timeout;

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

	async function load() {
		const res = await fetch('/eng/sub.srt');
		const text = await res.text();
		subs = parseSRT(text);

		main.audio = new Howl({
			src: ['/eng/audio.mp3'],
			autoplay: false,
			onload: () => {
				console.log('onload');
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
			audio.rate(0.6);
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
				lang: 'en'
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

			stopReplay();
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

		const res = (await fetch('/api/explanation', {
			method: 'POST',
			body: JSON.stringify({
				word,
				lang: 'English',
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
			main.explanationAbortController.abort();
			stopReplay();
		}

		if (main.replayingWords) {
			main.audio.pause();

			/**
			 * Get explanation for the word
			 * and play it
			 */
			getWordExplanation();
			stopReplay();
			return;
		}

		const current = subs.find((sub) => main.time >= sub.start && main.time < sub.end);

		if (current) {
			let replayingFragmentIdx = subs.findIndex((sub) => sub.start === current.start);

			if (main.time - current.start < 0.5) {
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

	function stopReplay() {
		main.replayingWords = false;
		main.replayingWordsIdx = -1;
		main.replayingWordsAudioQueue.forEach((audio) => audio.unload());
		main.replayingWordsAudioQueue = [];

		if (main.replayExplanation) {
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
				main.explanationAbortController.abort();
			}
			stopReplay();

			handlePlayMain();
		}
		if (e.code === 'ArrowLeft') {
			e.preventDefault();
			handleBack();
		}
		if (e.code === 'ArrowRight') {
			e.preventDefault();

			if (main.replayExplanation) {
				main.explanationAbortController.abort();
			}
			stopReplay();

			// move to next fragment
			const current = subs.find((sub) => main.time >= sub.start && main.time < sub.end);
			main.audio?.seek(current?.end || 0);
			if (main.playing && !main.audio?.playing()) main.audio?.play();
		}
	}
</script>

<svelte:head>
	<title>SvelteKit ToDo App</title>
	<meta name="description" content="Todo app" />
</svelte:head>

<svelte:window on:keydown={handleKeyPress} />

<main class="px-4 m-auto py-12 max-w-4xl">
	<div class="flex gap-4">
		{#if main.audio}
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
		{:else if main.loaded}
			<p>Loading...</p>
		{:else}
			<button class="btn" on:click={load}>Load audio</button>
		{/if}
	</div>

	<hr class="mt-4" />

	{#if subs}
		<div class="space-y-4 mt-4">
			{#each subs as sub}
				{@const words = getWordsFromFragment(sub.text)}
				{@const currentFragment = main.time >= sub.start && main.time < sub.end}
				<!-- svelte-ignore a11y-click-events-have-key-events -->
				<div
					on:click={() => {
						main.audio?.seek(sub.start);
						main.time = sub.start;
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
									words.indexOf(word) !== -1
										? 'bg-slate-900 text-white'
										: currentFragment && words.indexOf(word) !== -1
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

	<!-- <button class="btn" on:click={handlePlay}>Play</button> -->
</main>
