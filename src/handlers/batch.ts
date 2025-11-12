import { authenticateRequest } from '../utils/auth';
import { jsonResponse } from '../utils/response';
import { handleClaimPack, handleCreatePack, handlePackStatus } from './pack';
import { handleGetInventory, handleEditInventory } from './user';
import type { BatchRequest, BatchResponse, BatchedRequest, BatchedResponse, CreatePackRequest, EditInventoryRequest } from '../types';

const usedNonces = new Map<string, number>();
const NONCE_TTL = 300000;

export async function handleBatch(request: Request, env: Env): Promise<Response> {
	const body = await request.json<BatchRequest>();
	const { clientId, batchId, nonce, timestamp, requests } = body;

	if (!clientId || !batchId || !nonce || !timestamp || !requests || !Array.isArray(requests)) {
		return jsonResponse({ error: 'Invalid batch request format' }, 400);
	}

	if (requests.length === 0) {
		return jsonResponse({ error: 'Batch cannot be empty' }, 400);
	}

	if (requests.length > 50) {
		return jsonResponse({ error: 'Batch size exceeds maximum of 50 requests' }, 400);
	}

	const now = Date.now();
	if (Math.abs(now - timestamp) > 30000) {
		return jsonResponse({ error: 'Request timestamp too old or too far in future' }, 400);
	}

	if (usedNonces.has(nonce)) {
		return jsonResponse({ error: 'Nonce already used (replay attack prevented)' }, 400);
	}

	usedNonces.set(nonce, now);
	cleanupOldNonces();

	const responses: Record<string, BatchedResponse> = {};

	for (const req of requests) {
		if (!req.id || !req.method || !req.path) {
			responses[req.id || 'unknown'] = {
				status: 400,
				body: { error: 'Invalid request format' },
			};
			continue;
		}

		try {
			const response = await routeRequest(req, env);
			responses[req.id] = response;
		} catch (error: any) {
			responses[req.id] = {
				status: 500,
				body: { error: 'Internal server error', message: error.message },
			};
		}
	}

	const batchResponse: BatchResponse = {
		batchId,
		responses,
	};

	return jsonResponse(batchResponse);
}

async function routeRequest(req: BatchedRequest, env: Env): Promise<BatchedResponse> {
	const { method, path, body, headers } = req;

	const authHeader = headers?.['Authorization'] || headers?.['authorization'];
	if (!authHeader) {
		return {
			status: 401,
			body: { error: 'Unauthorized', reason: 'missing_authorization_header' },
		};
	}

	const token = authHeader.replace('Bearer ', '');
	const auth = await authenticateRequest(
		new Request('http://internal', { headers: { Authorization: `Bearer ${token}` } }),
		env
	);

	if (!auth.valid) {
		return {
			status: 401,
			body: { error: 'Unauthorized', reason: auth.reason },
		};
	}

	const userId = auth.userId!;

	try {
		let response: Response;

		if (path === '/pack/claim' && method === 'POST') {
			if (!body || !body.packId) {
				return { status: 400, body: { error: 'Missing packId' } };
			}
			response = await handleClaimPack(body, env, userId);
		} else if (path === '/pack/create' && method === 'POST') {
			if (!body || !body.packId || !body.stock) {
				return { status: 400, body: { error: 'Invalid packId or stock' } };
			}
			response = await handleCreatePack(body, env, userId);
		} else if (path === '/user/inventory' && method === 'GET') {
			response = await handleGetInventory(env, userId);
		} else if (path === '/user/inventory/edit' && method === 'POST') {
			if (!body || (!body.add && !body.remove)) {
				return { status: 400, body: { error: 'Must provide either add or remove operations' } };
			}
			response = await handleEditInventory(body, env, userId);
		} else if (path === '/pack/status' && method === 'GET') {
			if (!body || !body.packId) {
				return { status: 400, body: { error: 'Missing packId' } };
			}
			response = await handlePackStatus(body.packId, env);
		} else {
			return {
				status: 404,
				body: { error: 'Endpoint not found' },
			};
		}

		const responseBody = await response.json();
		return {
			status: response.status,
			body: responseBody,
		};
	} catch (error: any) {
		return {
			status: 500,
			body: { error: 'Request processing failed', message: error.message },
		};
	}
}

function cleanupOldNonces(): void {
	const now = Date.now();
	for (const [nonce, timestamp] of usedNonces.entries()) {
		if (now - timestamp > NONCE_TTL) {
			usedNonces.delete(nonce);
		}
	}
}
