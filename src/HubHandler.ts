import { HubEvent } from "./HubEvent";

export type HubHandler = {
	[key: string]: { [key: string]: HubEvent; };
};
