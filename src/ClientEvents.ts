import { SignalRError } from "src";


export type ClientEvents = {
	connected: () => void;
	reconnecting: (retryCount: number) => void;
	disconnected: (reason: 'failed' | 'unauthorized' | 'end') => void;
	error: (error: SignalRError) => void;
};
