import { Hub } from '../Hub';
import { ConnectionState } from '../types/ConnectionState';

export interface Connection {
	readonly id?: string;
	readonly token?: string;
	state: ConnectionState;
	hub: Hub;
	lastMessageAt: number;
}
