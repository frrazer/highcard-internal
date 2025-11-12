const SHARD_COUNT = 128;
const MAX_SHARD_ATTEMPTS = 8;

export async function hashToShard(userId: string, packId: string): Promise<number> {
	const data = `${userId}:${packId}`;
	const encoder = new TextEncoder();
	const dataBuffer = encoder.encode(data);
	const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
	const hashArray = new Uint8Array(hashBuffer);
	const hash32 = (hashArray[0] << 24) | (hashArray[1] << 16) | (hashArray[2] << 8) | hashArray[3];
	return Math.abs(hash32) % SHARD_COUNT;
}

export function getShardId(packId: string, shardIndex: number): string {
	return `pack:${packId}:shard:${shardIndex}`;
}

export function distributeTokens(totalStock: number, shardCount: number = SHARD_COUNT): number[] {
	const distribution = new Array(shardCount).fill(0);

	for (let i = 0; i < totalStock; i++) {
		const shardIndex = i % shardCount;
		distribution[shardIndex]++;
	}

	return distribution;
}

export function getNextShardIndex(currentIndex: number, attempt: number, userId: string): number {
	const offset = Math.floor(Math.abs(hashCode(userId + attempt)) / attempt + 1);
	return (currentIndex + offset) % SHARD_COUNT;
}

function hashCode(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}
	return hash;
}

export { SHARD_COUNT, MAX_SHARD_ATTEMPTS };
