import { DurableObject } from 'cloudflare:workers';
import type { UserInventory, CardInventoryItem } from '../types';

export interface UserState {
	userId: string;
	inventory: UserInventory;
	lastUpdated: number;
}

export class User extends DurableObject<Env> {
	private userId: string = '';
	private inventory: UserInventory = { packs: {}, cards: [] };
	private lastUpdated: number = 0;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.blockConcurrencyWhile(async () => {
			const state = await this.ctx.storage.get<UserState>('state');
			if (state) {
				this.userId = state.userId;
				this.inventory = state.inventory || { packs: {}, cards: [] };
				this.lastUpdated = state.lastUpdated;
			}
		});
	}

	async initialize(userId: string): Promise<void> {
		this.userId = userId;
		this.lastUpdated = Date.now();
		await this.saveState();
	}

	async editInventory(changes: {
		remove?: {
			cards?: string[];
			packs?: Array<[string, number]>;
		};
		add?: {
			cards?: CardInventoryItem[];
			packs?: Array<[string, number]>;
		};
	}): Promise<UserInventory> {
		if (changes.remove) {
			if (changes.remove.cards) {
				for (const cardId of changes.remove.cards) {
					const index = this.inventory.cards.findIndex((c) => c.Id === cardId);
					if (index !== -1) {
						this.inventory.cards.splice(index, 1);
					}
				}
			}
			if (changes.remove.packs) {
				for (const [packId, quantity] of changes.remove.packs) {
					if (this.inventory.packs[packId]) {
						this.inventory.packs[packId] -= quantity;
						if (this.inventory.packs[packId] <= 0) {
							delete this.inventory.packs[packId];
						}
					}
				}
			}
		}

		if (changes.add) {
			if (changes.add.cards) {
				for (const card of changes.add.cards) {
					this.inventory.cards.push(card);
				}
			}
			if (changes.add.packs) {
				for (const [packId, quantity] of changes.add.packs) {
					this.inventory.packs[packId] = (this.inventory.packs[packId] || 0) + quantity;
				}
			}
		}

		this.lastUpdated = Date.now();
		await this.saveState();
		return this.getInventory();
	}

	async getInventory(): Promise<UserInventory> {
		return {
			packs: { ...this.inventory.packs },
			cards: [...this.inventory.cards],
		};
	}

	async getState(): Promise<UserState> {
		return {
			userId: this.userId,
			inventory: await this.getInventory(),
			lastUpdated: this.lastUpdated,
		};
	}

	private async saveState(): Promise<void> {
		const state: UserState = {
			userId: this.userId,
			inventory: this.inventory,
			lastUpdated: this.lastUpdated,
		};
		await this.ctx.storage.put('state', state);
	}
}
