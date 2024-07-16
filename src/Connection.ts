import { Hub } from "src";
import { ConnectionState } from "./ConnectionState";

export interface Connection {
	readonly id?: string;
	readonly token?: string;
	state: ConnectionState;
	hub: Hub;
	lastMessageAt: number;
}
