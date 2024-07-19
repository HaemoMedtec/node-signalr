import { Client } from './';
import { HubCallback } from './types/HubCallback';
import { HubEvent } from './types/HubEvent';
import { HubHandler } from './types/HubHandler';


export class Hub {
	callbacks: HubCallback = {};
	handlers: HubHandler = {};

	constructor(private client: Client) { }

	_handleCallback(invocationId: number, error: unknown, result: unknown): void {
		const cb = this.callbacks[invocationId];
		if (cb) cb(error, result);
	}

	on(hubName: string, methodName: string, cb: HubEvent): void;

	on(methodName: string, cb: HubEvent): void;

	/**
	 * Bind events to receive messages.
	 */
	on(arg1: string, arg2: string | HubEvent, arg3?: HubEvent): void {
		let hubName: string;
		let methodName: string;
		let cb: HubEvent;

		if (arg3 === undefined) {
			// If the third argument is undefined, it means hubName is not provided
			hubName = this.client.subscribedHubs[0].name;
			methodName = arg1;
			cb = arg2 as HubEvent;
		} else {
			// Both hubName and methodName are provided
			hubName = arg1;
			methodName = arg2 as string;
			cb = arg3;
		}

		const _hubName = hubName.toLowerCase();
		let handler = this.handlers[_hubName];
		if (!handler) {
			handler = this.handlers[_hubName] = {};
		}
		handler[methodName.toLowerCase()] = cb;
	}

	call(methodName: string, ...args): Promise<unknown>;

	call(hubName: string, methodName: string, ...args): Promise<unknown>;

	/**
	 * Call the hub method and get return values asynchronously
	 */
	call(arg1: string, arg2?: string, ...args: unknown[]): Promise<unknown> {
		let hubName: string;
		let methodName: string;

		if (arg2 === undefined) {
			// If the second argument is undefined, it means hubName is not provided
			hubName = this.client.subscribedHubs[0].name;
			methodName = arg1;
		} else {
			// Both hubName and methodName are provided
			hubName = arg1;
			methodName = arg2;
		}

		return new Promise((resolve, reject) => {
			const messages = args.map((arg) => typeof arg === 'function' || typeof arg === 'undefined' ? null : arg);

			const invocationId = this.client._invocationId;
			const timeoutTimer = setTimeout(
				() => {
					delete this.callbacks[invocationId];
					reject('Timeout');
				},
				this.client._callTimeout || this.client.callTimeout || 5000
			);
			this.callbacks[invocationId] = (err, result): void => {
				clearTimeout(timeoutTimer);
				delete this.callbacks[invocationId];
				return err ? reject(err) : resolve(result);
			};
			this.client._sendMessage(hubName, methodName, messages);
		});
	}

	invoke(methodName: string, ...args: unknown[]): void;

	invoke(hubName: string, methodName: string, ...args: unknown[]): void;

	/**
	 * Invoke the hub method without return values
	 */
	invoke(arg1: string, arg2?: string, ...args: unknown[]): void {
		let hubName: string;
		let methodName: string;

		if (arg2 === undefined) {
			// If the second argument is undefined, it means hubName is not provided
			hubName = this.client.subscribedHubs[0].name;
			methodName = arg1;
			args = [arg2, ...args];
		} else {
			// Both hubName and methodName are provided
			hubName = arg1;
			methodName = arg2;
		}

		const messages = args.map((arg) => typeof arg === 'function' || typeof arg === 'undefined' ? null : arg);

		this.client._sendMessage(hubName, methodName, messages);
	}

	// invoke(arg1: string, arg2?: string, ...args: unknown[]): void {
	// 	let hubName: string;
	// 	let methodName: string;
	
	// 	if (arg2 === undefined) {
	// 		// If the second argument is undefined, it means hubName is not provided
	// 		hubName = this.client.subscribedHubs[0].name;
	// 		methodName = arg1;
	// 	} else {
	// 		// Both hubName and methodName are provided
	// 		hubName = arg1;
	// 		methodName = arg2;
	// 	}
	
	// 	const messages = args.map((arg) => typeof arg === 'function' || typeof arg === 'undefined' ? null : arg);
	
	// 	this.client._sendMessage(hubName, methodName, messages);
	// }
}
