# grok-box TypeScript SDK (workspace only)

Connect-only client. Not published to npm.

```ts
import { GrokBox } from "grok-box";

const box = GrokBox.connect(
  "http://127.0.0.1:1337",
  "http://127.0.0.1:1340",
  process.env.GROK_BOX_TOKEN!,
);

await box.exec({ command: ["echo", "ok"] });
const png = await box.screenshotPng();
```

There is no `Sandbox.create()` / `docker run` helper. Start the guest yourself, then connect with the URLs you published. `/v1/info` endpoint URLs are ignored.
