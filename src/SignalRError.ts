import { ErrorCode } from './ErrorCode';

/**
 * Create an Error for the signalR client with the specified error code and
 * message.
 */

export class SignalRError extends Error {
	code: ErrorCode;

	constructor(code: ErrorCode, message: string) {
		super(message);
		this.name = 'SignalRError';
		this.code = code;
	}

	static from(code: ErrorCode, error: Error): SignalRError {
		const _error = error as SignalRError;
		_error.code = code;
		return _error;
	}
}
