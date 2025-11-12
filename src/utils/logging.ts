export async function logTransaction(
	env: Env,
	data: { userId: string; packId: string; shardId: string; timestamp: number }
): Promise<void> {
	try {
		await env.DB.prepare('INSERT INTO transactions (user_id, pack_id, shard_id, timestamp) VALUES (?, ?, ?, ?)')
			.bind(data.userId, data.packId, data.shardId, data.timestamp)
			.run();
	} catch (err) {
		console.error('Failed to log transaction:', err);
	}
}
