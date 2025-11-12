import { PackShard } from './durable-objects/PackShard';
import { User } from './durable-objects/User';
import { authenticateRequest } from './utils/auth';
import { RateLimiter } from './utils/ratelimit';
import { jsonResponse } from './utils/response';
import { handleClaimPack, handleRestockPack, handlePackStatus } from './handlers/pack';
import { handleGetInventory, handleEditInventory } from './handlers/user';
import { handleBatch } from './handlers/batch';
import { handleCreateToken } from './handlers/admin';
import type { RestockPackRequest, EditInventoryRequest } from './types';

export { PackShard, User };

const rateLimiter = new RateLimiter();

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
				},
			});
		}

		if (path === '/admin/create-token' && request.method === 'POST') {
			return await handleCreateToken(request, env);
		}

		if (path === '/heartbeat' && request.method === 'GET') {
			return jsonResponse({ alive: true, timestamp: Date.now() });
		}

		if (path === '/batch' && request.method === 'POST') {
			return await handleBatch(request, env);
		}

		const auth = await authenticateRequest(request, env);
		if (!auth.valid) {
			return jsonResponse({ error: 'Unauthorized', reason: auth.reason }, 401);
		}

		const userId = auth.userId!;
		const rateLimit = rateLimiter.check(userId);
		if (!rateLimit.allowed) {
			return jsonResponse({ error: 'Rate limit exceeded', resetAt: rateLimit.resetAt }, 429);
		}

		try {
			if (path === '/pack/claim' && request.method === 'POST') {
				const body = await request.json<{ packId: string }>();
				return await handleClaimPack(body, env, userId);
			}

			if (path === '/pack/restock' && request.method === 'POST') {
				const body = await request.json<RestockPackRequest>();
				return await handleRestockPack(body, env);
			}

			if (path === '/user/inventory' && request.method === 'GET') {
				return await handleGetInventory(env, userId);
			}

			if (path === '/user/inventory/edit' && request.method === 'POST') {
				const body = await request.json<EditInventoryRequest>();
				return await handleEditInventory(body, env, userId);
			}

			if (path === '/pack/status' && request.method === 'GET') {
				const url = new URL(request.url);
				const packId = url.searchParams.get('packId');
				if (!packId) {
					return jsonResponse({ error: 'Missing packId' }, 400);
				}
				return await handlePackStatus(packId, env);
			}

			return jsonResponse({ error: 'Not found' }, 404);
		} catch (error: any) {
			console.error('Request error:', error);
			return jsonResponse({ error: 'Internal server error', message: error.message, stack: error.stack }, 500);
		}
	},
} satisfies ExportedHandler<Env>;
