export interface AuthResult {
	valid: boolean;
	userId?: string;
	reason?: string;
}

export async function authenticateRequest(request: Request, env: Env): Promise<AuthResult> {
	const authHeader = request.headers.get('Authorization');

	if (!authHeader) {
		return { valid: false, reason: 'missing_auth_header' };
	}

	if (!authHeader.startsWith('Bearer ')) {
		return { valid: false, reason: 'invalid_auth_format' };
	}

	const token = authHeader.substring(7);

	if (!token || token.length < 32) {
		return { valid: false, reason: 'invalid_token' };
	}

	const userId = await validateToken(token, env);

	if (!userId) {
		return { valid: false, reason: 'invalid_token' };
	}

	return { valid: true, userId };
}

async function validateToken(token: string, env: Env): Promise<string | null> {
	try {
		const stmt = env.DB.prepare('SELECT user_id FROM auth_tokens WHERE token = ? AND expires_at > ?');
		const result = await stmt.bind(token, Date.now()).first<{ user_id: string }>();
		return result?.user_id || null;
	} catch (err) {
		console.error('Token validation error:', err);
		return null;
	}
}

export function extractUserId(request: Request): string | null {
	const url = new URL(request.url);
	return url.searchParams.get('userId');
}
