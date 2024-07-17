import url from 'node:url';
import http from 'node:http';
import https from 'node:https';
import querystring from 'node:querystring';
import { TypedEmitter } from 'tiny-typed-emitter';
import WebSocket from 'ws';

import { ClientEvents } from './ClientEvents';
import { Connection } from './Connection';
import { Hub } from './Hub';
import { NegotiateProtocol } from './NegotiateProtocol';
import { RequestOptions } from './RequestOptions';
import { SignalRMessage } from './SignalRMessage';
import { SignalRError } from './SignalRError';

/**
 * A signalR client for Node.js which support ASP.NET but not ASP.NET Core.
 * For ASP.NET Core signalR support use the offical client from Microsoft.
 */
export class Client extends TypedEmitter<ClientEvents> {
	readonly subscribedHubs: { name: string }[] = [];

	qs: Record<string, string> = {};
	headers: Record<string, string> = {};
	agent?: http.Agent | https.Agent;

	requestTimeout = 5000;
	reconnectDelayTime = 5000;
	callTimeout = 5000;

	connection: Connection = {
		state: 'Disconnected',
		hub: new Hub(this),
		lastMessageAt: new Date().getTime()
	};

	_invocationId = 0;
	_callTimeout = 0;

	private bound = false;
	private request!: typeof http | typeof https;
	private websocket?: WebSocket;

	private keepAlive = true;
	private keepAliveTimeout = 5000;

	private beatInterval = 5000;
	private beatTimer: NodeJS.Timeout | null = null;

	private reconnectCount = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;

	constructor(
		public readonly url: string,
		hubs: string[]
	) {
		super();

		if (hubs && hubs.length > 0) {
			this.subscribedHubs = hubs.map((hubName) => ({
				name: hubName.toLocaleLowerCase()
			}));
		}
	}

	private _receiveMessage(body: WebSocket.MessageEvent): void {
		this._markLastMessage();
		if (
			body.type === 'message' &&
			typeof body.data === 'string' &&
			body.data != '{}'
		) {
			const data: SignalRMessage = JSON.parse(body.data);
			if (data.M) {
				data.M.forEach((message) => {
					const hubName = message.H.toLowerCase();
					const handler = this.connection.hub.handlers[hubName];
					if (handler) {
						const methodName = message.M.toLowerCase();
						const method = handler[methodName];
						if (method) {
							method.apply(this, [message.A]);
						}
					}
				});
			} else if (data.I) {
				this.connection.hub._handleCallback(+data.I, data.E, data.R);
			}
		}
	}

	_sendMessage(hub: string, method: string, args: unknown[]): void {
		const payload = JSON.stringify({
			H: hub,
			M: method,
			A: args,
			I: this._invocationId
		});
		++this._invocationId;
		if (this.websocket && this.websocket.readyState === this.websocket.OPEN) {
			this.websocket.send(payload, (err) => {
				if (err) console.log(err);
			});
		}
	}

	private _createRequestQuery(
		qs: { [key: string]: string | number } = {}
	): string {
		const query = querystring.stringify({
			...this.qs,
			clientProtocol: 1.5,
			transport: 'webSockets',
			connectionToken: this.connection.token,
			connectionData: JSON.stringify(this.subscribedHubs),
			...qs
		});

		return query;
	}

	private _makeRequestOptions(path: string): RequestOptions {
		const parsedUrl = url.parse(`${this.url}${path}`, true);
		const options: RequestOptions = {
			...parsedUrl,
			headers: this.headers || {},
			timeout: this.requestTimeout || 5000
		};
		if (this.agent) {
			options.agent = this.agent;
		}
		return options;
	}

	private _negotiate(): Promise<NegotiateProtocol> {
		return new Promise((resolve, reject) => {
			const query = querystring.stringify({
				...this.qs,
				connectionData: JSON.stringify(this.subscribedHubs),
				clientProtocol: 1.5
			});

			const negotiateRequestOptions = this._makeRequestOptions(
				`/negotiate?${query}`
			);

			const req = this.request.get(negotiateRequestOptions, (res) => {
				if (req.destroyed) return;

				let data = '';
				res.on('data', (chunk) => {
					data += chunk;
				});
				res.on('end', () => {
					try {
						if (res.statusCode == 200) {
							const protocol: NegotiateProtocol = JSON.parse(data);
							if (!protocol.TryWebSockets) {
								reject(
									new SignalRError(
										'UNSUPPORTED_WEBSOCKET',
										'Websocket is not supported'
									)
								);
							}
							const resCookies = res.headers['set-cookie'];
							if (resCookies) {
								if (!this.headers) this.headers = {};
								const headerCookieKey = Object.keys(this.headers).find(
									(key) => key.toLowerCase() === 'cookie'
								);
								if (headerCookieKey)
									this.headers[headerCookieKey] += '; ' + resCookies.join('; ');
								else this.headers['Cookie'] = resCookies.join('; ');
							}
							resolve(protocol);
						} else if (res.statusCode == 401 || res.statusCode == 302) {
							reject(
								new SignalRError(
									'UNAUTHORIZED',
									`Server responded with status code ${res.statusCode}, stopping the connection.`
								)
							);
						} else {
							reject(
								new SignalRError(
									'ERR_NEGOTIATE',
									`Server responded with status code ${res.statusCode}.`
								)
							);
						}
					} catch {
						reject(
							new SignalRError(
								'ERR_NEGOTIATE',
								'Error parsing negotiate response.'
							)
						);
					}
				});
				res.on('error', (e) => {
					if (req.destroyed) return;
					reject(SignalRError.from('ERR_NEGOTIATE', e));
				});
			});

			req.on('error', (e) => {
				if (req.aborted) return;
				reject(SignalRError.from('ERR_NEGOTIATE', e));
			});

			req.on('timeout', (e) => {
				req.destroy(e);
				reject(
					new SignalRError(
						'ERR_NEGOTIATE',
						`Timeout of ${this.requestTimeout}ms exceeded.`
					)
				);
			});
		});
	}

	private _connect(): void {
		const url = this.url.replace(/^http/, 'ws');
		const query = this._createRequestQuery({ tid: 10 });

		const socketOptions: WebSocket.ClientOptions = {
			handshakeTimeout: this.requestTimeout || 5000,
			headers: this.headers || {}
		};
		if (this.agent) {
			socketOptions.agent = this.agent;
		}

		const ws = new WebSocket(`${url}/connect?${query}`, socketOptions);

		ws.onopen = (): void => {
			this._invocationId = 0;
			this._callTimeout = 0;
			this._start()
				.then(() => {
					this.reconnectCount = 0;
					this.emit('connected');
					this.connection.state = 'Connected';
					this._markLastMessage();
					if (this.keepAlive) this._beat();
				})
				.catch((error) => {
					this.connection.state = 'Disconnected';
					this._error(error);
				});
		};

		ws.onerror = (event): void => {
			this._error(new SignalRError('ERR_SOCKET', event.message));
		};

		ws.onmessage = (message): void => {
			this._receiveMessage(message);
		};

		ws.onclose = (): void => {
			this._callTimeout = 1000;
			this.connection.state = 'Disconnected';
			this.emit('disconnected', 'failed');
			this._reconnect();
		};

		ws.on('unexpected-response', (_, response) => {
			this.connection.state = 'Disconnected';
			if (response && response.statusCode === 401) {
				this._error(
					new SignalRError(
						'UNAUTHORIZED',
						`Server responded with status code ${response.statusCode}, stopping the connection.`
					)
				);
				this._clearBeatTimer();
				this._close();
				this.emit('disconnected', 'unauthorized');
			} else {
				new SignalRError(
					'ERR_CONNECT',
					'Connect failed with unexpected response.'
				);
			}
		});

		this.websocket = ws;
	}

	private _reconnect(restart = false): void {
		if (this.reconnectTimer || this.connection.state === 'Reconnecting') {
			return;
		}
		this._clearBeatTimer();
		this._close();
		this.reconnectTimer = setTimeout(() => {
			++this.reconnectCount;
			this.connection.state = 'Reconnecting';
			this.emit('reconnecting', this.reconnectCount);
			restart ? this.start() : this._connect();
			this.reconnectTimer = null;
		}, this.reconnectDelayTime || 5000);
	}

	private _clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	private _beat(): void {
		const timeElapsed = new Date().getTime() - this.connection.lastMessageAt;
		if (timeElapsed > this.keepAliveTimeout) {
			this.connection.state = 'Disconnected';
			this._error(
				new SignalRError(
					'CONNECTION_LOST',
					'Keep alive timed out. Connection has been lost.'
				)
			);
		} else {
			this.beatTimer = setTimeout(() => {
				this._beat();
			}, this.beatInterval);
		}
	}

	private _clearBeatTimer(): void {
		if (this.beatTimer) {
			clearTimeout(this.beatTimer);
			this.beatTimer = null;
		}
	}

	private _markLastMessage(): void {
		this.connection.lastMessageAt = new Date().getTime();
	}

	private _start(): Promise<void> {
		return new Promise((resolve, reject) => {
			const query = this._createRequestQuery();

			const startRequestOptions = this._makeRequestOptions(`/start?${query}`);

			const req = this.request.get(startRequestOptions, (res) => {
				if (req.destroyed) return;

				res.on('data', () => { });
				res.on('end', () => {
					if (res.statusCode == 200) {
						resolve();
					} else if (res.statusCode == 401 || res.statusCode == 302) {
						reject(
							new SignalRError(
								'UNAUTHORIZED',
								`Server responded with status code ${res.statusCode}, stopping the connection.`
							)
						);
					} else {
						reject(
							new SignalRError(
								'ERR_START',
								`Server responded with status code ${res.statusCode}.`
							)
						);
					}
				});
				res.on('error', (e) => {
					if (req.destroyed) return;
					reject(SignalRError.from('ERR_START', e));
				});
			});

			req.on('error', (e) => {
				if (req.aborted) return;
				reject(SignalRError.from('ERR_START', e));
			});

			req.on('timeout', (e) => {
				req.destroy(e);
				reject(
					new SignalRError(
						'ERR_START',
						`Timeout of ${this.requestTimeout}ms exceeded.`
					)
				);
			});
		});
	}

	private _abort(): Promise<void> {
		return new Promise((resolve, reject) => {
			const query = this._createRequestQuery();

			const abortRequestOptions = this._makeRequestOptions(`/abort?${query}`);
			abortRequestOptions.method = 'POST';

			const req = this.request.request(abortRequestOptions, (res) => {
				res.on('data', () => { });
				res.on('end', () => resolve());
				res.on('error', (e) => reject(SignalRError.from('ERR_ABORT', e)));
			});
			req.on('error', (e) => reject(SignalRError.from('ERR_ABORT', e)));
			req.write('');
			req.end();
		});
	}

	private _error(error: SignalRError): void {
		this.emit('error', error);
		const code = error.code;
		if (code === 'ERR_NEGOTIATE' || code === 'ERR_CONNECT') {
			this._reconnect(true);
		}
		if (code === 'ERR_START' || code === 'CONNECTION_LOST') {
			this._reconnect();
		}
	}

	private _close(): void {
		if (this.websocket) {
			this.websocket.onclose = null;
			this.websocket.onmessage = null;
			this.websocket.onerror = null;
			this.websocket.close();
			this.websocket = undefined;
		}
	}

	start(): void {
		if (!this.bound) {
			if (!this.url) {
				this._error(new SignalRError('INVALID_URL', 'Invalid URL.'));
				return;
			}
			if (this.url.startsWith('http:') || this.url.startsWith('https:')) {
				const _url = url.parse(this.url);
				this.request = _url.protocol === 'https:' ? https : http;
			} else {
				this._error(new SignalRError('INVALID_PROTOCOL', 'Invalid protocol.'));
				return;
			}
			if (this.subscribedHubs.length === 0) {
				this._error(
					new SignalRError('NO_HUB', 'No hubs have been subscribed to.')
				);
				return;
			}
			this.bound = true;
		}
		this._negotiate()
			.then((res) => {
				this.connection = {
					...this.connection,
					id: res.ConnectionId,
					token: res.ConnectionToken
				};
				if (res.KeepAliveTimeout) {
					this.keepAlive = true;
					this.keepAliveTimeout = res.KeepAliveTimeout * 1000;
					this.beatInterval = this.keepAliveTimeout / 4;
				} else {
					this.keepAlive = false;
				}
				this._connect();
			})
			.catch((error) => {
				this.connection.state = 'Disconnected';
				this._error(error);
			});
	}

	end(): void {
		if (this.websocket) {
			this.emit('disconnected', 'end');
			this._abort().catch(() => { });
		}
		this._clearReconnectTimer();
		this._clearBeatTimer();
		this._close();
	}
}


