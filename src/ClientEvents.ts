import { SignalRError } from './SignalRError';


export type ClientEvents = {
	connected: () => void;
	reconnecting: (retryCount: number) => void;
	disconnected: (reason: 'failed' | 'unauthorized' | 'end') => void;
	error: (error: SignalRError) => void;
};
