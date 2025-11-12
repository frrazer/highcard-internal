import { hashToShard, getShardId, distributeTokens, getNextShardIndex, MAX_SHARD_ATTEMPTS } from '../utils/sharding';
import { logTransaction } from '../utils/logging';
import { jsonResponse } from '../utils/response';
import type { RestockPackRequest } from '../types';

export async function handleClaimPack(body: { packId: string }, env: Env, userId: string): Promise<Response> {
	const { packId } = body;

	if (!packId) {
		return jsonResponse({ error: 'Missing packId' }, 400);
	}

	let primaryShardIndex = await hashToShard(userId, packId);
	let attempts = 0;
	let claimed = false;
	let successfulShardId: string | null = null;
	let currentShardIndex = primaryShardIndex;

	while (attempts < MAX_SHARD_ATTEMPTS && !claimed) {
		const shardId = getShardId(packId, currentShardIndex);
		const shardStub = env.PACK_SHARD.idFromName(shardId);
		const shardDO = env.PACK_SHARD.get(shardStub);

		const result = await shardDO.claim(userId, Date.now());

		if (result.success) {
			claimed = true;
			successfulShardId = shardId;
			break;
		}

		currentShardIndex = getNextShardIndex(currentShardIndex, attempts + 1, userId);
		attempts++;
	}

	if (!claimed) {
		return jsonResponse({ error: 'Pack sold out' }, 409);
	}

	const userStub = env.USER.idFromName(userId);
	const userDO = env.USER.get(userStub);
	await userDO.editInventory({
		add: {
			packs: [[packId, 1]],
		},
	});

	await env.DB.prepare('UPDATE packs SET available_stock = available_stock - 1 WHERE pack_id = ? AND available_stock > 0')
		.bind(packId)
		.run();

	const pack = await env.DB.prepare('SELECT total_stock, available_stock FROM packs WHERE pack_id = ?').bind(packId).first();

	await logTransaction(env, {
		userId,
		packId,
		shardId: successfulShardId!,
		timestamp: Date.now(),
	});

	return jsonResponse({
		success: true,
		packId,
		totalStock: (pack?.total_stock as number) || 0,
		availableStock: (pack?.available_stock as number) || 0,
		soldOut: ((pack?.available_stock as number) || 0) === 0,
	});
}

export async function handleRestockPack(body: RestockPackRequest, env: Env): Promise<Response> {
	try {
		const { packId, stock } = body;

		if (!packId || stock < 1) {
			return jsonResponse({ error: 'Invalid packId or stock' }, 400);
		}

		const existingPack = await env.DB.prepare('SELECT pack_id, total_stock FROM packs WHERE pack_id = ?').bind(packId).first();

		const newTotalStock = existingPack ? (existingPack.total_stock as number) + stock : stock;

		const distribution = distributeTokens(stock);

		for (let shardIndex = 0; shardIndex < distribution.length; shardIndex++) {
			const tokens = distribution[shardIndex];
			if (tokens > 0) {
				const shardId = getShardId(packId, shardIndex);
				const shardStub = env.PACK_SHARD.idFromName(shardId);
				const shardDO = env.PACK_SHARD.get(shardStub);

				try {
					const status = await shardDO.getStatus();
					if (status.packId === packId) {
						await shardDO.restock(tokens);
					} else {
						await shardDO.initialize(packId, shardIndex, tokens);
					}
				} catch {
					await shardDO.initialize(packId, shardIndex, tokens);
				}
			}
		}

		if (existingPack) {
			await env.DB.prepare('UPDATE packs SET total_stock = ?, available_stock = available_stock + ? WHERE pack_id = ?')
				.bind(newTotalStock, stock, packId)
				.run();
		} else {
			await env.DB.prepare('INSERT INTO packs (pack_id, total_stock, available_stock) VALUES (?, ?, ?)')
				.bind(packId, newTotalStock, stock)
				.run();
		}

		return jsonResponse({
			success: true,
			packId,
			stock,
			totalStock: newTotalStock,
			shards: distribution.filter((t) => t > 0).length,
		});
	} catch (error: any) {
		console.error('RestockPack error:', error);
		return jsonResponse({ error: 'Failed to restock pack', message: error.message, stack: error.stack }, 500);
	}
}

export async function handlePackStatus(packId: string, env: Env): Promise<Response> {
	if (!packId) {
		return jsonResponse({ error: 'Missing packId' }, 400);
	}

	const shardPromises = [];
	for (let shardIndex = 0; shardIndex < 128; shardIndex++) {
		const shardId = getShardId(packId, shardIndex);
		const shardStub = env.PACK_SHARD.idFromName(shardId);
		const shardDO = env.PACK_SHARD.get(shardStub);

		shardPromises.push(shardDO.getStatus().catch(() => null));
	}

	const results = await Promise.all(shardPromises);

	let totalAvailable = 0;
	let totalStock = 0;

	for (const status of results) {
		if (status) {
			totalAvailable += status.tokensAvailable;
			totalStock += status.totalTokens;
		}
	}

	return jsonResponse({ packId, totalStock, totalAvailable, soldOut: totalAvailable === 0 });
}

export async function handlePackStatusFast(packId: string, env: Env): Promise<Response> {
	if (!packId) {
		return jsonResponse({ error: 'Missing packId' }, 400);
	}

	const pack = await env.DB.prepare('SELECT total_stock, available_stock FROM packs WHERE pack_id = ?').bind(packId).first();

	if (!pack) {
		return jsonResponse({ packId, totalStock: 0, totalAvailable: 0, soldOut: true });
	}

	return jsonResponse({
		packId,
		totalStock: pack.total_stock as number,
		totalAvailable: pack.available_stock as number,
		soldOut: (pack.available_stock as number) === 0,
	});
}

export async function handleBulkPackStatus(packIds: string[], env: Env, fast: boolean = true): Promise<Response> {
	if (!packIds || !Array.isArray(packIds) || packIds.length === 0) {
		return jsonResponse({ error: 'Missing or invalid packIds array' }, 400);
	}

	if (packIds.length > 100) {
		return jsonResponse({ error: 'Maximum 100 packs per bulk request' }, 400);
	}

	const results: Record<string, { totalStock: number; totalAvailable: number; soldOut: boolean }> = {};

	if (fast) {
		const placeholders = packIds.map(() => '?').join(',');
		const query = await env.DB.prepare(`SELECT pack_id, total_stock, available_stock FROM packs WHERE pack_id IN (${placeholders})`)
			.bind(...packIds)
			.all();

		for (const packId of packIds) {
			const pack = query.results.find((p: any) => p.pack_id === packId);
			if (pack) {
				results[packId] = {
					totalStock: pack.total_stock as number,
					totalAvailable: pack.available_stock as number,
					soldOut: (pack.available_stock as number) === 0,
				};
			} else {
				results[packId] = { totalStock: 0, totalAvailable: 0, soldOut: true };
			}
		}
	} else {
		for (const packId of packIds) {
			const response = await handlePackStatus(packId, env);
			const data = await response.json<any>();
			results[packId] = {
				totalStock: data.totalStock,
				totalAvailable: data.totalAvailable,
				soldOut: data.soldOut,
			};
		}
	}

	return jsonResponse({ packs: results });
}
