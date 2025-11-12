import { jsonResponse } from '../utils/response';
import type { EditInventoryRequest } from '../types';

export async function handleGetInventory(env: Env, userId: string): Promise<Response> {
	const userStub = env.USER.idFromName(userId);
	const userDO = env.USER.get(userStub);
	const inventory = await userDO.getInventory();
	return jsonResponse({ userId, inventory });
}

export async function handleEditInventory(body: EditInventoryRequest, env: Env, userId: string): Promise<Response> {
	if (!body.add && !body.remove) {
		return jsonResponse({ error: 'Must provide either add or remove operations' }, 400);
	}

	const userStub = env.USER.idFromName(userId);
	const userDO = env.USER.get(userStub);
	const inventory = await userDO.editInventory(body);

	return jsonResponse({ success: true, inventory });
}
