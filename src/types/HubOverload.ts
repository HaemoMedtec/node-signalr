import { HubEvent } from './HubEvent';

export type HubOverload = {
	/**
	 * Call the hub method and get return values asynchronously
	 */
	call(methodName: string, ...args: unknown[]): Promise<unknown>;
	/**
	 * Invoke the hub method without return values
	 */
	invoke(methodName: string, ...args: unknown[]): void;
	/**
	 * Bind events to receive messages.
	 */
	on(methodName: string, cb: HubEvent): void;
};
