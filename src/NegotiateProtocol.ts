export type NegotiateProtocol = {
	TryWebSockets: boolean;
	ConnectionId: string;
	ConnectionToken: string;
	KeepAliveTimeout: number;
};
