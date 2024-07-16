import { Message } from "./Message";

export type SignalRMessage = {
	/**
	 * Messages
	 */
	M: Message[];
	/**
	 * Invocation id
	 */
	I: number;
	/**
	 * Invocation error
	 */
	E: string;
	/**
	 * Invocation result
	 */
	R: string;
};
