"""Dev runner. Production deploys should use `uvicorn app.main:app` directly."""

import os

import uvicorn

if __name__ == "__main__":
    # Bind to loopback by default. In production Caddy reverse-proxies
    # from 127.0.0.1:7860 (see deploy/aws-lightsail/Caddyfile) so a
    # public bind here is a security hole — anyone scanning port 8000
    # would talk to FastAPI directly, bypassing TLS and any Caddy-side
    # rate limiting. Override with HOST=0.0.0.0 only when you actually
    # need LAN visibility for testing on another device.
    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=True,
        reload_dirs=["app"],
    )
