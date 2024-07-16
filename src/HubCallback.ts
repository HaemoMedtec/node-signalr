export type HubCallback = {
	[key: number]: (error: unknown, result: unknown) => void;
};
