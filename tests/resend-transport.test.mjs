import assert from "node:assert/strict";
import test from "node:test";

import {
	buildResendPayload,
	getResendApiKey,
	isResendConfigured,
	sendOutboundEmail,
	sendWithResend,
} from "../src/lib/email/resend.ts";

function jsonResponse(status, body) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

test("Resend is only used when RESEND_API_KEY holds a value", () => {
	assert.equal(isResendConfigured({}), false);
	assert.equal(isResendConfigured({ RESEND_API_KEY: "   " }), false);
	assert.equal(getResendApiKey({ RESEND_API_KEY: " re_123 " }), "re_123");
	assert.equal(isResendConfigured({ RESEND_API_KEY: "re_123" }), true);
});

test("the payload maps recipients, headers and attachments to Resend's fields", () => {
	const payload = buildResendPayload({
		from: '"Sam Reyes" <sam@example.com>',
		to: ["a@example.org", " b@example.org "],
		cc: [],
		bcc: "hidden@example.org",
		subject: "Hello",
		html: "<p>Hi <img src=\"cid:logo\"></p>",
		text: "Hi",
		headers: { "In-Reply-To": "<parent@example.org>" },
		attachments: [
			{ disposition: "attachment", filename: "notes.txt", type: "text/plain", content: new TextEncoder().encode("notes").buffer },
			{ disposition: "inline", contentId: "logo", filename: "logo.png", type: "image/png", content: new Uint8Array([1, 2, 3]) },
		],
	});

	assert.deepEqual(payload, {
		from: '"Sam Reyes" <sam@example.com>',
		to: ["a@example.org", "b@example.org"],
		bcc: ["hidden@example.org"],
		subject: "Hello",
		html: "<p>Hi <img src=\"cid:logo\"></p>",
		text: "Hi",
		headers: { "In-Reply-To": "<parent@example.org>" },
		attachments: [
			{ filename: "notes.txt", content: "bm90ZXM=", content_type: "text/plain" },
			{ filename: "logo.png", content: "AQID", content_type: "image/png", content_id: "logo" },
		],
	});
});

test("structured addresses are formatted as display-name headers", () => {
	const payload = buildResendPayload({
		from: { name: "Support, Team", email: "support@example.com" },
		replyTo: { name: "", email: "replies@example.com" },
		to: [{ name: "Pat Lee", email: "pat@example.org" }, "user@example.org"],
		subject: "Hi",
		text: "Hi",
	});
	assert.equal(payload.from, '"Support, Team" <support@example.com>');
	assert.equal(payload.reply_to, "replies@example.com");
	assert.deepEqual(payload.to, ["Pat Lee <pat@example.org>", "user@example.org"]);
	assert.equal("cc" in payload, false);
	assert.equal("attachments" in payload, false);
});

test("a successful send returns Resend's email id", async () => {
	let request;
	const result = await sendWithResend(
		"re_test",
		{ from: "sam@example.com", to: "user@example.org", subject: "Hi", text: "Hi" },
		async (url, init) => {
			request = { url, init };
			return jsonResponse(200, { id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" });
		},
	);

	assert.deepEqual(result, { messageId: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" });
	assert.equal(request.url, "https://api.resend.com/emails");
	assert.equal(request.init.method, "POST");
	assert.equal(request.init.headers.Authorization, "Bearer re_test");
	assert.equal(JSON.parse(request.init.body).subject, "Hi");
});

test("an API error is raised with Resend's message", async () => {
	await assert.rejects(
		sendWithResend(
			"re_test",
			{ from: "sam@unverified.example", to: "user@example.org", subject: "Hi", text: "Hi" },
			async () => jsonResponse(403, { name: "validation_error", message: "The unverified.example domain is not verified." }),
		),
		/Resend API 403: The unverified\.example domain is not verified\./,
	);
});

test("without a Resend key the EMAIL binding sends the message unchanged", async () => {
	const sent = [];
	const env = {
		EMAIL: {
			async send(message) {
				sent.push(message);
				return { messageId: "<cf-1@example.com>" };
			},
		},
	};
	const message = { from: "sam@example.com", to: ["user@example.org"], subject: "Hi", text: "Hi" };

	assert.deepEqual(await sendOutboundEmail(env, message), { messageId: "<cf-1@example.com>" });
	assert.deepEqual(sent, [message]);
});
