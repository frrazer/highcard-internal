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

	await logTransaction(env, {
		userId,
		packId,
		shardId: successfulShardId!,
		timestamp: Date.now(),
	});

	return jsonResponse({
		success: true,
		packId,
	});
}

export async function handleRestockPack(body: RestockPackRequest, env: Env): Promise<Response> {
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
		await env.DB.prepare('UPDATE packs SET total_stock = ? WHERE pack_id = ?').bind(newTotalStock, packId).run();
	} else {
		await env.DB.prepare('INSERT INTO packs (pack_id, total_stock) VALUES (?, ?)').bind(packId, newTotalStock).run();
	}

	return jsonResponse({ success: true, packId, stock, totalStock: newTotalStock, shards: distribution.filter((t) => t > 0).length });
}

export async function handlePackStatus(packId: string, env: Env): Promise<Response> {
	if (!packId) {
		return jsonResponse({ error: 'Missing packId' }, 400);
	}

	let totalAvailable = 0;
	let totalStock = 0;

	for (let shardIndex = 0; shardIndex < 128; shardIndex++) {
		const shardId = getShardId(packId, shardIndex);
		const shardStub = env.PACK_SHARD.idFromName(shardId);
		const shardDO = env.PACK_SHARD.get(shardStub);

		try {
			const status = await shardDO.getStatus();
			totalAvailable += status.tokensAvailable;
			totalStock += status.totalTokens;
		} catch (err) {
			continue;
		}
	}

	return jsonResponse({ packId, totalStock, totalAvailable, soldOut: totalAvailable === 0 });
}
