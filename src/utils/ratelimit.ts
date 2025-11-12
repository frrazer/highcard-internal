const RATE_LIMIT_WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 100;

export interface RateLimitResult {
	allowed: boolean;
	remaining?: number;
	resetAt?: number;
	reason?: string;
}

export class RateLimiter {
	private requests: Map<string, { count: number; windowStart: number }> = new Map();

	check(userId: string): RateLimitResult {
		const now = Date.now();
		const key = userId;
		const existing = this.requests.get(key);

		if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
			this.requests.set(key, { count: 1, windowStart: now });
			return {
				allowed: true,
				remaining: MAX_REQUESTS_PER_WINDOW - 1,
				resetAt: now + RATE_LIMIT_WINDOW_MS,
			};
		}

		if (existing.count >= MAX_REQUESTS_PER_WINDOW) {
			return {
				allowed: false,
				remaining: 0,
				resetAt: existing.windowStart + RATE_LIMIT_WINDOW_MS,
				reason: 'rate_limit_exceeded',
			};
		}

		existing.count++;
		return {
			allowed: true,
			remaining: MAX_REQUESTS_PER_WINDOW - existing.count,
			resetAt: existing.windowStart + RATE_LIMIT_WINDOW_MS,
		};
	}

	cleanup() {
		const now = Date.now();
		for (const [key, data] of this.requests.entries()) {
			if (now - data.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
				this.requests.delete(key);
			}
		}
	}
}
