"""gh-proxy: PAT-holding companion service for reactor-worker.

reactor-worker container holds zero credentials; every GitHub side-effect (REST +
git clone/fetch/push) flows through this service over an HMAC-authenticated
internal channel. See `reactor_worker.proxy.server` for the request surface.
"""
