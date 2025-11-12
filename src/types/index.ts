export interface BuyPackRequest {
	packId: string;
	price: number;
}

export interface BuyPackResponse {
	success: boolean;
	packId?: string;
	newBalance?: number;
	error?: string;
	reason?: string;
}

export interface CreatePackRequest {
	packId: string;
	stock: number;
}

export interface CreatePackResponse {
	success: boolean;
	packId: string;
	stock: number;
	shards: number;
}

export interface AddBalanceRequest {
	amount: number;
}

export interface AddBalanceResponse {
	success: boolean;
	newBalance: number;
}

export interface PackStatusResponse {
	packId: string;
	totalStock: number;
	totalAvailable: number;
	soldOut: boolean;
}

export interface BalanceResponse {
	userId: string;
	balance: number;
}

export interface CardInventoryItem {
	Id: string;
	Variant: string;
	Name: string;
}

export interface UserInventory {
	packs: Record<string, number>;
	cards: CardInventoryItem[];
}

export interface InventoryResponse {
	userId: string;
	inventory: UserInventory;
}

export interface EditInventoryRequest {
	remove?: {
		cards?: string[];
		packs?: Array<[string, number]>;
	};
	add?: {
		cards?: CardInventoryItem[];
		packs?: Array<[string, number]>;
	};
}

export interface EditInventoryResponse {
	success: boolean;
	inventory: UserInventory;
}

export interface ErrorResponse {
	error: string;
	reason?: string;
	resetAt?: number;
}

export interface BatchedRequest {
	id: string;
	method: string;
	path: string;
	headers?: Record<string, string>;
	body?: any;
}

export interface BatchRequest {
	clientId: string;
	batchId: string;
	nonce: string;
	timestamp: number;
	requests: BatchedRequest[];
}

export interface BatchedResponse {
	status: number;
	body: any;
	headers?: Record<string, string>;
}

export interface BatchResponse {
	batchId: string;
	responses: Record<string, BatchedResponse>;
}

export interface Transaction {
	id: number;
	userId: string;
	packId: string;
	price: number;
	shardId: string;
	timestamp: number;
}

export interface Pack {
	packId: string;
	totalStock: number;
	createdBy: string;
	createdAt: number;
}

export interface AuthToken {
	token: string;
	userId: string;
	expiresAt: number;
	createdAt: number;
}
