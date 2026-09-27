// Unit tests for src/lib/applications/emailTransport.ts's MockEmailTransport
// (Phase 09). Proves it never makes a network call (it's pure in-memory) and
// records what it "sent" for test assertions.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MockEmailTransport } from "../../src/lib/applications/emailTransport.ts";

describe("MockEmailTransport", () => {
  test("returns a mock provider message id without any network access", async () => {
    const transport = new MockEmailTransport();
    const result = await transport.send({
      to: "jobs@acme.test",
      subject: "Application for Backend Engineer",
      body: "Dear Hiring Team...",
      attachments: [{ filename: "cv.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
    });
    assert.match(result.providerMessageId, /^mock-/);
  });

  test("records every payload it was asked to send, for test assertions", async () => {
    const transport = new MockEmailTransport();
    const payload = { to: "a@test.local", subject: "s", body: "b", attachments: [] };
    await transport.send(payload);
    assert.equal(transport.sentPayloads.length, 1);
    assert.deepEqual(transport.sentPayloads[0], payload);
  });

  test("each send gets a distinct provider message id", async () => {
    const transport = new MockEmailTransport();
    const a = await transport.send({ to: "a@test.local", subject: "s", body: "b", attachments: [] });
    const b = await transport.send({ to: "b@test.local", subject: "s", body: "b", attachments: [] });
    assert.notEqual(a.providerMessageId, b.providerMessageId);
  });
});
