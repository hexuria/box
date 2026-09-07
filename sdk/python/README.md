# grok-box Python SDK (workspace only)

Connect-only client. Not published to PyPI.

```python
import os
from grok_box import GrokBox

box = GrokBox.connect(
    "http://127.0.0.1:1337",
    "http://127.0.0.1:1340",
    os.environ["GROK_BOX_TOKEN"],
)
box.exec(command=["echo", "ok"])
png = box.screenshot_png()
```

There is no `Sandbox.create()` / `docker run` helper. Start the guest yourself, then connect with the URLs you published. `/v1/info` endpoint URLs are ignored.
