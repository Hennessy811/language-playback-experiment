<script>
	import { settings } from '@/stores/settings';
</script>

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
	<div class="form-control w-full max-w-xs">
		<label class="label">
			<span class="label-text">Delay between words replay (seconds)</span>
		</label>
		<input
			type="number"
			class="input input-bordered w-full max-w-xs input-sm"
			bind:value={$settings.delayBetweenWordsReplay}
			min="0"
			step="0.5"
		/>
	</div>
</div>
