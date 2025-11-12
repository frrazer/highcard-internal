import { jsonResponse } from '../utils/response';

export async function handleCreateToken(request: Request, env: Env): Promise<Response> {
	const adminSecret = request.headers.get('X-Admin-Secret');

	if (!adminSecret || adminSecret !== env.ADMIN_SECRET) {
		return jsonResponse({ error: 'Forbidden', reason: 'invalid_admin_secret' }, 403);
	}

	const body = await request.json<{ userId: string; expiresInDays?: number }>();
	const { userId, expiresInDays = 365 } = body;

	if (!userId) {
		return jsonResponse({ error: 'Missing userId' }, 400);
	}

	const token = generateToken();
	const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;
	const createdAt = Date.now();

	await env.DB.prepare('DELETE FROM auth_tokens WHERE user_id = ?').bind(userId).run();

	await env.DB.prepare('INSERT INTO auth_tokens (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
		.bind(token, userId, expiresAt, createdAt)
		.run();

	return jsonResponse({
		success: true,
		userId,
		token,
		expiresAt,
		expiresInDays,
	});
}

export function generateToken(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
