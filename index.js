const fetch = require('node-fetch');
const getPixels = require('get-pixels');
const ndarray = require('ndarray');
const WebSocket = require('ws');
const readline = require('readline-promise');
const {stdin: input, stdout: output} = require('process');

const rl = readline.default.createInterface({ input, output });

const TEMPLATE_URL = "https://lukemiles49.github.io/site-test/assets/template.png";

const COLOR_MAPPINGS = {
	'#6D001A': 0,
	'#BE0039': 1,
	'#FF4500': 2,
	'#FFA800': 3,
	'#FFD635': 4,
	'#FFF8B8': 5,
	'#00A368': 6,
	'#00CC78': 7,
	'#7EED56': 8,
	'#00756F': 9,
	'#009EAA': 10,
	'#00CCC0': 11,
	'#2450A4': 12,
	'#3690EA': 13,
	'#51E9F4': 14,
	'#493AC1': 15,
	'#6A5CFF': 16,
	'#94B3FF': 17,
	'#811E9F': 18,
	'#B44AC0': 19,
	'#E4ABFF': 20,
	'#DE107F': 21,
	'#FF3881': 22,
	'#FF99AA': 23,
	'#6D482F': 24,
	'#9C6926': 25,
	'#FFB470': 26,
	'#000000': 27,
	'#515252': 28,
	'#898D90': 29,
	'#D4D7D9': 30,
	'#FFFFFF': 31,
};

const PRIORITY = 4;

function componentToHex(c) {
	const hex = c.toString(16).toUpperCase();
	return hex.length == 1 ? "0" + hex : hex;
}

function rgbToHex(r, g, b) {
	return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

function loadImage(url) {
	console.log("Loading " + url);
	return new Promise((res, rej) => {
		getPixels(url, (err, pixels) => {
			if (err) rej(new Error(err));
			else res(pixels);
		});
	});
}

function getRemainingWork(template, canvas) {
	const layers = [];
	const [width, height] = template.shape;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const rt = template.get(x, y, 0);
			const gt = template.get(x, y, 1);
			const bt = template.get(x, y, 2);
			const at = template.get(x, y, 3);
			const ht = rgbToHex(rt, gt, bt);
			const layer = 255 - at;
			if (at > 0) {
				while (layers.length <= layer) layers.push([]);
				const rc = canvas.get(x, y, 0);
				const gc = canvas.get(x, y, 1);
				const bc = canvas.get(x, y, 2);
				const hc = rgbToHex(rc, gc, bc);
				if (hc !== ht) {
					const color = COLOR_MAPPINGS[ht];
					layers[layer].push({x, y, color, layer});
				}
			}
		}
	}
	return layers;
}

async function loadTemplate() {
	return loadImage(TEMPLATE_URL);
}

function getCanvasImageUrl(id, token) {
	return new Promise((res, rej) => {
		const ws = new WebSocket('wss://gql-realtime-2.reddit.com/query', 'graphql-ws', {
			headers : {
				"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:98.0) Gecko/20100101 Firefox/98.0",
				"Origin": "https://hot-potato.reddit.com",
			}
		});
		
		ws.onopen = () => {
			ws.send(JSON.stringify({
				'type': 'connection_init',
				'payload': {
					'Authorization': `Bearer ${token}`,
				},
			}));
			
			ws.send(JSON.stringify({
				'id': '1',
				'type': 'start',
				'payload': {
					'variables': {
						'input': {
							'channel': {
								'teamOwner': 'AFD2022',
								'category': 'CANVAS',
								'tag': id,
							}
						}
					},
					'extensions': {},
					'operationName': 'replace',
					'query': 'subscription replace($input: SubscribeInput!) {\n  subscribe(input: $input) {\n    id\n    ... on BasicMessage {\n      data {\n        __typename\n        ... on FullFrameMessageData {\n          __typename\n          name\n          timestamp\n        }\n      }\n      __typename\n    }\n    __typename\n  }\n}',
				},
			}));
		};
		
		const timeout = setTimeout(() => {
			ws.close();
			rej(new Error("Timed out loading canvas"));
		}, 5000);
		
		ws.onmessage = message => {
			const {data} = message;
			const parsed = JSON.parse(data);
			if (parsed.type === 'connection_error') {
				ws.close();
				clearTimeout(timeout);
				rej(new Error("Failed to load canvas: " + JSON.stringify(parsed)));
			} else {
				const name = parsed?.payload?.data?.subscribe?.data?.name;
				if (name) {
					ws.close();
					clearTimeout(timeout);
					res(`${name}?noCache=${Date.now() * Math.random()}`);
				}
			}
		};
		
		ws.onerror = err => {
			ws.close();
			clearTimeout(timeout);
			rej(err);
		};
	});
}

async function loadCanvas(token) {
	const canvas = ndarray(new Uint8ClampedArray(2000 * 2000 * 4), [2000, 2000, 4]);
	for (const {name, offsetX, offsetY} of [
		{name: '0', offsetX: 0, offsetY: 0},
		{name: '1', offsetX: 1000, offsetY: 0},
		{name: '2', offsetX: 0, offsetY: 1000},
		{name: '3', offsetX: 1000, offsetY: 1000},
	]) {
		const url = await getCanvasImageUrl(name, token);
		const img = await loadImage(url);
		const [width, height] = img.shape;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				for (let c = 0; c < 4; c++) {
					const cc = img.get(x, y, c);
					canvas.set(x + offsetX, y + offsetY, c, cc);
				}
			}
		}
	}
	return canvas;
}

function pickPlacement(work) {
	let weightedLength = 0;
	let workFactor = PRIORITY ** work.length;
	for (const layer of work) {
		workFactor /= PRIORITY;
		weightedLength += layer.length * workFactor;
	}
	let i = Math.floor(Math.random() * weightedLength);
	workFactor = PRIORITY ** work.length;
	for (const layer of work) {
		workFactor /= PRIORITY;
		if (i < layer.length * workFactor) {
			i = Math.floor(i / workFactor);
			return layer[i];
		}
		i -= layer.length * workFactor;
	}
}

async function place(placement, token) {
	const {x, y, color} = placement;
	
	return fetch('https://gql-realtime-2.reddit.com/query', {
		method: 'POST',
		body: JSON.stringify({
			'operationName': 'setPixel',
			'variables': {
				'input': {
					'actionName': 'r/replace:set_pixel',
					'PixelMessageData': {
						'coordinate': {
							'x': x % 1000,
							'y': y % 1000,
						},
						'colorIndex': color,
						'canvasIndex': Math.floor(x / 1000) + Math.floor(y / 1000) * 2,
					},
				},
			},
			'query': 'mutation setPixel($input: ActInput!) {\n  act(input: $input) {\n    data {\n      ... on BasicMessage {\n        id\n        data {\n          ... on GetUserCooldownResponseMessageData {\n            nextAvailablePixelTimestamp\n            __typename\n          }\n          ... on SetPixelResponseMessageData {\n            timestamp\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n',
		}),
		headers: {
			'origin': 'https://hot-potato.reddit.com',
			'referer': 'https://hot-potato.reddit.com/',
			'apollographql-client-name': 'mona-lisa',
			'Authorization': `Bearer ${token}`,
			'Content-Type': 'application/json',
			'User-Agent': "Mozilla/5.0 (X11; Linux x86_64; rv:98.0) Gecko/20100101 Firefox/98.0",
		},
	});
}

function sleep(ms) {
	return new Promise(res => setTimeout(res, ms));
}

async function run() {
	console.log("r/place bot version 1.0");
	console.log("Using template: " + TEMPLATE_URL);
	
	console.log();
	console.log("This tool uses your reddit session token to control your r/place placements");
	console.log("Supposedly this is easiest on Firefox, so I would recommend using that if possible");
	console.log("To find this token:");
	console.log("- Go to https://www.reddit.com/r/place/");
	console.log("- Press f12 to open the console");
	console.log("- Click on 'Network'");
	console.log("- Refresh the page");
	console.log("- Scroll to the top of the Network panel");
	console.log("- Click on the first request to '/r/place/...'");
	console.log("- Click on 'Cookies'");
	console.log("- Find the 'reddit_session' cookie");
	console.log("- Copy the value (without the quotes)");
	console.log();
	
	const redditSessionCookie = await rl.questionAsync("Input reddit session cookie: ");
	let token;
	
	async function refreshToken() {
		const response = await fetch("https://www.reddit.com/r/place/", {
			headers: {
				cookie: `reddit_session=${redditSessionCookie}`,
			},
		});
		const responseText = await response.text();
		token = responseText.split('\"accessToken\":\"')[1].split('"')[0];
	}
	
	await refreshToken();
	setInterval(refreshToken, 30 * 60 * 1000);
	
	while (true) {
		try {
			console.log("Loading template...");
			const template = await loadTemplate();
			console.log("Loading canvas...");
			const canvas = await loadCanvas(token);
			const work = getRemainingWork(template, canvas);
			if (work.some(l => l.length) > 0) {
				const placement = pickPlacement(work);
				console.log(`Attempting to place (${placement.x}, ${placement.y}), part of stage ${placement.layer}`);
				await place(placement, token);
				console.log(`Placed (${placement.x}, ${placement.y})!`);
				console.log("Waiting 5 minutes until the next placement...");
				await sleep(305000 + Math.random() * 5000);
			} else {
				console.log("Work done!");
				console.log("Waiting 30 seconds until retrying...");
				await sleep(30000 + Math.random() * 5000);
			}
		} catch (err) {
			console.log("Error: " + err.stack);
			console.log("Waiting 30 seconds before retrying...");
			await sleep(30000 + Math.random() * 5000);
		}
	}
}

run();
