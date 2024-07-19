import { Client } from './';
import { HubCallback } from './types/HubCallback';
import { HubEvent } from './types/HubEvent';
import { HubHandler } from './types/HubHandler';
import { HubOverload } from './types/HubOverload';

export class Hub {
	callbacks: HubCallback = {};
	handlers: HubHandler = {};

	private _defaultHub: string;
	
	public get default(): HubOverload {
		const hub = this._defaultHub ?? this.client.subscribedHubs[0].name;

		return {
			invoke: (methodName: string, ...args: unknown[]) => this.invoke(hub, methodName, ...args),
			call: (methodName: string, ...args: unknown[]) => this.call(hub, methodName, ...args),
			on: (methodName: string, cb: HubEvent) => this.on(hub, methodName, cb),
		};
	}
	
	public setDefaultHub(name: string) {
		this._defaultHub = this.client.subscribedHubs.find((hub) => hub.name === name)?.name;
	}
	
	constructor(private client: Client) { }

	_handleCallback(invocationId: number, error: unknown, result: unknown): void {
		const cb = this.callbacks[invocationId];
		if (cb) cb(error, result);
	}

	/**
	 * Bind events to receive messages.
	 */
	on(hubName: string, methodName: string, cb: HubEvent): void {
		const _hubName = hubName.toLowerCase();
		let handler = this.handlers[_hubName];
		if (!handler) {
			handler = this.handlers[_hubName] = {};
		}
		handler[methodName.toLowerCase()] = cb;
	}

	/**
	 * Call the hub method and get return values asynchronously
	 */
	call(hubName: string, methodName: string, ...args): Promise<unknown> {
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

	/**
	 * Invoke the hub method without return values
	 */
	invoke(hubName: string, methodName: string, ...args: unknown[]): void {
		const messages = args.map((arg) => typeof arg === 'function' || typeof arg === 'undefined' ? null : arg);

		if (!hubName) {
			// set default hubName
			hubName = this.client.subscribedHubs[0].name;
		}

		this.client._sendMessage(hubName, methodName, messages);
	}
}
