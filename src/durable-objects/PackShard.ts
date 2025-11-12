import { DurableObject } from 'cloudflare:workers';

export interface PackShardState {
	packId: string;
	shardId: number;
	tokensAvailable: number;
	totalTokens: number;
	claimedBy: Map<string, number>;
}

export class PackShard extends DurableObject<Env> {
	private packId: string = '';
	private shardId: number = 0;
	private tokensAvailable: number = 0;
	private totalTokens: number = 0;
	private claimedBy: Map<string, number> = new Map();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.blockConcurrencyWhile(async () => {
			const state = await this.ctx.storage.get<PackShardState>('state');
			if (state) {
				this.packId = state.packId;
				this.shardId = state.shardId;
				this.tokensAvailable = state.tokensAvailable;
				this.totalTokens = state.totalTokens;
				this.claimedBy = new Map(Object.entries(state.claimedBy || {}));
			}
		});
	}

	async initialize(packId: string, shardId: number, tokens: number): Promise<void> {
		this.packId = packId;
		this.shardId = shardId;
		this.tokensAvailable = tokens;
		this.totalTokens = tokens;
		await this.saveState();
	}

	async claim(userId: string, timestamp: number): Promise<{ success: boolean; reason?: string }> {
		if (this.tokensAvailable <= 0) {
			return { success: false, reason: 'shard_empty' };
		}

		if (this.claimedBy.has(userId)) {
			return { success: false, reason: 'already_claimed' };
		}

		this.tokensAvailable--;
		this.claimedBy.set(userId, timestamp);

		await this.saveState();

		return { success: true };
	}

	async getStatus(): Promise<{
		packId: string;
		shardId: number;
		tokensAvailable: number;
		totalTokens: number;
	}> {
		return {
			packId: this.packId,
			shardId: this.shardId,
			tokensAvailable: this.tokensAvailable,
			totalTokens: this.totalTokens,
		};
	}

	async refund(userId: string): Promise<boolean> {
		if (!this.claimedBy.has(userId)) {
			return false;
		}

		this.claimedBy.delete(userId);
		this.tokensAvailable++;
		await this.saveState();
		return true;
	}

	private async saveState(): Promise<void> {
		const state: PackShardState = {
			packId: this.packId,
			shardId: this.shardId,
			tokensAvailable: this.tokensAvailable,
			totalTokens: this.totalTokens,
			claimedBy: Object.fromEntries(this.claimedBy) as any,
		};
		await this.ctx.storage.put('state', state);
	}
}
