/**
 * Outbound delivery through Resend (https://resend.com).
 *
 * Cloudflare Email Sending only reaches outside recipients on the Workers
 * Paid plan. Setting the RESEND_API_KEY secret sends every outgoing message
 * through Resend's HTTP API instead, so an install on the Workers Free plan
 * can still send. Incoming mail keeps arriving through Cloudflare Email Routing.
 *
 * Messages use the same shape the EMAIL binding takes, so callers hand one
 * object to whichever transport is configured.
 *
 * This module has no imports on purpose: the tests load it straight from Node.
 */

type OutboundAddress = string | { name: string; email: string };
type OutboundRecipients = OutboundAddress | OutboundAddress[];

export type OutboundAttachment = {
	disposition: "attachment" | "inline";
	contentId?: string;
	filename: string;
	type: string;
	content: string | ArrayBuffer | ArrayBufferView;
};

export type OutboundMessage = {
	from: OutboundAddress;
	to?: OutboundRecipients;
	subject: string;
	replyTo?: OutboundAddress;
	cc?: OutboundRecipients;
	bcc?: OutboundRecipients;
	headers?: Record<string, string>;
	text?: string;
	html?: string;
	attachments?: OutboundAttachment[];
};

export type OutboundResult = { messageId: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The message object the Cloudflare EMAIL binding accepts. */
type BindingMessage = Parameters<SendEmail["send"]>[0];

const RESEND_API_URL = "https://api.resend.com";

export function getResendApiKey(env: { RESEND_API_KEY?: string }): string | null {
	const key = env.RESEND_API_KEY?.trim();
	return key ? key : null;
}

/** True when outgoing mail goes through Resend rather than Cloudflare Email Sending. */
export function isResendConfigured(env: { RESEND_API_KEY?: string }): boolean {
	return getResendApiKey(env) !== null;
}

/**
 * Send one message through Resend when RESEND_API_KEY is set, otherwise
 * through the Cloudflare EMAIL binding.
 */
export async function sendOutboundEmail(
	env: { RESEND_API_KEY?: string; EMAIL: SendEmail },
	message: BindingMessage,
): Promise<OutboundResult> {
	const apiKey = getResendApiKey(env);
	if (apiKey) return sendWithResend(apiKey, message);
	return env.EMAIL.send(message);
}

export async function sendWithResend(
	apiKey: string,
	message: OutboundMessage,
	fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<OutboundResult> {
	const response = await fetchImpl(`${RESEND_API_URL}/emails`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(buildResendPayload(message)),
	});
	const body = (await response.json().catch(() => null)) as { id?: unknown; message?: unknown } | null;
	if (!response.ok || typeof body?.id !== "string") {
		const detail = typeof body?.message === "string" ? body.message : response.statusText || "unexpected response";
		throw new Error(`Resend API ${response.status}: ${detail}`);
	}
	// Resend answers with its own email id rather than the RFC Message-ID; it is
	// stored as the provider id so the sent copy can be traced in Resend's logs.
	return { messageId: body.id };
}

/** Map an EMAIL-binding style message to the body of Resend's POST /emails. */
export function buildResendPayload(message: OutboundMessage): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		from: formatAddress(message.from),
		to: toList(message.to),
		subject: message.subject,
	};
	const cc = toList(message.cc);
	if (cc.length > 0) payload.cc = cc;
	const bcc = toList(message.bcc);
	if (bcc.length > 0) payload.bcc = bcc;
	if (message.replyTo) payload.reply_to = formatAddress(message.replyTo);
	if (message.html !== undefined) payload.html = message.html;
	if (message.text !== undefined) payload.text = message.text;
	if (message.headers && Object.keys(message.headers).length > 0) payload.headers = { ...message.headers };
	if (message.attachments && message.attachments.length > 0) {
		payload.attachments = message.attachments.map((attachment) => ({
			filename: attachment.filename,
			content: encodeBase64(attachment.content),
			content_type: attachment.type,
			...(attachment.disposition === "inline" && attachment.contentId
				? { content_id: attachment.contentId }
				: {}),
		}));
	}
	return payload;
}

function toList(value: OutboundRecipients | undefined): string[] {
	if (!value) return [];
	return (Array.isArray(value) ? value : [value]).map((entry) => formatAddress(entry).trim()).filter(Boolean);
}

function formatAddress(address: OutboundAddress): string {
	if (typeof address === "string") return address;
	const name = address.name.trim();
	if (!name) return address.email;
	const displayName = /[",<>@()[\]:;\\.]/.test(name) ? `"${name.replace(/(["\\])/g, "\\$1")}"` : name;
	return `${displayName} <${address.email}>`;
}

function encodeBase64(content: string | ArrayBuffer | ArrayBufferView): string {
	const bytes =
		typeof content === "string"
			? new TextEncoder().encode(content)
			: content instanceof ArrayBuffer
				? new Uint8Array(content)
				: new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
	let binary = "";
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}
